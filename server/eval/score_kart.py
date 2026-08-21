"""The pipeline on the photographs it is actually for.

Every other corpus in this directory is a substitute for this one. The shelf corpus is Indian
retail shelves. The cart corpus is openly-licensed haul photographs, most of them taken on a
table rather than in a shop. RPC is products on a turntable. All three were chosen because they
could be obtained, and each was documented with what it could not answer.

This is the real thing: a phone held over a real trolley in a real supermarket, with the
trolley's own wire mesh between the camera and the goods, plus four photographs of the shelves
that trolley was filled from. Six of the ten are one trolley being loaded item by item, which
makes the count knowable at every step instead of only at the end.

Detection here is the shipped path: `regions.GROCERY_PROMPT` at `regions.BOX_THRESHOLD`,
de-duplicated, then the produce second pass merged in where the first found nothing.

    ../.venv/bin/python score_kart.py --render /tmp/kart
"""

import argparse
import json
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / ".cache" / "kart"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "enumerator"))

import regions  # noqa: E402

MAX_SIDE = 1333


def photographs():
    return sorted(CACHE / "images" / f"{p.stem}.jpg"
                  for p in (CACHE / "images").glob("*.jpg"))


def detector(device=None):
    """The loaded model and a function that grounds one prompt on one image."""
    import torch
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

    device = device or ("mps" if torch.backends.mps.is_available() else "cpu")
    proc = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-base")
    dino = AutoModelForZeroShotObjectDetection.from_pretrained(
        "IDEA-Research/grounding-dino-base").to(device)

    def ground(pil, text, threshold):
        inputs = proc(images=pil, text=text, return_tensors="pt").to(device)
        with torch.no_grad():
            outputs = dino(**inputs)
        got = proc.post_process_grounded_object_detection(
            outputs, inputs.input_ids, threshold=threshold, text_threshold=threshold,
            target_sizes=[pil.size[::-1]])[0]
        return ([[float(v) for v in row] for row in got["boxes"].cpu().numpy()],
                [float(s) for s in got["scores"].cpu()])

    return ground, device


def propose(pil, ground, produce_pass=True, threshold=None):
    """The regions the service would return for one frame, in normalized coordinates."""
    threshold = regions.BOX_THRESHOLD if threshold is None else threshold
    boxes, scores = ground(pil, regions.GROCERY_PROMPT, threshold)
    raw = len(boxes)
    if boxes:
        keep = regions.dedupe(boxes, scores, size=pil.size)
        keep.sort(key=lambda i: -scores[i])
        keep = keep[: regions.MAX_INSTANCES]
        boxes, scores = [boxes[i] for i in keep], [scores[i] for i in keep]
    added = 0
    if produce_pass:
        produce_boxes, produce_scores = ground(
            pil, regions.PRODUCE_PROMPT, regions.PRODUCE_THRESHOLD)
        raw += len(produce_boxes)
        for i in regions.merge_produce(boxes, produce_boxes, produce_scores):
            if len(boxes) >= regions.MAX_INSTANCES:
                break
            boxes.append(produce_boxes[i])
            scores.append(produce_scores[i])
            added += 1
    width, height = pil.size
    return {
        "raw": raw,
        "from_produce_pass": added,
        "boxes": [{"x": b[0] / width, "y": b[1] / height,
                   "w": (b[2] - b[0]) / width, "h": (b[3] - b[1]) / height} for b in boxes],
        "scores": [regions.objectness(s) for s in scores],
    }


def render(pil, boxes, path, cell=1100):
    """The photograph with every proposal numbered, which is how they get judged."""
    from PIL import ImageDraw, ImageFont

    im = pil.copy()
    im.thumbnail((cell, cell))
    width, height = im.size
    draw = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 24)
    except OSError:
        font = ImageFont.load_default()
    for i, b in enumerate(boxes):
        x0, y0 = b["x"] * width, b["y"] * height
        draw.rectangle([x0, y0, (b["x"] + b["w"]) * width, (b["y"] + b["h"]) * height],
                       outline=(0, 255, 90), width=3)
        label = str(i)
        draw.rectangle([x0, y0, x0 + draw.textlength(label, font=font) + 10, y0 + 30],
                       fill=(0, 0, 0))
        draw.text((x0 + 5, y0 + 2), label, fill=(0, 255, 90), font=font)
    im.save(path, quality=90)


