"""
The pipeline over real video, which is the only way to test the half of it that is about time.

Every other harness in this directory feeds the pipeline a single photograph. The app does not
work that way. It runs the detector three times a second, follows each item across frames with
ByteTrack and a Kalman filter, decides which frames are worth uploading, and fuses several looks
at one item into one identity with one quantity. None of that has ever been measured, and none
of it can be measured on a still.

The footage is a Costco haul filmed handheld: someone walking a full trolley through a warehouse
and then panning over the unloaded pile at home. Motion blur, changing exposure, items entering
and leaving frame, the same item seen from four angles. It is a closer match to a shopper
photographing their cart than anything else in this repository.

Sharpness and motion are computed here the way `FrameMetrics` computes them on the device, so
the keyframe gate in `pipeline.ts` is exercised with real numbers rather than the constants the
still harness passes it. That gate has never seen a real frame.

    server/.venv/bin/python server/eval/score_video.py --segments 205:30,245:30,320:30,425:30

Writes `video-frames.json`, which `pipeline/video-states.ts` runs through the real engine.
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

# The app's detector rate. Rendering stays at 60fps via Kalman prediction, but the tracker only
# ever sees frames at this cadence, so sampling any faster would measure a pipeline that does not
# exist and sampling slower would hand ByteTrack larger jumps than it is tuned for.
DETECT_FPS = 3


def metrics(gray, previous):
    """Sharpness and motion, matching what `FrameMetrics` reports to the keyframe gate.

    Sharpness is the variance of the Laplacian over the luma plane, unnormalized. Motion is the
    mean absolute luma difference against the previous frame, 0 to 1. The first frame of a
    session reports maximum motion, which is why a session never uploads its own first frame.

    "The previous frame" means the previous *camera* frame, at the capture rate, not the previous
    frame the detector was run on. The first version of this harness compared frames a third of a
    second apart and reported a median motion of 0.129 against a ceiling of 0.06, which made the
    shipped gate look absurdly strict and nearly bought a change to it. At 60fps the same footage
    is a twentieth of that. A measurement of the gate has to feed the gate the units it was
    specified in.
    """
    import cv2
    import numpy as np

    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if previous is None:
        return sharpness, 1.0
    motion = float(np.mean(np.abs(gray.astype(np.int16) - previous.astype(np.int16))) / 255.0)
    return sharpness, motion


def sample(path, segments, log=print):
    """Frames at the detector's rate, with motion measured at the capture rate.

    Read sequentially rather than by seeking. Every camera frame in the segment is decoded so
    that motion is a difference between adjacent frames, as it is on the device; only every
    `step`-th one is kept for the detector to look at.
    """
    import cv2

    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, round(fps / DETECT_FPS))
    frames = []
    for start, length in segments:
        first, last = int(start * fps), int((start + length) * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, first)
        previous = None
        kept = 0
        for index in range(first, last):
            ok, bgr = cap.read()
            if not ok:
                break
            gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
            sharpness, motion = metrics(gray, previous)
            previous = gray
            if (index - first) % step:
                continue
            frames.append({
                "segment": f"{start}s",
                "t": round(index / fps, 3),
                "order": kept,
                "bgr": bgr,
                "sharpness": round(sharpness, 3),
                "motion": round(motion, 5),
            })
            kept += 1
        log(f"  segment {start}s+{length}s: {kept} frames, motion measured at {fps:.0f}fps")
    cap.release()
    return frames


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", default=None, help="defaults to the largest fetched video")
    parser.add_argument("--segments", default="205:30,245:30,320:30,425:30",
                        help="comma separated start:length in seconds")
    parser.add_argument("--threshold", type=float, default=regions.BOX_THRESHOLD)
    parser.add_argument("--produce-pairs", action="store_true",
                        help="run the produce nouns two to a prompt. On this nine-second scan it "
                             "takes detection from 137 boxes to 205 and the bag from 10 units "
                             "against 10 real products to 16, 13 and 18, which is why app.py "
                             "does not")
    parser.add_argument("--index", default=str(CACHE / "index-b16-ft1.npz"))
    parser.add_argument("--out", default=str(HERE / "video-frames.json"))
    args = parser.parse_args(argv)

    import cv2
    import torch
    from PIL import Image
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

    manifest = json.loads((CORPUS / "video-manifest.json").read_text())
    if args.video:
        path = pathlib.Path(args.video)
        entry = next((v for v in manifest["videos"] if v["file"] == path.name), {})
    else:
        entry = max(manifest["videos"], key=lambda v: v["bytes"])
        path = CORPUS / "videos" / entry["file"]
    print(f"{entry.get('title', path.name)}")
    print(f"  {entry.get('licence', 'unknown licence')}  {entry.get('source_page', '')}")

    segments = [(int(s.split(":")[0]), int(s.split(":")[1])) for s in args.segments.split(",")]
    frames = sample(path, segments)
    print(f"{len(frames)} frames at {DETECT_FPS}fps")

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"loading grounding-dino-base on {device}")
    proc = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-base")
    dino = AutoModelForZeroShotObjectDetection.from_pretrained(
        "IDEA-Research/grounding-dino-base").to(device)
    matcher = Matcher(Index.load(pathlib.Path(args.index)))
    print(f"catalog: {len(matcher.index.skus)} products")

    started = time.time()
    out = []
    for n, frame in enumerate(frames):
        pil = Image.fromarray(cv2.cvtColor(frame["bgr"], cv2.COLOR_BGR2RGB))
        width, height = pil.size
        inputs = proc(images=pil, text=regions.GROCERY_PROMPT, return_tensors="pt").to(device)
        with torch.no_grad():
            outputs = dino(**inputs)
        found = proc.post_process_grounded_object_detection(
            outputs, inputs.input_ids, threshold=args.threshold,
            text_threshold=args.threshold, target_sizes=[pil.size[::-1]],
        )[0]
        boxes = [[float(v) for v in row] for row in found["boxes"].cpu().numpy()]
        scores = [float(s) for s in found["scores"].cpu()]
        if boxes:
            keep = regions.dedupe(boxes, scores, size=pil.size)
            keep.sort(key=lambda i: -scores[i])
            keep = keep[: regions.MAX_INSTANCES]
            boxes = [boxes[i] for i in keep]
            scores = [scores[i] for i in keep]
        # The same second pass the service runs. Without it this harness measures a detector the
        # product does not have, and a trolley is mostly produce.
        # One prompt or pairs, the same choice app.py documents. --produce-pairs is how the
        # 16, 13, 18 units against 10 real products in that comment were measured.
        prompts = regions.PRODUCE_PROMPTS if args.produce_pairs else (regions.PRODUCE_PROMPT,)
        produce_boxes, produce_scores = [], []
        for prompt in prompts:
            produce = proc(images=pil, text=prompt, return_tensors="pt").to(device)
            with torch.no_grad():
                produce_out = dino(**produce)
            produce_found = proc.post_process_grounded_object_detection(
                produce_out, produce.input_ids, threshold=regions.PRODUCE_THRESHOLD,
                text_threshold=regions.PRODUCE_THRESHOLD, target_sizes=[pil.size[::-1]],
            )[0]
            produce_boxes += [[float(v) for v in r] for r in produce_found["boxes"].cpu().numpy()]
            produce_scores += [float(s) for s in produce_found["scores"].cpu()]
        for i in regions.merge_produce(boxes, produce_boxes, produce_scores):
            if len(boxes) >= regions.MAX_INSTANCES:
                break
            boxes.append(produce_boxes[i])
            scores.append(produce_scores[i])

        normalized = [
            {"x": b[0] / width, "y": b[1] / height,
             "w": (b[2] - b[0]) / width, "h": (b[3] - b[1]) / height}
            for b in boxes
        ]
        matches = matcher.match_regions(pil, normalized) if normalized else []
        corners = [(b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]) for b in normalized]
        out.append({
            "segment": frame["segment"],
            "t": frame["t"],
            "order": frame["order"],
            "width": width,
            "height": height,
            "sharpness": frame["sharpness"],
            "motion": frame["motion"],
            "boxes": normalized,
            "scores": [regions.objectness(s, args.threshold) for s in scores],
            "catalog": [
                None if m is None else {
                    "sku": m["sku"],
                    "confidence": round(float(m["confidence"]), 6),
                    "alternatives": [a["sku"] for a in m["alternatives"]],
                }
                for m in matches
            ],
            "hidden": [
                round(hidden_fraction(
                    s, [o for j, o in enumerate(corners) if j != i and in_front(s, o)]
                ), 6)
                for i, s in enumerate(corners)
            ],
        })
        if (n + 1) % 20 == 0:
            rate = (n + 1) / (time.time() - started)
            print(f"  {n + 1}/{len(frames)} frames, {rate:.2f}/s, "
                  f"eta {(len(frames) - n - 1) / rate / 60:.1f}m")

    payload = {
        "video": entry.get("title", path.name),
        "licence": entry.get("licence"),
        "source_page": entry.get("source_page"),
        "detect_fps": DETECT_FPS,
        "threshold": args.threshold,
        "index": pathlib.Path(args.index).name,
        "seconds": round(time.time() - started, 1),
        "frames": out,
    }
    pathlib.Path(args.out).write_text(json.dumps(payload, indent=1))
    total = sum(len(f["boxes"]) for f in out)
    print(f"\n  frames               {len(out)}")
    print(f"  regions              {total}  ({total / max(len(out), 1):.1f} per frame)")
    print(f"  named                {sum(1 for f in out for c in f['catalog'] if c and c['sku'])}")
    print(f"  median sharpness     {sorted(f['sharpness'] for f in out)[len(out)//2]:.0f}")
    print(f"  median motion        {sorted(f['motion'] for f in out)[len(out)//2]:.4f}")
    print(f"\nwrote {args.out}")
    return payload


if __name__ == "__main__":
    main()
