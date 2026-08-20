"""
Why does the detector find a third of what is on a shelf?

`score_grocer_detection.py` measures one configuration. This runs several, because the first
result (35.3% recall at the shipped threshold) is low enough that the question is not "which
threshold" but "what is the binding constraint": the model's proposals, the de-duplication that
follows them, or the resolution the photograph is shrunk to before the model ever sees it.

A 12-megapixel shelf photograph resized to 1333px on its long edge turns an 80-pixel packet into
a 26-pixel one, which is smaller than the patch grid the detector reasons over. If that is the
constraint, no threshold recovers it.

    server/.venv/bin/python server/eval/sweep_grocer_detection.py --scenes 25
"""
import argparse
import itertools
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))

import score_grocer_detection as detection  # noqa: E402

SIDES = (1333, 2000, 2800)
THRESHOLDS = (0.12, 0.23)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenes", type=int, default=25)
    parser.add_argument("--sides", default=",".join(str(s) for s in SIDES))
    parser.add_argument("--thresholds", default=",".join(str(t) for t in THRESHOLDS))
    args = parser.parse_args(argv)

    sides = [int(s) for s in args.sides.split(",")]
    thresholds = [float(t) for t in args.thresholds.split(",")]
    rows = []
    for side, threshold in itertools.product(sides, thresholds):
        print(f"\n===== max-side {side}, threshold {threshold} =====")
        summary = detection.main([
            "--scenes", str(args.scenes),
            "--max-side", str(side),
            "--threshold", str(threshold),
        ])
        rows.append((side, threshold, summary))

    print("\n  long edge  threshold   raw/scene   kept/scene   recall   precision floor")
    for side, threshold, s in rows:
        raw = s["raw_proposals"] / s["scenes"]
        kept = s["proposals"] / s["scenes"]
        print(f"  {side:9d}  {threshold:9.2f}   {raw:9.1f}   {kept:10.1f}   "
              f"{s['recall']:6.1%}   {s['precision_floor']:14.1%}")
    return rows


if __name__ == "__main__":
    main()
