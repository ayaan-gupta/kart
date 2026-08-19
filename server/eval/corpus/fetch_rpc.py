"""
Builds an evaluation set of top-down cluttered product scenes with real box and name labels.

Why this dataset. Every accuracy number this project had before it came from five photographs
labelled with one hand-placed point per item. That measures whether the right number of things
were found. It cannot measure whether a box was placed correctly, whether the right product was
named, or whether a buried item was flagged as buried, because none of those labels existed.

RPC (Retail Product Checkout, arXiv:1901.07249) has all three. 30,000 overhead scenes at
1800x1800, a mean of about twelve products per scene, per-instance bounding boxes, and 200 SKU
labels. Scenes are stratified by clutter, and the hard tier is explicitly heavy stacking and
occlusion, which is the only occlusion ground truth available anywhere without shooting it.

What it is not. Products are laid on a white tray, not piled in a wire basket, so lighting is
even, the background is uniform, and nothing is wedged at the angles a real trolley produces.
Treat a number from this set as an upper bound on cart performance, not a prediction of it. It
is a far closer proxy than shelf imagery, which was measured and does not transfer at all
(see server/enumerator/README.md), and it is the only annotated top-down clutter available.

Licence. CC BY-NC-SA 2.0. Fine for measuring. Not fine for training anything that ships in a
commercial product, and that restriction is why the images are downloaded on demand rather
than committed: this script and the ground truth it writes are reproducible, the pixels stay
with their publisher.

    python3 server/eval/corpus/fetch_rpc.py --scenes 60
"""
import argparse
import io
import json
import pathlib

REPO = "benjamintli/retail-product-checkout"
# Shards are ordered by clutter. Shard 0 tops out at 11 objects per scene and holds only three
# scenes that dense, so filling the hard tier means walking further in. Each shard is about
# 340MB, so this stops as soon as every tier is full rather than pulling all eleven.
SHARDS = [f"data/test-{i:05d}-of-00011.parquet" for i in range(11)]
HERE = pathlib.Path(__file__).parent

# One scene per bucket boundary, matching RPC's own clutter tiers. Sampling evenly across them
# stops the number being dominated by whichever tier happens to be most common in the shard.
TIERS = {"easy": (1, 5), "medium": (6, 10), "hard": (11, 999)}


def normalize(box, width, height):
    """RPC ships pixel [x, y, w, h] with origin top-left, which is this codebase's convention
    already, so this only divides through by the frame."""
    x, y, w, h = box
    return {
        "x": round(x / width, 6),
        "y": round(y / height, 6),
        "w": round(w / width, 6),
        "h": round(h / height, 6),
    }


def tier_of(count):
    for name, (low, high) in TIERS.items():
        if low <= count <= high:
            return name
    return "hard"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenes", type=int, default=60, help="total scenes, split across tiers")
    parser.add_argument("--out", default=str(HERE / "images"))
    args = parser.parse_args()

    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download
    from PIL import Image

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    per_tier = max(1, args.scenes // len(TIERS))
    taken = {tier: 0 for tier in TIERS}
    truth = {}
    names = None
    used = []

    for shard in SHARDS:
        if all(taken[t] >= per_tier for t in TIERS):
            break

        path = hf_hub_download(REPO, shard, repo_type="dataset")
        parquet = pq.ParquetFile(path)
        if names is None:
            meta = json.loads(parquet.schema_arrow.metadata[b"huggingface"].decode())
            names = meta["info"]["features"]["objects"]["category"]["feature"]["names"]
        before = sum(taken.values())

        for batch in parquet.iter_batches(batch_size=64):
            if all(taken[t] >= per_tier for t in TIERS):
                break
            for row in batch.to_pylist():
                boxes = row["objects"]["bbox"]
                categories = row["objects"]["category"]
                tier = tier_of(len(boxes))
                if taken[tier] >= per_tier:
                    continue

                image = Image.open(io.BytesIO(row["image"]["bytes"])).convert("RGB")
                key = f"{tier}-{taken[tier]:03d}"
                image.save(out / f"{key}.jpg", quality=92)

                counts = {}
                for category in categories:
                    counts[names[category]] = counts.get(names[category], 0) + 1

                truth[key] = {
                    "tier": tier,
                    "width": image.width,
                    "height": image.height,
                    "items": [
                        {"name": names[c], "box": normalize(b, image.width, image.height)}
                        for b, c in zip(boxes, categories)
                    ],
                    # The counting answer, independent of where anything is. A pipeline can
                    # find every box and still report three yogurts as one, which is the
                    # failure that shipped, so counts are scored separately from boxes.
                    "counts": counts,
                }
                taken[tier] += 1

        gained = sum(taken.values()) - before
        used.append({"shard": shard, "scenes": gained})
        print(f"  {shard}: +{gained} scenes  ({', '.join(f'{t} {taken[t]}' for t in TIERS)})")

    (HERE / "rpc-ground-truth.json").write_text(json.dumps(truth, indent=1, sort_keys=True))
    (HERE / "rpc-manifest.json").write_text(
        json.dumps(
            {
                "source": f"https://huggingface.co/datasets/{REPO}",
                "shards": used,
                "upstream": "RPC: A Large-Scale Retail Product Checkout Dataset, arXiv:1901.07249",
                "project_page": "https://rpc-dataset.github.io/",
                "licence": "CC BY-NC-SA 2.0",
                "commercial_use": False,
                "scenes": len(truth),
                "instances": sum(len(v["items"]) for v in truth.values()),
                "classes": len(names),
            },
            indent=1,
        )
    )

    print(f"scenes: {len(truth)}  " + "  ".join(f"{t} {taken[t]}" for t in TIERS))
    print(f"instances: {sum(len(v['items']) for v in truth.values())}")
    print(f"images: {out}")
    print(f"labels: {HERE / 'rpc-ground-truth.json'}")


if __name__ == "__main__":
    main()
