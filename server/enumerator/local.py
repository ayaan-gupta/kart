"""Runs the enumerator on this machine, so the phone path can be exercised without Modal.

`app.py` is the deployment and needs an A10G. This is the same detector, the same prompts, the
same threshold and the same de-duplication (all of them imported from `regions.py`, never
re-stated here), wired to a stdlib HTTP server and whatever accelerator a Mac has.

Two honest differences from the deployment, both reported by `GET /`:

  * SAM2 is usually not installed locally, and without it there are no silhouettes. Each region
    falls back to its bounding box as a four-point polygon. Everything downstream still works,
    because the contract only requires a polygon of at least three points; the outline drawn on
    the phone is a rectangle rather than the shape of the item. `server/enumerator/README.md`
    scores this: boxes alone cover 0.902 of hand-labelled items against 0.924 refined.
  * The catalog matcher is loaded only when `CATALOG_INDEX` points at a built index. Without it
    regions carry no SKU shortlist, so the census is asked an open-world question about each
    badge rather than being offered the store's own products.

It is a development host and says so: single threaded, no TLS, no auth. It binds every
interface for the same reason `scripts/serve.ts` does, and with the same caveat about networks
you do not trust.
"""

import base64
import io
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import regions  # noqa: E402
from regions import (  # noqa: E402
    BOX_THRESHOLD,
    GROCERY_PROMPT,
    MAX_INSTANCES,
    MAX_POLYGON_VERTICES,
    PAIRED_PRODUCE_SHARPNESS,
    PRODUCE_PROMPT,
    PRODUCE_PROMPTS,
    PRODUCE_THRESHOLD,
    SIMPLIFY_EPSILON,
    dedupe,
    merge_produce,
    sharpness,
)

# 3000, 8000 and 5432 are taken on the development machine, and 4310 is the recognition service.
DEFAULT_PORT = 4320

# Bounds the decoded image the same way `src/http.ts` bounds the one the app uploads. A local
# host is still a network service and still should not be asked to allocate an arbitrary buffer.
MAX_IMAGE_BYTES = 12 * 1024 * 1024


