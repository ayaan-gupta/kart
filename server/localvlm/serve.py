"""A census served by a local vision model, so the app can name products with no key and no credit.

The shipped census asks one question about a composite image carrying numbered badges. A small
local model cannot do that: measured on IMG_0249 it attached all three answers to the wrong badge.
`server/eval/pipeline/census_local.py` established the way that does work, and this is that method
behind the census contract rather than behind an eval script:

    per crop    what is this, and is it a product a shopper is buying
    per frame   which products are in this trolley that no crop covered

The cost is one model call per region instead of one per frame, which is exactly why the shipped
design does not do it. What it buys is a bag that fills with real names on a machine with no
OpenAI account, which is the difference between the phone path being reachable and working.

**This is not as good as the shipped model and must not be reported as if it were.** Measured in
the ninety-sixth section of KART.md on the same alignment metric: shipped 20 of 22, this 18 of 22.
It is the honest fallback, not the product.

Speed: one call per region on an M-series Mac, so a fifteen-region photograph is not instant. The
2B model is the default because it is the fastest of the three cached here.
"""

import base64
import io
import json
import os
import pathlib
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from PIL import Image

# `vlm.py` holds the two backends (transformers on MPS, MLX for 4-bit weights) and is the same
# module the measured eval numbers were taken with. Imported by path rather than copied so the
# two cannot drift.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "eval" / "pipeline"))
import vlm  # noqa: E402

DEFAULT_PORT = 4330
MAX_IMAGE_BYTES = 12 * 1024 * 1024

# The same three questions census_local.py measured. Changing their wording changes the numbers,
# so they are copied verbatim rather than paraphrased.
NAME_Q = ("What grocery product is this? Answer with the product name only, three words at most. "
          "If it is not a product a shopper is buying, answer NOT A PRODUCT.")
FRAME_Q = ("List every distinct grocery product you can see in this shopping trolley, one per "
           "line, name only. Do not list the trolley, the floor, bags, shoes or people.")
HIDDEN_Q = ("Are some products in this trolley hidden underneath or behind other products? "
            "Answer yes or no.")
# `subjectIsCart` was hardcoded true when this file was written, which the hundred-and-twelfth
# recorded as a fault: the four shelf photographs in the corpus are shop shelves, not trolleys,
# and the census called every one of them a cart. It cost nothing in that table because those rows
# hold no products to find, and it would matter to a shopper the moment the camera pointed at a
# shelf.
#
# The wording is measured, not chosen. Asked to pick between two words ("Answer TROLLEY or SHELF")
# this model narrates instead: "The image shows the in..." on both a trolley and a shelf, which any
# keyword test then reads as whichever word it was looking for. A closed yes/no question about one
# concrete visual fact does work, and separates all three photographs tried:
#
#     photograph               this question   "on shelving?"   the two-word choice
#     IMG_0252, a trolley      Yes             No               narration
#     IMG_0247, a shelf        No              Yes              narration
#     IMG_0250, a shelf        No              Yes              TROLLEY, wrong
CART_Q = ("Does this image show groceries inside a metal wire shopping cart basket? "
          "Answer yes or no.")

# A local model has no calibrated confidence, and inventing a number per answer would be a lie
# dressed as a measurement. One fixed value is used for every answer, and this is what it means.
#
# It sits just above GREEN_CONFIDENCE (0.55 in src/engine/liveVision/config.ts) so answers reach
# the bag. The first attempt put it just below, on the reasoning that a 2B model should not be
# trusted green, and the result was an empty bag on every run: below the threshold each item waits
# for the closer-look pass, that pass calls `identify`, and `identify` still needs the OpenAI
# credit this whole path exists to do without. Amber-by-default is the correct instinct and, on a
# machine with no credit, it is indistinguishable from recognizing nothing.
#
# So this number is not a measurement and must not be read as one. It is the flag that says "a
# local model answered this", and the accuracy that goes with it is the ninety-sixth section's
# 18 of 22 rather than the shipped 20 of 22.
LOCAL_CONFIDENCE = 0.6

# Crops below this are a few pixels of nothing once the model resizes them. The 150px legibility
# floor measured in KART.md is about badges in a composite; this is only a guard against a
# degenerate box.
MIN_CROP_EDGE = 24


def product_key(name: str) -> str:
    """The "brand::name" key the fusion layer joins on. A local answer never carries a brand."""
    return f"::{name.strip().lower()}"


