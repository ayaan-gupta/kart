"""
The whole pipeline, end to end, on real photographs of loaded carts and grocery hauls.

Everything measured so far has measured one stage. `score_grocer.py` hands the matcher a crop
that a human drew a box around and asks what it is. `score_grocer_detection.py` asks the
detector what is there and never names it. The product is the composition of the two, and a
composition can be worse than either half: an item the detector misses is not a naming error, it
is simply absent, and a box drawn around two items at once produces a confident name for a thing
that does not exist.

This runs the shipped path on 24 curated photographs: Grounding DINO with the prompt and
threshold from `server/enumerator/regions.py`, the same de-duplication, then `Matcher.match` on
each surviving region, then the covered rule from `occlusion.ts`. Its output is a frames file
that the TypeScript harness consumes, so the outline states a shopper would actually see are
computed by the code that computes them on the phone.

What this corpus can and cannot answer:

  detection, counting   yes, and this is what it is for. Real carts, real hauls, real lighting.
  covered items         yes. The geometry is a pile rather than a shelf, which is the geometry
                        the depth cue in `hiddenFraction` was reasoned about.
  low confidence        yes, and in the hardest form. These are American and European products
                        and the catalog is Indian, so essentially every item is outside it. The
                        right behaviour is to decline almost everything, and how often it does
                        is a direct measurement of the fourth capability.
  naming accuracy       no. There is no catalog for these products and building one from 24
                        photographs is not possible. Naming stays measured on Grocer-Help, which
                        has 623 real products and a genuine closed world.

    server/.venv/bin/python server/eval/score_carts.py
"""
import argparse
import json
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).parent
CORPUS = HERE / "corpus"
CACHE = HERE / ".cache" / "grocer"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "enumerator"))

import regions  # noqa: E402
from catalog.matcher import Index, Matcher  # noqa: E402
from score_grocer_occlusion import hidden_fraction, in_front  # noqa: E402


def curated(tiers=("cart", "haul")):
    """The images judged usable, joined to their provenance."""
    curation = json.loads((CORPUS / "cart-curation.json").read_text())
    manifest = json.loads((CORPUS / "cart-manifest.json").read_text())
    by_id = {e["id"]: e for e in manifest["images"]}
    out = []
    for tier in tiers:
        for image_id in curation[tier]:
            entry = by_id.get(image_id)
            if entry and (CORPUS / "carts" / entry["file"]).exists():
                out.append(entry | {"tier": tier})
    return out


def detect_all(images, threshold, log=print):  # noqa: C901
    """Boxes per photograph, through the service's own prompt, threshold and de-duplication."""
    import torch
    from PIL import Image
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    log(f"loading grounding-dino-base on {device}")
    proc = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-base")
    dino = AutoModelForZeroShotObjectDetection.from_pretrained(
        "IDEA-Research/grounding-dino-base").to(device)

    frames = []
    for n, entry in enumerate(images):
        path = CORPUS / "carts" / entry["file"]
        with Image.open(path) as handle:
            pil = handle.convert("RGB")
        width, height = pil.size
        inputs = proc(images=pil, text=regions.GROCERY_PROMPT, return_tensors="pt").to(device)
        with torch.no_grad():
            outputs = dino(**inputs)
        found = proc.post_process_grounded_object_detection(
            outputs, inputs.input_ids, threshold=threshold, text_threshold=threshold,
            target_sizes=[pil.size[::-1]],
        )[0]
        boxes = [[float(v) for v in row] for row in found["boxes"].cpu().numpy()]
        scores = [float(s) for s in found["scores"].cpu()]
        raw = len(boxes)
        if boxes:
            keep = regions.dedupe(boxes, scores)
            keep.sort(key=lambda i: -scores[i])
            keep = keep[: regions.MAX_INSTANCES]
            boxes = [boxes[i] for i in keep]
            scores = [scores[i] for i in keep]
        frames.append({
            "id": entry["id"], "file": entry["file"], "tier": entry["tier"],
            "width": width, "height": height, "raw_proposals": raw,
            # Normalized to the frame, origin top-left, which is the convention every other
            # coordinate in this codebase uses.
            "boxes": [
                {"x": b[0] / width, "y": b[1] / height,
                 "w": (b[2] - b[0]) / width, "h": (b[3] - b[1]) / height}
                for b in boxes
            ],
            # Mapped into the units the tracker is specified in, exactly as the service maps
            # them before returning. Skipping this is what turned 348 regions into 7 tracks.
            "scores": [regions.objectness(s, threshold) for s in scores],
            "raw_scores": [round(s, 6) for s in scores],
        })
        log(f"  {n + 1}/{len(images)} {entry['file'][:28]:30s} {raw:3d} raw -> {len(boxes):3d}")
    return frames


