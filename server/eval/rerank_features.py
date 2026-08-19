"""
Disk-cached features for the eval harness.

The encoders themselves live in server/catalog/encode.py, which is what deploys. This file adds
only the caching: a twenty-thousand image pass takes minutes and every experiment downstream
wants the same matrices, so they are computed once and read back as .npy.

    from rerank_features import features
    catalog, queries = features("mobileclip", cache_dir)
"""
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from catalog.encode import BATCH, ENCODERS, device, load  # noqa: E402


def _embed_paths(paths, prepare, encode):
    import torch
    from concurrent.futures import ThreadPoolExecutor

    from PIL import Image

    def read(path):
        return Image.open(path).convert("RGB")

    out = []
    # JPEG decode releases the interpreter lock, so loading the next batch while the current one
    # is on the GPU is nearly free and roughly halves a twenty-thousand image pass.
    with ThreadPoolExecutor(max_workers=8) as pool:
        for start in range(0, len(paths), BATCH):
            images = list(pool.map(read, paths[start : start + BATCH]))
            batch = prepare(images).to(device())
            vectors = encode(batch).float()
            out.append(torch.nn.functional.normalize(vectors, dim=-1).cpu().numpy())
            if start % (BATCH * 20) == 0:
                print(f"    {start + len(images)}/{len(paths)}", flush=True)
    return np.concatenate(out).astype(np.float32)


def features(name, cache):
    """Returns (catalog, queries) as L2-normalized float32 matrices, computing them if absent."""
    cache = pathlib.Path(cache)
    catalog_path = cache / f"emb-{name}-catalog.npy"
    query_path = cache / f"emb-{name}-query.npy"
    if catalog_path.exists() and query_path.exists():
        return np.load(catalog_path), np.load(query_path)
    if name not in ENCODERS:
        raise SystemExit(f"unknown encoder {name}; have {sorted(ENCODERS)}")

    print(f"  embedding with {ENCODERS[name][1] or name} on {device()}", flush=True)
    prepare, encode = load(name)
    catalog = _embed_paths(sorted((cache / "catalog").glob("*.jpg")), prepare, encode)
    queries = _embed_paths(sorted((cache / "queries").glob("*.jpg")), prepare, encode)
    np.save(catalog_path, catalog)
    np.save(query_path, queries)
    return catalog, queries
