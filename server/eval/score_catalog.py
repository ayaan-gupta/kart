"""
Superseded. Kept because it produced the nearest-neighbour baseline every later number is
compared against, and rerunning it reproduces that baseline.

What it measures is a lookup: embed the crop, embed the catalog, take the nearest. That is what
shipped and it scores 65.2%. `build_cache.py` followed by `score_probe.py` measures the same
question with a head trained on the catalog and scores 84.3%, and `score_rerank.py` with
`fuse_rerank.py` adds the reranker. Use those for anything new. This one also re-decodes
nineteen parquet shards on every run, which the cache exists to avoid.

Scores the closed-world half of the architecture: given a crop and the store's catalog, is the
right product in the shortlist, and is it first.

The design assumes a deployment has the store's complete product catalog, which makes naming a
retrieval problem over a known set rather than open-world description. That is a much easier
question, and it is the one worth measuring, because measuring open-world naming understates
what the shipped product does.

Published work on this exact task (arXiv:2605.18029, 190 open-source models on 409 grocery
SKUs) reports a gap that decides the architecture: the best model reaches 0.770 Recall@1 but
0.945 Recall@5. Embeddings narrow the field brilliantly and rank the finalists poorly. That is
why the design is a shortlist followed by a reranker rather than a single nearest-neighbour
lookup, and this script exists to check that the same gap appears on this data before anything
is built on it.

Catalog and queries come from disjoint RPC splits. The catalog is built by cropping labelled
instances out of train scenes, which is the honest analogue of a store handing over product
photographs. Queries are crops from the 60 committed test scenes. No image appears in both.

    python3 server/eval/score_catalog.py --model MobileCLIP-S2 --per-sku 30
"""
import argparse
import io
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
CORPUS = HERE / "corpus"
REPO = "benjamintli/retail-product-checkout"
TRAIN_SHARDS = [f"data/train-{i:05d}-of-00019.parquet" for i in range(19)]

# A crop this small carries no legible brand mark and scoring it measures nothing but noise.
MIN_CROP_PX = 24
# Matches recognize.ts, which pads crops before sending them to be named. A tight crop with the
# logo clipped is measurably harder than the same crop with a little context around it.
CROP_PADDING = 0.08