def name_all(frames, index_path, log=print):
    """Catalog match for every region, through `Matcher.match_regions`, the shipped entry point."""
    from PIL import Image

    log(f"loading catalog {index_path.name}")
    matcher = Matcher(Index.load(index_path))
    log(f"  {len(matcher.index.skus)} products")
    for n, frame in enumerate(frames):
        with Image.open(CORPUS / "carts" / frame["file"]) as handle:
            pil = handle.convert("RGB")
        results = matcher.match_regions(pil, frame["boxes"])
        frame["catalog"] = [
            None if r is None else {
                "sku": r["sku"],
                "confidence": round(float(r["confidence"]), 6),
                "alternatives": [a["sku"] for a in r["alternatives"]],
            }
            for r in results
        ]
        log(f"  named {n + 1}/{len(frames)}")
    return frames


def add_coverage(frames):
    """How much of each region the regions in front of it cover."""
    for frame in frames:
        boxes = [(b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]) for b in frame["boxes"]]
        frame["hidden"] = [
            round(hidden_fraction(
                subject, [o for j, o in enumerate(boxes) if j != i and in_front(subject, o)]
            ), 6)
            for i, subject in enumerate(boxes)
        ]
    return frames


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--threshold", type=float, default=regions.BOX_THRESHOLD)
    parser.add_argument("--index", default=str(CACHE / "index-b16-ft1.npz"))
    parser.add_argument("--out", default=str(HERE / "carts-frames.json"))
    parser.add_argument("--tiers", default="cart,haul")
    args = parser.parse_args(argv)

    images = curated(tuple(args.tiers.split(",")))
    if not images:
        raise SystemExit(
            "no curated images. Run: server/.venv/bin/python "
            "server/eval/corpus/fetch_carts.py --want 200"
        )
    print(f"{len(images)} curated photographs "
          f"({sum(1 for i in images if i['tier'] == 'cart')} carts, "
          f"{sum(1 for i in images if i['tier'] == 'haul')} hauls)")

    started = time.time()
    frames = detect_all(images, args.threshold)
    frames = name_all(frames, pathlib.Path(args.index))
    frames = add_coverage(frames)

    payload = {
        "threshold": args.threshold,
        "index": pathlib.Path(args.index).name,
        "seconds": round(time.time() - started, 1),
        "frames": frames,
    }
    pathlib.Path(args.out).write_text(json.dumps(payload, indent=1))

    total = sum(len(f["boxes"]) for f in frames)
    named = sum(1 for f in frames for c in f["catalog"] if c and c["sku"])
    covered = sum(1 for f in frames for h in f["hidden"] if h >= 0.2)
    print(f"\n  regions proposed      {total}  ({total / len(frames):.1f} per photograph)")
    print(f"  named by the catalog  {named}  ({named / max(total, 1):.1%})")
    print(f"  covered by the rule   {covered}  ({covered / max(total, 1):.1%})")
    print(f"\nwrote {args.out}")
    return payload


if __name__ == "__main__":
    main()
