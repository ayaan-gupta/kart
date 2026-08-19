"""
Extracts the catalog and query crops once, so reranker experiments are cheap.

Every measurement so far paid the same toll: decode nineteen RPC train shards, crop twenty
thousand instances, embed them, then throw all of it away. That is fifteen minutes before a
one-line change can be scored, which is the wrong iteration loop for a component whose whole
purpose is to be tuned.

This writes the crops to disk with their labels. `score_rerank.py` reads them and runs in
seconds. Nothing here decides anything, it only makes deciding fast.

Output lives under server/eval/.cache/ and is gitignored: 20k JPEGs is not repository content,
and RPC is CC BY-NC-SA 2.0 so the images must not be committed in any case.

    python3 server/eval/build_cache.py            # depth 100, all 19 shards
    python3 server/eval/build_cache.py --per-sku 20
"""
import argparse
import io
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).parent
CORPUS = HERE / "corpus"
CACHE = HERE / ".cache"
REPO = "benjamintli/retail-product-checkout"
TRAIN_SHARDS = [f"data/train-{i:05d}-of-00019.parquet" for i in range(19)]

# Matches score_catalog.py exactly. A cache that crops differently to the scorer it feeds is
# measuring a different pipeline than the one that ships.
MIN_CROP_PX = 24
CROP_PADDING = 0.08

# Long edge of a stored crop. 384 is above every encoder input used here (224 to 378) so no
# reranker is ever handed an upscaled image, and it leaves enough texture for keypoint matching,
# which degrades much faster with resolution than a ViT does.
STORE_PX = 384


def crop(image, box, width, height):
    pad_x, pad_y = box["w"] * CROP_PADDING, box["h"] * CROP_PADDING
    left = max(0, int((box["x"] - pad_x) * width))
    top = max(0, int((box["y"] - pad_y) * height))
    right = min(width, int((box["x"] + box["w"] + pad_x) * width))
    bottom = min(height, int((box["y"] + box["h"] + pad_y) * height))
    if right - left < MIN_CROP_PX or bottom - top < MIN_CROP_PX:
        return None
    return image.crop((left, top, right, bottom))


def store(image, path):
    scale = STORE_PX / max(image.size)
    if scale < 1:
        from PIL import Image

        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.LANCZOS,
        )
    image.save(path, "JPEG", quality=92)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-sku", type=int, default=100, help="catalog crops per SKU")
    parser.add_argument("--shards", type=int, default=19)
    args = parser.parse_args()

    truth = json.loads((CORPUS / "rpc-ground-truth.json").read_text())
    if not truth:
        sys.exit("no ground truth; run server/eval/corpus/fetch_rpc.py first")

    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download
    from PIL import Image

    catalog_dir = CACHE / "catalog"
    query_dir = CACHE / "queries"
    for d in (catalog_dir, query_dir):
        d.mkdir(parents=True, exist_ok=True)

    # ---- catalog -------------------------------------------------------------------------
    per_sku, catalog = {}, []
    for shard in TRAIN_SHARDS[: args.shards]:
        path = hf_hub_download(REPO, shard, repo_type="dataset")
        parquet = pq.ParquetFile(path)
        meta = json.loads(parquet.schema_arrow.metadata[b"huggingface"].decode())
        names = meta["info"]["features"]["objects"]["category"]["feature"]["names"]

        for batch in parquet.iter_batches(batch_size=32):
            for row in batch.to_pylist():
                categories = row["objects"]["category"]
                # The categories are readable without touching the image bytes. Skipping the
                # decode for a row whose SKUs are already full is the difference between a walk
                # of nineteen shards taking fifteen minutes and taking three.
                if all(per_sku.get(names[c], 0) >= args.per_sku for c in categories):
                    continue

                image = Image.open(io.BytesIO(row["image"]["bytes"])).convert("RGB")
                width, height = image.size
                for pixel_box, category in zip(row["objects"]["bbox"], categories):
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
                    store(piece, catalog_dir / f"{len(catalog):06d}.jpg")
                    catalog.append(name)
                    per_sku[name] = per_sku.get(name, 0) + 1
        full = sum(1 for v in per_sku.values() if v >= args.per_sku)
        print(f"  {shard}: {len(catalog)} crops, {len(per_sku)} SKUs, {full} full")

    # ---- queries -------------------------------------------------------------------------
    known = set(catalog)
    queries = []
    for key in sorted(truth):
        scene = truth[key]
        image = Image.open(CORPUS / "images" / f"{key}.jpg").convert("RGB")
        width, height = image.size
        for item in scene["items"]:
            if item["name"] not in known:
                continue
            piece = crop(image, item["box"], width, height)
            if piece is None:
                continue
            store(piece, query_dir / f"{len(queries):05d}.jpg")
            queries.append({"scene": key, "tier": scene["tier"], "label": item["name"]})

    (CACHE / "index.json").write_text(
        json.dumps(
            {"per_sku": args.per_sku, "catalog": catalog, "queries": queries},
            indent=1,
        )
    )
    print(f"\ncatalog: {len(catalog)} crops across {len(set(catalog))} SKUs")
    print(f"queries: {len(queries)} crops")
    print(f"cache:   {CACHE}")


if __name__ == "__main__":
    main()