class Census:
    def __init__(self, model_id: str):
        print(f"[census] loading {model_id}", flush=True)
        started = time.monotonic()
        self.model_id = model_id
        self.backend = vlm.load(model_id)
        print(f"[census] ready in {time.monotonic() - started:.1f}s", flush=True)

    def _crop(self, pil: Image.Image, box: dict) -> Image.Image | None:
        w, h = pil.size
        x0, y0 = int(box["x"] * w), int(box["y"] * h)
        x1, y1 = int((box["x"] + box["w"]) * w), int((box["y"] + box["h"]) * h)
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(w, x1), min(h, y1)
        if x1 - x0 < MIN_CROP_EDGE or y1 - y0 < MIN_CROP_EDGE:
            return None
        return pil.crop((x0, y0, x1, y1))

    def run(self, jpeg: bytes, marks: list[dict], counted: list[str]) -> dict:
        pil = Image.open(io.BytesIO(jpeg)).convert("RGB")
        # The same working size census_local.py used, so the crops the model sees are the crops
        # the measured numbers came from.
        pil.thumbnail((1333, 1333))

        results = []
        for mark in marks:
            crop = self._crop(pil, mark["box"])
            if crop is None:
                # Reported rather than dropped: a mark that vanishes here would leave the client
                # holding a track with no answer and no reason, which is the silent-failure shape
                # this project keeps finding.
                results.append({
                    "id": mark["id"], "name": "unclear", "brand": None, "size": None,
                    "category": "Grocery", "confidence": 0.0, "needsCloserLook": True,
                    "isProduct": False, "catalogSku": None,
                })
                continue
            answer = self.backend.ask(crop, NAME_Q, tokens=16).strip()
            is_product = "NOT A PRODUCT" not in answer.upper() and answer != ""
            name = answer if is_product else "not a product"
            results.append({
                "id": mark["id"],
                "name": name[:60],
                "brand": None,
                "size": None,
                "category": "Grocery",
                "confidence": LOCAL_CONFIDENCE if is_product else 0.0,
                # Always true: a 2B model's single-crop guess is exactly the case the closer-look
                # pass exists for, and saying otherwise would suppress the one repair available.
                "needsCloserLook": True,
                "isProduct": is_product,
                # No catalog is consulted on this path, which is one of the three situations the
                # schema documents null as covering.
                "catalogSku": None,
            })

        named = {r["name"].lower() for r in results if r["isProduct"]}
        already = {c.strip().lower() for c in counted}
        unmarked = []
        for line in self.backend.ask(pil, FRAME_Q, tokens=96).splitlines():
            item = line.strip().lstrip("-*0123456789. ").strip()
            if not item or item.lower() in named or item.lower() in already:
                continue
            unmarked.append({
                "description": item[:60],
                "productKey": product_key(item),
                "catalogSku": None,
                "approxLocation": "in the trolley",
                "confidence": LOCAL_CONFIDENCE,
            })
            if len(unmarked) >= 12:
                break

        counts: dict[str, int] = {}
        for r in results:
            if r["isProduct"]:
                counts[product_key(r["name"])] = counts.get(product_key(r["name"]), 0) + 1
        for u in unmarked:
            counts.setdefault(u["productKey"], 1)

        hidden = self.backend.ask(pil, HIDDEN_Q, tokens=8).strip().lower().startswith("yes")
        # Anything that is not a clear yes is treated as not a cart. The census is allowed to be
        # unsure and say so; what it must not do is assert a shelf is a trolley, which is the
        # direction the hardcoded value used to fail in.
        subject = self.backend.ask(pil, CART_Q, tokens=8).strip().upper()
        is_cart = subject.startswith("YES")

        return {
            "subjectIsCart": is_cart,
            "marks": results,
            "unmarkedItems": unmarked,
            "inViewCounts": [{"productKey": k, "count": v} for k, v in counts.items()],
            "occlusion": {
                "itemsLikelyHidden": hidden,
                "severity": "some" if hidden else "none",
                "reason": "a local model was asked whether items are hidden" if hidden else "",
            },
        }


def build_handler(census: Census):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _reply(self, status: int, body: dict) -> None:
            payload = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):  # noqa: N802
            self._reply(200, {"ok": True, "model": census.model_id, "shipped_model": False})

        def do_POST(self):  # noqa: N802
            declared = self.headers.get("content-length")
            if declared is None or not declared.isdigit():
                self._reply(400, {"error": "Bad request"})
                return
            if int(declared) > MAX_IMAGE_BYTES * 4 // 3 + 65536:
                self._reply(400, {"error": "Bad request"})
                return
            try:
                body = json.loads(self.rfile.read(int(declared)))
                jpeg = base64.b64decode(body["image"], validate=True)
                marks = body.get("marks") or []
                counted = body.get("counted") or []
            except Exception:
                self._reply(400, {"error": "Bad request"})
                return
            if len(jpeg) > MAX_IMAGE_BYTES:
                self._reply(400, {"error": "Bad request"})
                return

            started = time.monotonic()
            try:
                result = census.run(jpeg, marks, counted)
            except Exception as err:
                print(f"[census] failed: {err}", flush=True)
                self._reply(500, {"error": "Census failed"})
                return
            print(f"[census] {len(marks)} marks, {len(result['unmarkedItems'])} unmarked, "
                  f"{time.monotonic() - started:.1f}s", flush=True)
            self._reply(200, result)

        def log_message(self, *args):
            """Silenced: every request already prints its own one-line summary above."""

    return Handler


def main() -> None:
    port = int(os.environ.get("PORT", DEFAULT_PORT))
    census = Census(os.environ.get("KART_VLM", "Qwen/Qwen2-VL-2B-Instruct"))
    print(f"[census] listening on port {port}", flush=True)
    print(f"[census] set LOCAL_CENSUS_URL=http://127.0.0.1:{port} on the recognition service",
          flush=True)
    print("[census] this is the local fallback, measured 18 of 22 against the shipped 20 of 22",
          flush=True)
    HTTPServer(("0.0.0.0", port), build_handler(census)).serve_forever()


if __name__ == "__main__":
    main()
