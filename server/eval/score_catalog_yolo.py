"""
Scores catalog matching against a YOLO-format dataset.

This is the shape a store would actually hand over: a directory of photographs, a directory of
per-image label files, and a `data.yaml` naming the classes. Accepting that format directly
means a real store catalog can be measured the day it arrives, with no conversion step.

What it measures is the closed-world half of the design. Given a crop and a catalog of every
product the store sells, is the right product in the top five, and is it first. The gap between
those two numbers is the entire argument for putting a reranker after the embedding lookup, so
it is reported explicitly.

Catalog and queries come from the train and valid splits respectively, so no image is in both.

    python3 server/eval/score_catalog_yolo.py ~/Downloads/grocer-help --per-class 12

A note on what this data can and cannot say. Shelf photographs are not carts: products stand
upright, front-facing, gravity-aligned, in regular rows, against a shelf. A detector trained on
shelves scored 14% usable recall on cart photographs (server/enumerator/README.md), so nothing
here should be read as a detection result for this product. Naming is a different question. A
crop of a packet of Maggi is a crop of a packet of Maggi whether it came off a shelf or out of a
trolley, so for the catalog half this transfers, and 647 real brand names make it a better
naming benchmark than any generic category taxonomy.
"""
import argparse
import pathlib
import random
import re
import sys

MIN_CROP_PX = 24
CROP_PADDING = 0.08


def load_classes(root):
    """Reads the `names:` list out of data.yaml without requiring a yaml dependency."""
    text = (root / "data.yaml").read_text()
    start = text.index("names:")
    body = text[start + len("names:") :]
    body = body[body.index("[") + 1 : body.index("]")]
    return [piece.strip().strip("'\"") for piece in body.split(",")]


def read_label(path):
    """YOLO rows: class cx cy w h, all normalized. Returns (class, box) pairs."""
    rows = []
    try:
        for line in path.read_text().splitlines():
            parts = line.split()
            if len(parts) < 5:
                continue
            index = int(float(parts[0]))
            cx, cy, w, h = (float(v) for v in parts[1:5])
            rows.append((index, {"x": cx - w / 2, "y": cy - h / 2, "w": w, "h": h}))
    except FileNotFoundError:
        pass
    return rows


def crop(image, box):
    width, height = image.size
    pad_x, pad_y = box["w"] * CROP_PADDING, box["h"] * CROP_PADDING
    left = max(0, int((box["x"] - pad_x) * width))
    top = max(0, int((box["y"] - pad_y) * height))
    right = min(width, int((box["x"] + box["w"] + pad_x) * width))
    bottom = min(height, int((box["y"] + box["h"] + pad_y) * height))
    if right - left < MIN_CROP_PX or bottom - top < MIN_CROP_PX:
        return None
    return image.crop((left, top, right, bottom))


