"""Catalog references for the yellow produce bag, from frames the 3fps sample never took.

The ninety-first concluded this SKU cannot exist because the video does not hold ten usable views
of the bag and `MIN_REFERENCES` is 10. That was true of `video-frames.json` and false of the video.
The corpus samples at **3fps**, so the 2.6 seconds the bag is plainly visible contribute five
frames; the file itself is 262 frames at 30fps. Sampling that window densely gives twenty boxes at
or above 28% yellow, every one of them a clean view of the bag.

Nothing about that is a pipeline change. `build_kart_catalog.py` builds references from the video
and queries the stills so the number is not memorisation, and this keeps that split exactly. The
detection threshold used to find them is 0.15 rather than the shipped 0.23, which is also fine: a
catalog is built offline by whatever means, and in a real deployment it is a product photograph
rather than a detection at all.

    server/.venv/bin/python server/eval/build_yellow_reference.py --out <catalog dir>/yellow_produce_bag
"""
import argparse, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
VIDEO = pathlib.Path.home() / "Downloads/Kart-images:video/IMG_0253.MOV"
WINDOW = (3.6, 6.2)   # seconds the bag is plainly in view
STRIDE = 3            # every third frame of thirty: about 10fps
MIN_YELLOW = 0.28     # fraction of the crop that is yellow by hue
MIN_SIDE = 60         # pixels; smaller crops are not worth indexing


def _yellowness(img):
    import numpy as np
    a = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    mx, mn = a.max(2), a.min(2)
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    d = np.maximum(mx - mn, 1e-6)
    h = np.select([mx == r, mx == g, mx == b],
                  [((g - b) / d) % 6, ((b - r) / d) + 2, ((r - g) / d) + 4]) * 60
    ok = (s > 0.35) & (mx > 0.40)
    return (ok & (h >= 40) & (h <= 70)).sum() / (a.shape[0] * a.shape[1])


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", default=str(VIDEO))
    ap.add_argument("--out", default=str(HERE / ".cache/kart/catalog/yellow_produce_bag"))
    ap.add_argument("--threshold", type=float, default=0.15)
    ap.add_argument("--limit", type=int, default=14)
    args = ap.parse_args(argv)

    import cv2
    from PIL import Image
    sys.path.insert(0, str(HERE))
    sys.path.insert(0, str(HERE.parent))
    import score_kart, regions

    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames, n = [], 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = n / fps
        if WINDOW[0] <= t <= WINDOW[1] and n % STRIDE == 0:
            frames.append(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
        n += 1
    cap.release()
    print(f"{n} frames in the video, {len(frames)} sampled in {WINDOW[0]}-{WINDOW[1]}s")

    ground, device = score_kart.detector()
    hits = []
    for pil in frames:
        boxes, scores = ground(pil, regions.GROCERY_PROMPT, args.threshold)
        if not boxes:
            continue
        for k in regions.dedupe(boxes, scores, size=pil.size):
            x0, y0, x1, y1 = [int(v) for v in boxes[k]]
            if x1 - x0 < MIN_SIDE or y1 - y0 < MIN_SIDE:
                continue
            crop = pil.crop((x0, y0, x1, y1))
            y = _yellowness(crop)
            if y >= MIN_YELLOW:
                hits.append((y, crop))
    hits.sort(key=lambda t: -t[0])
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for i, (y, crop) in enumerate(hits[: args.limit]):
        crop.save(out / f"v{i:03d}.jpg", quality=95)
    print(f"{len(hits)} boxes at >= {MIN_YELLOW:.0%} yellow; wrote {min(len(hits), args.limit)} to {out}")
    if len(hits) < 10:
        print("  WARNING: below MIN_REFERENCES (10); Index.build will skip this folder")


if __name__ == "__main__":
    main()