def score(frames, truth, log=print):
    """Counting, against the hand-established truth, on the photographs where a count exists."""
    counted = {c["id"]: c for c in truth.get("counted", [])}
    skipped = {c["id"]: c for c in truth.get("not_countable", [])}
    by_id = {f["id"]: f for f in frames}

    rows, errors = [], []
    for entry in truth.get("counted", []):
        frame = by_id.get(entry["id"])
        if frame is None:
            continue
        proposed = len(frame["boxes"])
        rows.append((entry["id"], entry["products"], proposed, entry["correct"],
                     proposed - entry["products"], entry.get("confidence", "certain")))
        errors.append(proposed - entry["products"])

    log("\n  counting, on the photographs where a person can count")
    log(f"    {'id':12} {'real':>5} {'proposed':>9} {'correct':>8} {'error':>6}  confidence")
    for name, real, proposed, correct, error, confidence in rows:
        log(f"    {name:12} {real:>5} {proposed:>9} {correct:>8} {error:>+6}  {confidence}")

    total = sum(r[1] for r in rows)
    right = sum(r[3] for r in rows)
    certain = [r for r in rows if r[5] == "certain"]
    if errors:
        log(f"\n    items counted correctly   {right}/{total}  {right / max(total, 1):.1%}")
        log(f"    mean signed error         {sum(errors) / len(errors):+.1f} items")
        log(f"    mean absolute error       "
            f"{sum(abs(e) for e in errors) / len(errors):.1f} items")
    if certain and len(certain) != len(rows):
        cert_total = sum(r[1] for r in certain)
        cert_right = sum(r[3] for r in certain)
        cert_err = [r[4] for r in certain]
        log(f"\n    on the {len(certain)} certain photographs alone, which excludes the one "
            f"where\n    two items lie under the shopper's tote and are judged rather than read:")
        log(f"      items counted correctly {cert_right}/{cert_total}  "
            f"{cert_right / max(cert_total, 1):.1%}")
        log(f"      mean absolute error     "
            f"{sum(abs(e) for e in cert_err) / len(cert_err):.1f} items")

    shelves = [by_id[i] for i in skipped if i in by_id]
    if shelves:
        log(f"\n  the {len(shelves)} shelf photographs carry no count, and are here for what "
            "detection\n  does on a wall of near-identical packs: "
            f"{sum(len(f['boxes']) for f in shelves) / len(shelves):.0f} regions each on average")
    return {
        "items": total, "correct": right,
        "mean_signed": sum(errors) / len(errors) if errors else None,
        "mean_absolute": sum(abs(e) for e in errors) / len(errors) if errors else None,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-produce-pass", action="store_true")
    parser.add_argument("--threshold", type=float, default=regions.BOX_THRESHOLD)
    parser.add_argument("--render", default=None, help="directory for numbered overlays")
    parser.add_argument("--out", default=str(CACHE / "frames.json"))
    parser.add_argument("--index", default=None,
                        help="also name every region against this index, and write the frames in "
                             "the shape pipeline/states.ts consumes so the overlay states can be "
                             "measured on these photographs too")
    args = parser.parse_args(argv)

    from PIL import Image, ImageOps

    ground, device = detector()
    print(f"grounding-dino-base on {device}")

    truth = {}
    truth_path = HERE / "corpus" / "kart" / "counts.json"
    if truth_path.exists():
        truth = {c["id"]: c for c in json.loads(truth_path.read_text())["counted"]}

    out_dir = pathlib.Path(args.render) if args.render else None
    if out_dir:
        out_dir.mkdir(parents=True, exist_ok=True)

    frames, started = [], time.time()
    for path in photographs():
        with Image.open(path) as handle:
            # exif_transpose, not just convert. These are phone photographs and every one of them
            # carries orientation 6, so PIL hands back a frame rotated a quarter turn from what
            # the shopper saw. The detector does measurably worse on it, and `isInFront` in the
            # occlusion rule reasons about which item is nearer the bottom of the frame, which is
            # a statement about gravity and is simply wrong on a sideways image.
            pil = ImageOps.exif_transpose(handle).convert("RGB")
        pil.thumbnail((MAX_SIDE, MAX_SIDE))
        result = propose(pil, ground, produce_pass=not args.no_produce_pass,
                         threshold=args.threshold)
        result["id"] = path.stem
        result["pixels"] = list(pil.size)
        frames.append(result)
        if out_dir:
            render(pil, result["boxes"], out_dir / f"{path.stem}.jpg")
        known = truth.get(path.stem)
        note = ""
        if known:
            note = f"   against {known['products']} products"
        print(f"  {path.stem}  {result['raw']:3d} raw -> {len(result['boxes']):3d} kept"
              f"  ({result['from_produce_pass']} from the produce pass){note}")

    if args.index:
        # Named through the shipped path: the same padded crop the service takes, the same
        # matcher, so what the overlay is judged on is what the overlay would receive.
        from catalog import head as head_module
        from catalog import matcher as matcher_module
        from catalog.matcher import Index, Matcher, crop_region

        head_module.MIN_REFERENCES = 9
        matcher_module.MIN_REFERENCES = 9
        matcher = Matcher(Index.load(pathlib.Path(args.index)), tta=1)
        for frame, path in zip(frames, photographs()):
            with Image.open(path) as handle:
                pil = ImageOps.exif_transpose(handle).convert("RGB")
            pil.thumbnail((MAX_SIDE, MAX_SIDE))
            crops, slots = [], []
            for i, box in enumerate(frame["boxes"]):
                piece = crop_region(pil, box)
                if piece is not None:
                    crops.append(piece)
                    slots.append(i)
            named = [None] * len(frame["boxes"])
            for slot, result in zip(slots, matcher.match(crops) if crops else []):
                named[slot] = {
                    "sku": result["sku"],
                    "confidence": float(result["confidence"]),
                    "alternatives": [a["sku"] for a in result["alternatives"]],
                }
            frame["catalog"] = named
            frame["file"] = f"{frame['id']}.jpg"
            frame["tier"] = "trolley"
            frame["width"], frame["height"] = frame["pixels"]
            frame["hidden"] = [0.0] * len(frame["boxes"])
        print(f"  named {sum(1 for f in frames for c in f['catalog'] if c and c['sku'])}"
              f" of {sum(len(f['boxes']) for f in frames)} regions")

    summary = None
    if truth_path.exists():
        summary = score(frames, json.loads(truth_path.read_text()))

    payload = {
        "counting": summary,
        "prompt": regions.GROCERY_PROMPT,
        "produce_prompt": regions.PRODUCE_PROMPT if not args.no_produce_pass else None,
        "threshold": args.threshold,
        "seconds": round(time.time() - started, 1),
        "frames": frames,
    }
    pathlib.Path(args.out).write_text(json.dumps(payload, indent=1))
    print(f"\n  {len(frames)} photographs, "
          f"{sum(len(f['boxes']) for f in frames)} regions, {payload['seconds']}s")
    print(f"wrote {args.out}")
    if out_dir:
        print(f"wrote numbered overlays to {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