class Enumerator:
    def __init__(self):
        import torch
        from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection

        self.torch = torch
        # MPS is the whole reason this is worth running locally: on Apple Silicon the base model
        # is seconds per frame rather than tens of seconds. CPU stays as the fallback so this
        # file is not silently Mac-only.
        if torch.backends.mps.is_available():
            self.device = "mps"
        elif torch.cuda.is_available():
            self.device = "cuda"
        else:
            self.device = "cpu"

        print(f"[enumerator] loading grounding-dino-base on {self.device}", flush=True)
        started = time.monotonic()
        self.proc = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-base")
        self.dino = AutoModelForZeroShotObjectDetection.from_pretrained(
            "IDEA-Research/grounding-dino-base").to(self.device)
        self.dino.eval()
        print(f"[enumerator] detector ready in {time.monotonic() - started:.1f}s", flush=True)

        self.sam = None
        try:
            from sam2.build_sam import build_sam2
            from sam2.sam2_image_predictor import SAM2ImagePredictor

            checkpoint = os.environ.get("SAM_CHECKPOINT", "")
            if checkpoint and os.path.exists(checkpoint):
                self.sam = SAM2ImagePredictor(build_sam2(
                    "configs/sam2.1/sam2.1_hiera_t.yaml", checkpoint,
                    device=self.device, apply_postprocessing=False))
                print("[enumerator] SAM2 loaded, polygons are silhouettes", flush=True)
        except ImportError:
            pass
        if self.sam is None:
            print("[enumerator] no SAM2: polygons fall back to bounding boxes", flush=True)

        self.matcher = None
        index_path = os.environ.get("CATALOG_INDEX", "")
        if index_path and os.path.exists(index_path):
            sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            from catalog.matcher import Index, Matcher

            self.matcher = Matcher(Index.load(index_path))
            print(f"[enumerator] catalog loaded: {len(self.matcher.index.skus)} SKUs", flush=True)
        else:
            print("[enumerator] no catalog index: regions carry no SKU shortlist", flush=True)

    def _ground(self, pil, text, cut):
        inputs = self.proc(images=pil, text=text, return_tensors="pt").to(self.device)
        with self.torch.no_grad():
            outputs = self.dino(**inputs)
        res = self.proc.post_process_grounded_object_detection(
            outputs, inputs.input_ids, threshold=cut, text_threshold=cut,
            target_sizes=[pil.size[::-1]])[0]
        return (res["boxes"].cpu().numpy().tolist(),
                [float(s) for s in res["scores"].cpu()])

    def _polygon_from_mask(self, mask, w, h):
        """Largest external contour, simplified as ios/Kart/MaskContour.swift simplifies."""
        import cv2
        import numpy as np

        contours, _ = cv2.findContours(
            mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if not contours:
            return None
        contour = max(contours, key=cv2.contourArea)
        eps = SIMPLIFY_EPSILON * max(w, h)
        approx = cv2.approxPolyDP(contour, eps, True)
        while len(approx) > MAX_POLYGON_VERTICES:
            eps *= 1.5
            approx = cv2.approxPolyDP(contour, eps, True)
        if len(approx) < 3:
            return None
        return [round(float(v), 6) for p in approx.reshape(-1, 2) for v in (p[0] / w, p[1] / h)]

    def enumerate_regions(self, jpeg: bytes) -> dict:
        import numpy as np
        from PIL import Image

        pil = Image.open(io.BytesIO(jpeg)).convert("RGB")
        w, h = pil.size

        boxes, scores = self._ground(pil, GROCERY_PROMPT, BOX_THRESHOLD)

        # Deduplicate before segmenting, exactly as the deployment does, so the region set this
        # returns is the region set that was measured rather than one adjacent to it.
        if boxes:
            keep = dedupe(boxes, scores, size=pil.size)
            keep.sort(key=lambda i: -scores[i])
            keep = keep[:MAX_INSTANCES]
            boxes, scores = [boxes[i] for i in keep], [scores[i] for i in keep]

        # The second pass for loose produce, and the sharpness split that decides whether it is
        # asked as paired prompts or one. Both live in `regions.py` with the measurements that
        # chose them; repeating the reasoning here would let the two hosts drift apart.
        prompts = (PRODUCE_PROMPTS if sharpness(pil) >= PAIRED_PRODUCE_SHARPNESS
                   else (PRODUCE_PROMPT,))
        produce_boxes, produce_scores = [], []
        for prompt in prompts:
            found, found_scores = self._ground(pil, prompt, PRODUCE_THRESHOLD)
            produce_boxes += found
            produce_scores += found_scores
        for i in merge_produce(boxes, produce_boxes, produce_scores):
            if len(boxes) >= MAX_INSTANCES:
                break
            boxes.append(produce_boxes[i])
            scores.append(produce_scores[i])

        if not boxes:
            return {"instances": []}

        masks = None
        if self.sam is not None:
            self.sam.set_image(np.array(pil))
            with self.torch.no_grad():
                masks, _, _ = self.sam.predict(
                    box=np.asarray(boxes, dtype=np.float32), multimask_output=False)
            masks = np.asarray(masks)
            if masks.ndim == 4:
                masks = masks[:, 0]
            elif masks.ndim == 3 and len(boxes) == 1:
                masks = masks[None, 0]

        instances = []
        for i, (box, score) in enumerate(zip(boxes, scores)):
            if masks is not None:
                binary = masks[i] > 0.0
                if not binary.any():
                    continue
                polygon = self._polygon_from_mask(binary, w, h)
                if polygon is None:
                    continue
                ys, xs = np.nonzero(binary)
                x0, x1 = xs.min() / w, (xs.max() + 1) / w
                y0, y1 = ys.min() / h, (ys.max() + 1) / h
            else:
                # Grounding DINO returns pixel xyxy. Normalized and clamped, because a box may
                # extend past the frame edge and a polygon point outside 0..1 would draw the
                # outline off the item.
                x0, y0, x1, y1 = (max(0.0, min(1.0, v)) for v in
                                  (box[0] / w, box[1] / h, box[2] / w, box[3] / h))
                if x1 <= x0 or y1 <= y0:
                    continue
                polygon = [round(v, 6) for v in
                           (x0, y0, x1, y0, x1, y1, x0, y1)]

            instances.append({
                "box": {"x": round(float(x0), 6), "y": round(float(y0), 6),
                        "w": round(float(x1 - x0), 6), "h": round(float(y1 - y0), 6)},
                "polygon": polygon,
                # See `regions.objectness`: the text-match score is not the objectness the rest
                # of the pipeline is specified in, and unmapped it means no track ever starts.
                "score": regions.objectness(score),
            })

        if self.matcher is not None and instances:
            for instance, match in zip(
                instances, self.matcher.match_regions(pil, [i["box"] for i in instances])
            ):
                if match is not None:
                    instance["catalog"] = {
                        "sku": match["sku"],
                        "confidence": round(float(match["confidence"]), 6),
                        "alternatives": [
                            {"sku": a["sku"], "score": round(float(a["score"]), 6)}
                            for a in match["alternatives"]
                        ],
                    }

        return {"instances": instances}


def build_handler(enumerator: Enumerator):
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
            # Reports the two ways this host differs from the deployment, so a degraded run is
            # visible without reading the startup log.
            self._reply(200, {
                "ok": True,
                "device": enumerator.device,
                "polygons": "silhouettes" if enumerator.sam is not None else "bounding boxes",
                "catalog": enumerator.matcher is not None,
            })

        def do_POST(self):  # noqa: N802
            declared = self.headers.get("content-length")
            if declared is None or not declared.isdigit():
                self._reply(400, {"error": "Bad request"})
                return
            # Base64 inflates by roughly 4/3, so this bounds the decoded image, not the body.
            if int(declared) > MAX_IMAGE_BYTES * 4 // 3 + 4096:
                self._reply(400, {"error": "Bad request"})
                return

            try:
                body = json.loads(self.rfile.read(int(declared)))
                jpeg = base64.b64decode(body["image"], validate=True)
            except Exception:
                self._reply(400, {"error": "Bad request"})
                return
            if len(jpeg) > MAX_IMAGE_BYTES:
                self._reply(400, {"error": "Bad request"})
                return

            started = time.monotonic()
            try:
                result = enumerator.enumerate_regions(jpeg)
            except Exception as err:
                # `src/enumerate.ts` only ever reads the status, never the body, but a local
                # host is still a network service and still should not describe its internals.
                print(f"[enumerator] failed: {err}", flush=True)
                self._reply(500, {"error": "Enumeration failed"})
                return
            print(f"[enumerator] {len(result['instances'])} regions "
                  f"in {time.monotonic() - started:.1f}s", flush=True)
            self._reply(200, result)

        def log_message(self, *args):
            """Silenced: every request already prints its region count and timing above."""

    return Handler


def main() -> None:
    port = int(os.environ.get("PORT", DEFAULT_PORT))
    enumerator = Enumerator()
    server = HTTPServer(("0.0.0.0", port), build_handler(enumerator))
    print(f"[enumerator] listening on port {port}", flush=True)
    print(f"[enumerator] set ENUMERATOR_URL=http://127.0.0.1:{port} for the recognition service",
          flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