def crop(image, box, width, height):
    pad_x, pad_y = box["w"] * CROP_PADDING, box["h"] * CROP_PADDING
    left = max(0, int((box["x"] - pad_x) * width))
    top = max(0, int((box["y"] - pad_y) * height))
    right = min(width, int((box["x"] + box["w"] + pad_x) * width))
    bottom = min(height, int((box["y"] + box["h"] + pad_y) * height))
    if right - left < MIN_CROP_PX or bottom - top < MIN_CROP_PX:
        return None
    return image.crop((left, top, right, bottom))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="MobileCLIP-S2")
    parser.add_argument("--pretrained", default="datacompdr")
    parser.add_argument("--per-sku", type=int, default=30, help="catalog crops per SKU")
    # All nineteen by default. Train shards are ordered by SKU, so a partial walk yields a
    # partial catalog: three shards covered 35 of 200 SKUs and left 414 of 465 test crops with
    # nothing to match against, which scores an easier problem than the one being built.
    parser.add_argument("--shards", type=int, default=19, help="train shards to mine")
    args = parser.parse_args()

    truth = json.loads((CORPUS / "rpc-ground-truth.json").read_text())
    if not truth:
        sys.exit("no ground truth; run server/eval/corpus/fetch_rpc.py first")

    import open_clip
    import pyarrow.parquet as pq
    import torch
    from huggingface_hub import hf_hub_download
    from PIL import Image

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model, _, preprocess = open_clip.create_model_and_transforms(
        args.model, pretrained=args.pretrained
    )
    model = model.to(device).eval()
    print(f"device: {device}   model: {args.model}/{args.pretrained}")

    def embed(images):
        """L2-normalized image embeddings, so cosine similarity is a dot product."""
        batch = torch.stack([preprocess(i) for i in images]).to(device)
        with torch.no_grad():
            vectors = model.encode_image(batch)
        return torch.nn.functional.normalize(vectors, dim=-1)

    # ---- catalog, mined from train scenes -----------------------------------------------
    catalog_vectors, catalog_labels = [], []
    per_sku = {}
    for shard in TRAIN_SHARDS[: args.shards]:
        path = hf_hub_download(REPO, shard, repo_type="dataset")
        parquet = pq.ParquetFile(path)
        meta = json.loads(parquet.schema_arrow.metadata[b"huggingface"].decode())
        names = meta["info"]["features"]["objects"]["category"]["feature"]["names"]

        pending, pending_labels = [], []
        for batch in parquet.iter_batches(batch_size=32):
            for row in batch.to_pylist():
                image = Image.open(io.BytesIO(row["image"]["bytes"])).convert("RGB")
                width, height = image.size
                for pixel_box, category in zip(
                    row["objects"]["bbox"], row["objects"]["category"]
                ):
                    name = names[category]
                    if per_sku.get(name, 0) >= args.per_sku:
                        continue
                    box = {
                        "x": pixel_box[0] / width,
                        "y": pixel_box[1] / height,
                        "w": pixel_box[2] / width,
                        "h": pixel_box[3] / height,
                    }
                    piece = crop(image, box, width, height)
                    if piece is None:
                        continue
                    pending.append(piece)
                    pending_labels.append(name)
                    per_sku[name] = per_sku.get(name, 0) + 1

                    if len(pending) >= 64:
                        catalog_vectors.append(embed(pending).cpu())
                        catalog_labels.extend(pending_labels)
                        pending, pending_labels = [], []
        if pending:
            catalog_vectors.append(embed(pending).cpu())
            catalog_labels.extend(pending_labels)
        print(f"  {shard}: catalog now {len(catalog_labels)} crops, {len(per_sku)} SKUs")

    catalog = torch.cat(catalog_vectors).to(device)
    label_list = sorted(set(catalog_labels))
    print(f"catalog: {len(catalog_labels)} crops across {len(label_list)} SKUs\n")

    # ---- queries, from the committed test scenes ----------------------------------------
    tiers = {}
    for key in sorted(truth):
        scene = truth[key]
        image = Image.open(CORPUS / "images" / f"{key}.jpg").convert("RGB")
        width, height = image.size

        pieces, wanted = [], []
        for item in scene["items"]:
            piece = crop(image, item["box"], width, height)
            if piece is None or item["name"] not in label_list:
                continue
            pieces.append(piece)
            wanted.append(item["name"])
        if not pieces:
            continue

        similarity = embed(pieces) @ catalog.T
        bucket = tiers.setdefault(scene["tier"], {"n": 0, "top1": 0, "top5": 0})

        for row, want in zip(similarity, wanted):
            # Best crop per SKU, then rank SKUs. A SKU with forty catalog crops must not
            # outrank one with three purely by filling the top of the list.
            best = {}
            order = torch.argsort(row, descending=True)
            for index in order[:400].tolist():
                name = catalog_labels[index]
                if name not in best:
                    best[name] = float(row[index])
                if len(best) >= 5:
                    break
            ranked = sorted(best, key=lambda n: -best[n])
            bucket["n"] += 1
            bucket["top1"] += ranked[:1] == [want]
            bucket["top5"] += want in ranked[:5]

    header = f"{'tier':8}{'crops':>8}{'Recall@1':>11}{'Recall@5':>11}{'gap':>8}"
    print(header)
    print("-" * len(header))
    total = {"n": 0, "top1": 0, "top5": 0}
    for tier in ("easy", "medium", "hard"):
        b = tiers.get(tier)
        if not b or not b["n"]:
            continue
        r1, r5 = b["top1"] / b["n"], b["top5"] / b["n"]
        print(f"{tier:8}{b['n']:>8}{r1:>10.0%}{r5:>11.0%}{r5 - r1:>7.0%}")
        for k in total:
            total[k] += b[k]

    r1, r5 = total["top1"] / total["n"], total["top5"] / total["n"]
    print("-" * len(header))
    print(f"{'ALL':8}{total['n']:>8}{r1:>10.0%}{r5:>11.0%}{r5 - r1:>7.0%}")
    print(
        f"\nThe gap is what the reranker recovers. Published comparable: 77% and 94.5%, "
        f"gap 17.5 points."
    )

    (HERE / "catalog-score.json").write_text(
        json.dumps(
            {"model": f"{args.model}/{args.pretrained}", "per_sku": args.per_sku,
             "catalog_crops": len(catalog_labels), "skus": len(label_list), "tiers": tiers},
            indent=1,
        )
    )


if __name__ == "__main__":
    main()
