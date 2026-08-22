"""If more badges went amber, would identify fix them or break them?

The eighty-first closed the calibration lever by counting flags: raising GREEN_CONFIDENCE to 0.96
catches 5 of 9 wrong answers and costs 19 of 66 right ones. That is the cost of *flagging*, and a
flag is not the outcome. An amber item goes to `resolveUncertain`, which crops it and asks again,
and per-crop naming measured 20 of 22 in the seventy-ninth. So the question the product actually
faces is the net after the second look: wrong answers repaired, minus right answers broken.

Everything shipped here is real. The confidences and the per-badge verdicts come from the saved
responses of a live run, so the threshold is applied to the model that ships. Only the second look
is a stand-in, a local 7B asked the same crop with the same catalog shortlist the service attaches,
because the account has no credit. That makes this an estimate of the mechanism, not of the number.

    KART_VLM=mlx-community/Qwen2.5-VL-7B-Instruct-4bit \
      server/.venv/bin/python server/eval/pipeline/amber_net.py
"""
import json, os, pathlib
from PIL import Image, ImageOps

import vlm

HERE = pathlib.Path(__file__).parent.parent
MODEL = os.environ.get("KART_VLM", "mlx-community/Qwen2.5-VL-7B-Instruct-4bit")
SAME = {
    "cauliflower": ["cauliflower"], "brussels_sprouts": ["brussels", "sprout"],
    "asparagus": ["asparagus"], "oreo": ["oreo"], "seedtastic_bread": ["bread", "seedtastic"],
    "granny_smith_apples": ["apple", "granny"], "baguette": ["baguette", "bread"],
    "purple_produce_bag": ["apple", "fuji", "produce bag", "purple"],
}


def readable(sku):
    return sku[5:].replace("_", " ") if sku.startswith("kart_") else sku


def main():
    labels = {}
    for f in ("still-labels.json", "query-labels.json"):
        labels.update(json.loads((HERE / "corpus/kart" / f).read_text())["boxes"])
    data = json.loads((HERE / ".cache/kart/frames-named.json").read_text())
    frames = {f["id"]: f for f in (data["frames"] if isinstance(data, dict) else data)}
    runs = json.loads((HERE / "kart-census-live.json").read_text())
    backend = vlm.load(MODEL)

    # One second look per (photograph, badge); the same crop recurs across passes.
    cache, pics = {}, {}
    def second_look(img, i):
        if (img, i) in cache:
            return cache[(img, i)]
        if img not in pics:
            p = ImageOps.exif_transpose(Image.open(HERE / f".cache/kart/images/{img}.jpg")).convert("RGB")
            p.thumbnail((2000, 2000))
            pics[img] = p
        pil = pics[img]
        W, H = pil.size
        b = frames[img]["boxes"][i]
        crop = pil.crop((int(b["x"]*W), int(b["y"]*H), int((b["x"]+b["w"])*W), int((b["y"]+b["h"])*H)))
        cat = frames[img].get("catalog") or []
        alts = (cat[i] or {}).get("alternatives", []) if i < len(cat) else []
        names = [readable(a) for a in alts[:5]]
        q = (f"What grocery product is this? The store catalog suggests it may be one of: "
             f"{', '.join(names)}. If one of those matches what you see, answer with it exactly. "
             f"Otherwise answer with the product name. Name only.")
        cache[(img, i)] = backend.ask(crop, q, tokens=16).strip().lower()
        return cache[(img, i)]

    print(f"identify stand-in: {MODEL}\n")
    # Two triggers. "census" is what ships: the model's own needsCloserLook or its confidence
    # below the threshold. "matcher" replaces the confidence half with the catalog matcher's own
    # score, which separates right from wrong twice as well (+0.122 against +0.06) and is already
    # computed server-side for every badge.
    print("  trigger   threshold   right before -> after    repaired   broken    net")
    for trigger, T in (("census", 0.55), ("census", 0.95), ("census", 0.96),
                       ("matcher", 0.60), ("matcher", 0.70), ("matcher", 0.80)):
        before = after = repaired = broken = 0
        for run in runs:
            img = run["id"]
            marks = {m["id"]: m for m in run["census"]["marks"]}
            for row in run["rows"]:
                lab = row["truth"]
                if row.get("ok") is None or lab not in SAME:
                    continue
                m = marks.get(row["badge"] + 1)
                if m is None:
                    continue
                was = bool(row["ok"])
                before += was
                if trigger == "census":
                    amber = bool(m.get("needsCloserLook")) or (m.get("confidence") or 0) < T
                else:
                    cat = frames[img].get("catalog") or []
                    mc = (cat[row["badge"]] or {}).get("confidence") if row["badge"] < len(cat) else None
                    amber = bool(m.get("needsCloserLook")) or (mc is not None and mc < T)
                if not amber:
                    after += was
                    continue
                said = second_look(img, row["badge"])
                now = any(w in said for w in SAME[lab])
                after += now
                repaired += (now and not was)
                broken += (was and not now)
        print(f"  {trigger:<9} {T:.2f}       {before} -> {after}            "
              f"{repaired:<11}{broken:<9}{after-before:+d}")


if __name__ == "__main__":
    main()
