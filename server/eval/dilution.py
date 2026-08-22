"""How much a phrase loses by sharing a prompt.

`app.py` already records that adding produce phrases to the grocery prompt cost eight to ten
points of shelf recall, "because extra phrases dilute the working ones rather than adding to
them". The produce prompt is itself 28 phrases, and the same argument applies inside it: on the
ten-product trolley it proposes nothing at all at the shipped threshold, while "tomatoes." alone
finds the tomatoes on the vine at 0.32.

This measures the curve rather than assuming it. For a known object on a known frame, the peak
score of a box overlapping it is taken with the phrase alone, then with 1, 3, 7, 15 and 27
companions drawn from the same produce list, so the fall is a number and any correction to the
threshold is a measurement rather than a guess.

    ../.venv/bin/python dilution.py
"""
import argparse
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
CACHE = HERE / ".cache" / "kart"
sys.path.insert(0, str(HERE.parent))

# Object, frame, and roughly where it is, normalized. Hand-read off the photographs, and used
# only to ask "did anything land here", never to score naming.
SUBJECTS = [
    ("tomatoes", "IMG_0252", (0.38, 0.44, 0.18, 0.17)),
    ("cauliflower", "IMG_0252", (0.57, 0.68, 0.24, 0.19)),
    ("brussels sprouts", "IMG_0252", (0.40, 0.64, 0.21, 0.21)),
    ("apples", "IMG_0252", (0.51, 0.44, 0.33, 0.25)),
    ("cauliflower", "IMG_0249", None),
    ("asparagus", "IMG_0254", None),
]
COMPANIONS = [1, 3, 7, 15, 27]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(HERE / "kart-dilution.json"))
    args = parser.parse_args(argv)

    import torch
    from PIL import Image, ImageOps
    from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection

    from enumerator import regions

    nouns = [n.strip() for n in regions.PRODUCE_PROMPT.split(".") if n.strip()]
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    proc = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-base")
    dino = AutoModelForZeroShotObjectDetection.from_pretrained(
        "IDEA-Research/grounding-dino-base").to(device)

    images = {}

    def frame(pid):
        if pid not in images:
            pil = ImageOps.exif_transpose(
                Image.open(CACHE / "images" / f"{pid}.jpg")).convert("RGB")
            pil.thumbnail((1333, 1333))
            images[pid] = pil
        return images[pid]

    def ground(pil, text, cut=0.05):
        inputs = proc(images=pil, text=text, return_tensors="pt").to(device)
        with torch.no_grad():
            out = dino(**inputs)
        f = proc.post_process_grounded_object_detection(
            out, inputs.input_ids, threshold=cut, text_threshold=cut,
            target_sizes=[pil.size[::-1]])[0]
        return ([[float(v) for v in r] for r in f["boxes"].cpu().numpy()],
                [float(s) for s in f["scores"].cpu()])

    def peak(pil, text, where):
        boxes, scores = ground(pil, text)
        if not boxes:
            return 0.0
        if where is None:
            return max(scores)
        W, H = pil.size
        target = [where[0] * W, where[1] * H,
                  (where[0] + where[2]) * W, (where[1] + where[3]) * H]
        best = 0.0
        for box, score in zip(boxes, scores):
            if regions._iou(box, target) >= 0.3 and score > best:
                best = score
        return best

    rows = []
    for noun, pid, where in SUBJECTS:
        pil = frame(pid)
        others = [n for n in nouns if n != noun]
        line = {"noun": noun, "frame": pid, "scores": {}}
        alone = peak(pil, f"{noun}.", where)
        line["scores"]["1"] = round(alone, 4)
        for k in COMPANIONS:
            text = ". ".join([noun] + others[:k]) + "."
            line["scores"][str(k + 1)] = round(peak(pil, text, where), 4)
        rows.append(line)
        shown = "  ".join(f"{n}:{v:.2f}" for n, v in line["scores"].items())
        print(f"  {noun:<18} on {pid}   {shown}")

    print("\n  phrases in the prompt, and the score the subject keeps")
    print(f"  the shipped produce prompt has {len(nouns)} phrases and a threshold of "
          f"{regions.PRODUCE_THRESHOLD}")
    pathlib.Path(args.out).write_text(json.dumps(rows, indent=1))
    print(f"  wrote {args.out}")


if __name__ == "__main__":
    main()
