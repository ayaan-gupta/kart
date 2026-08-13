"""Detector spike: how many distinct cart items does YOLOE-seg actually find?

Runs two configurations over the eval corpus and reports per-image instance counts
so they can be compared against ground truth by hand.

  1. prompt-free  : YOLOE's internal LVIS/Objects365 vocabulary, no prompts
  2. text-prompt  : a fixed grocery vocabulary

Usage:  python run.py ../../server/eval/corpus/images
"""

import sys
from pathlib import Path

from ultralytics import YOLOE

GROCERY_VOCAB = [
    "cereal box", "milk jug", "milk carton", "egg carton", "bread loaf",
    "bag of chips", "soda bottle", "water bottle", "juice carton", "yogurt cup",
    "banana", "apple", "orange", "tomato", "onion", "potato", "lettuce",
    "canned food", "jar", "box of pasta", "bag of rice", "meat package",
    "cheese block", "frozen food bag", "paper towel roll", "detergent bottle",
    "snack bar box", "coffee bag", "shopping cart",
]

CONF = 0.15  # deliberately low: we want recall here, the VLM filters later


def main(image_dir: str) -> None:
    images = sorted(
        p for p in Path(image_dir).iterdir()
        if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".heic"}
    )
    if not images:
        print(f"No images found in {image_dir}")
        sys.exit(1)

    print(f"{len(images)} images\n")

    print("=== prompt-free (internal vocabulary) ===")
    pf = YOLOE("yoloe-11l-seg-pf.pt")
    for img in images:
        r = pf.predict(str(img), conf=CONF, verbose=False)[0]
        n = 0 if r.masks is None else len(r.masks)
        print(f"  {img.name}: {n} instances")

    print("\n=== text-prompt (grocery vocabulary) ===")
    tp = YOLOE("yoloe-11l-seg.pt")
    tp.set_classes(GROCERY_VOCAB, tp.get_text_pe(GROCERY_VOCAB))
    for img in images:
        r = tp.predict(str(img), conf=CONF, verbose=False)[0]
        n = 0 if r.masks is None else len(r.masks)
        print(f"  {img.name}: {n} instances")
        r.save(filename=f"out_{img.stem}_textprompt.jpg")

    print("\nAnnotated images written as out_*.jpg. Inspect them by eye:")
    print("  - Is each physical item its own mask, or are several merged?")
    print("  - Is one item split into several masks?")
    print("  - Are masks tight to the silhouette?")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "../../server/eval/corpus/images")
