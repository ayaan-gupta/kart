"""
End-to-end check of the shipped matcher on real product photographs.

The unit tests in server/catalog stub the encoders, deliberately: downloading a four hundred
megabyte model to assert that a shortlist is sorted would be a worse test. But that leaves the
path a deployment actually takes untested, which is build an index from a directory of images,
write it to disk, load it back in a fresh object, and name a crop. Every one of those steps can
fail in a way that produces plausible output rather than an exception.

This builds a small real index out of the eval cache, in the directory layout a store would
supply, and names crops from the test scenes with it. It is a check that the wiring works on
real pixels, not a measurement: the catalog is a handful of SKUs, so the accuracy it prints is
not comparable to anything in CATALOG.md. `score_rerank.py` is the measurement.

    python3 server/eval/build_cache.py     # once
    python3 server/eval/verify_matcher.py
"""
import argparse
import json
import pathlib
import shutil
import sys
import tempfile

HERE = pathlib.Path(__file__).parent
CACHE = HERE / ".cache"
sys.path.insert(0, str(HERE.parent))

from catalog.matcher import Index, Matcher  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--encoder", default="siglipb16")
    parser.add_argument("--skus", type=int, default=8)
    parser.add_argument("--per-sku", type=int, default=15)
    args = parser.parse_args()

    if not (CACHE / "index.json").exists():
        sys.exit("no cache; run server/eval/build_cache.py first")
    meta = json.loads((CACHE / "index.json").read_text())

    from PIL import Image

    catalog_paths = sorted((CACHE / "catalog").glob("*.jpg"))
    query_paths = sorted((CACHE / "queries").glob("*.jpg"))

    by_sku = {}
    for i, name in enumerate(meta["catalog"]):
        by_sku.setdefault(name, []).append(i)
    chosen = sorted(by_sku)[: args.skus]

    root = pathlib.Path(tempfile.mkdtemp(prefix="verify-matcher-"))
    try:
        # The layout a store hands over: one directory per product, its photographs inside.
        for sku in chosen:
            folder = root / sku
            folder.mkdir(parents=True)
            for n, crop in enumerate(by_sku[sku][: args.per_sku]):
                shutil.copyfile(catalog_paths[crop], folder / f"{n:03d}.jpg")

        print(f"building an index over {len(chosen)} SKUs from {root}")
        index = Index.build(root, encoder=args.encoder)
        index.save(root / "index.npz")
        # Loaded back rather than reused, so anything the save path drops shows up here.
        matcher = Matcher(Index.load(root / "index.npz"))

        wanted, images = [], []
        for i, query in enumerate(meta["queries"]):
            if query["label"] in set(chosen):
                wanted.append(query["label"])
                images.append(Image.open(query_paths[i]).convert("RGB"))
        if not images:
            sys.exit("no test crop belongs to the sampled SKUs; raise --skus")

        results = matcher.match(images)
        named = sum(r["sku"] is not None for r in results)
        right = sum(r["sku"] == w for r, w in zip(results, wanted))
        in_shortlist = sum(
            w in [a["sku"] for a in r["alternatives"]] for r, w in zip(results, wanted)
        )
        print(f"\n{len(images)} crops from the test scenes")
        print(f"  named rather than deferred: {named}")
        print(f"  named correctly:            {right}")
        print(f"  truth among the three shown:{in_shortlist}")
        print(f"\nexample: {json.dumps(results[0], indent=1)}")

        assert len(results) == len(images), "one result per crop"
        assert all(0.0 <= r["confidence"] <= 1.0 for r in results), "confidence is a probability"
        assert all(r["alternatives"] for r in results), "alternatives are always offered"
        assert all(
            r["sku"] is None or r["sku"] == r["alternatives"][0]["sku"] for r in results
        ), "the named SKU is the top alternative"
        print("\nwiring checks passed. This is not a measurement; see CATALOG.md for those.")
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    main()
