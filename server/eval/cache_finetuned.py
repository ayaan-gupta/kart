"""
Fine-tunes the encoder once and caches its embeddings, so the reranker can be measured on top.

score_finetune.py answers whether fine-tuning beats a frozen encoder and stops there, because
what it varies is the epoch count. The remaining question is whether the reranker still earns
its place once the encoder underneath it is stronger: a reranker exists to recover the gap
between first choice and top five, and fine-tuning shrinks that gap from 12.3 points to
10.7. It does still earn it: 86.5% to 88.0% overall, and +2.2 on the stacked scenes.

Writing the embeddings under their own tag means every existing script works unchanged, since
they read the cache before they consult the encoder registry.

    python3 server/eval/cache_finetuned.py
    python3 server/eval/score_rerank.py --encoder siglipb16ft
    python3 server/eval/fuse_rerank.py

One epoch, which is not a free parameter here: score_finetune.py measured four with the
stopping point chosen on scenes it never scored, and one was best on both sides of that split.
Worth stating plainly that those validation scenes are among the 465 queries scored downstream,
so the epoch count carries one bit of information from a third of them. The clean
frozen-against-fine-tuned comparison is the one in CATALOG.md, on the forty test scenes.
"""
import argparse
import json
import pathlib
import sys

import numpy as np

HERE = pathlib.Path(__file__).parent
CACHE = HERE / ".cache"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

from catalog import encode, finetune, head as head_module  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--encoder", default="siglipb16")
    parser.add_argument("--tag", default="siglipb16ft")
    parser.add_argument("--epochs", type=int, default=finetune.EPOCHS)
    args = parser.parse_args()

    import torch
    from PIL import Image

    from rerank_features import features

    meta = json.loads((CACHE / "index.json").read_text())
    sku_names = sorted(set(meta["catalog"]))
    labels = np.array([sku_names.index(n) for n in meta["catalog"]])
    catalog_paths = sorted((CACHE / "catalog").glob("*.jpg"))
    query_paths = sorted((CACHE / "queries").glob("*.jpg"))

    frozen, _ = features(args.encoder, CACHE)
    print(f"fine-tuning {args.encoder} for {args.epochs} epoch(s) on {len(catalog_paths)} crops")
    visual, _ = finetune.train(
        catalog_paths, labels, len(sku_names), args.encoder,
        head_module.prototypes(frozen, labels, len(sku_names)),
        epochs=args.epochs, log=lambda m: print(m, flush=True),
    )

    preprocess, _ = encode.open_clip_visual(args.encoder)
    device = encode.device()

    def embed(paths):
        out = []
        for start in range(0, len(paths), encode.BATCH):
            images = [
                preprocess(Image.open(p).convert("RGB"))
                for p in paths[start : start + encode.BATCH]
            ]
            with torch.no_grad():
                vectors = visual(torch.stack(images).to(device)).float()
            out.append(torch.nn.functional.normalize(vectors, dim=-1).cpu().numpy())
            if start % (encode.BATCH * 20) == 0:
                print(f"    {start + len(images)}/{len(paths)}", flush=True)
        return np.concatenate(out).astype(np.float32)

    np.save(CACHE / f"emb-{args.tag}-catalog.npy", embed(catalog_paths))
    np.save(CACHE / f"emb-{args.tag}-query.npy", embed(query_paths))
    print(f"\ncached as {args.tag}; score_rerank.py --encoder {args.tag} now works unchanged.")


if __name__ == "__main__":
    main()