def harvest(root, split, classes, per_class, limit_images, seed=11):
    """Collects up to `per_class` crops for each class, walking images in a fixed order."""
    from PIL import Image

    images = sorted((root / split / "images").glob("*.jpg"))
    random.Random(seed).shuffle(images)
    if limit_images:
        images = images[:limit_images]

    taken = {}
    pieces, labels = [], []
    for path in images:
        rows = read_label(root / split / "labels" / f"{path.stem}.txt")
        rows = [r for r in rows if taken.get(r[0], 0) < per_class]
        if not rows:
            continue
        try:
            image = Image.open(path).convert("RGB")
        except Exception:
            continue
        for index, box in rows:
            piece = crop(image, box)
            if piece is None:
                continue
            pieces.append(piece)
            labels.append(classes[index] if index < len(classes) else str(index))
            taken[index] = taken.get(index, 0) + 1
    return pieces, labels


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", help="dataset root containing data.yaml, train/, valid/")
    parser.add_argument("--model", default="MobileCLIP-S2")
    parser.add_argument("--pretrained", default="datacompdr")
    parser.add_argument("--per-class", type=int, default=12, help="catalog crops per class")
    parser.add_argument("--query-per-class", type=int, default=4)
    parser.add_argument("--limit-images", type=int, default=2500)
    args = parser.parse_args()

    root = pathlib.Path(args.root).expanduser()
    if not (root / "data.yaml").exists():
        sys.exit(f"no data.yaml under {root}")

    import open_clip
    import torch

    classes = load_classes(root)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model, _, preprocess = open_clip.create_model_and_transforms(
        args.model, pretrained=args.pretrained
    )
    model = model.to(device).eval()
    print(f"device: {device}   model: {args.model}/{args.pretrained}   classes: {len(classes)}")

    def embed(images, batch_size=64):
        out = []
        for start in range(0, len(images), batch_size):
            batch = torch.stack(
                [preprocess(i) for i in images[start : start + batch_size]]
            ).to(device)
            with torch.no_grad():
                vectors = model.encode_image(batch)
            out.append(torch.nn.functional.normalize(vectors, dim=-1).cpu())
        return torch.cat(out)

    catalog_pieces, catalog_labels = harvest(
        root, "train", classes, args.per_class, args.limit_images
    )
    print(f"catalog: {len(catalog_pieces)} crops, {len(set(catalog_labels))} classes")
    catalog = embed(catalog_pieces).to(device)
    del catalog_pieces

    query_pieces, query_labels = harvest(
        root, "valid", classes, args.query_per_class, args.limit_images, seed=29
    )
    known = set(catalog_labels)
    keep = [i for i, label in enumerate(query_labels) if label in known]
    query_pieces = [query_pieces[i] for i in keep]
    query_labels = [query_labels[i] for i in keep]
    print(f"queries: {len(query_pieces)} crops, {len(set(query_labels))} classes\n")
    if not query_pieces:
        sys.exit("no queries with a catalog entry")

    queries = embed(query_pieces).to(device)
    similarity = queries @ catalog.T

    def tokens(label):
        """Splits a label into its parts, lowercased.

        The taxonomy in a hand-annotated set is rarely consistent. This one carries a bare
        brand ('Amul'), a bare product type ('Butter'), and their combination ('Butter_Amul')
        as three separate classes, so one physical tub of Amul butter is labelled differently
        depending on which image it appears in. Strict scoring counts a correct retrieval as
        wrong whenever the two images happened to be labelled differently.
        """
        return {piece for piece in re.split(r"[_\-\s]+", label.lower()) if piece}

    top1 = top5 = lenient1 = 0
    for row, want in zip(similarity, query_labels):
        # Best crop per class, then rank classes, so a class with more catalog crops cannot
        # crowd the shortlist by volume alone.
        best = {}
        for index in torch.argsort(row, descending=True)[:600].tolist():
            name = catalog_labels[index]
            if name not in best:
                best[name] = float(row[index])
            if len(best) >= 5:
                break
        ranked = sorted(best, key=lambda n: -best[n])
        top1 += ranked[:1] == [want]
        top5 += want in ranked[:5]
        # Lenient: the top answer shares a word with the truth, so "Amul" matching
        # "Butter_Amul" counts. The distance between this and top1 is label inconsistency,
        # not model error.
        lenient1 += bool(ranked and tokens(ranked[0]) & tokens(want))

    n = len(query_labels)
    print(f"{'crops':>8}{'classes':>9}{'Recall@1':>11}{'Recall@5':>11}{'gap':>8}")
    print("-" * 47)
    print(
        f"{n:>8}{len(set(catalog_labels)):>9}{top1 / n:>10.0%}{top5 / n:>11.0%}"
        f"{(top5 - top1) / n:>7.0%}"
    )
    print(f"\nstrict Recall@1 {top1 / n:.0%}   token-overlap Recall@1 {lenient1 / n:.0%}")
    print("The distance between those two is inconsistent labelling, not retrieval error.")
    print("\nThe gap is what a reranker recovers. Published comparable on 409 grocery SKUs:")
    print("77% and 94.5%, a gap of 17.5 points (arXiv:2605.18029).")


if __name__ == "__main__":
    main()
