"""
What does fine-tuning the encoder on the catalog buy over a head on top of a frozen one?

The head in score_probe.py learns where the boundary between two SKUs lies inside a feature
space it cannot change. If two of a store's products are near-identical to a frozen encoder, no
linear boundary separates them. Fine-tuning moves the features themselves, which is the full
version of "a model fine-tuned for that store", and by far the most expensive thing measured
here: minutes becomes tens of minutes per epoch, and it must be rerun when the catalog changes
rather than refitted in seconds. So the question is not only whether it wins but by enough.

The training loop lives in server/catalog/finetune.py, which is what deploys. This file only
supplies the queries and prints the table.

Protocol. The first run of this fixed three epochs in advance and printed all of them, and the
result was awkward: accuracy peaks after one epoch and falls after that, while the training loss
keeps dropping and held-out catalog accuracy sits above 99% throughout. So the encoder overfits
away from cart scenes towards the clean single-product exemplars it is trained on, and nothing in
the data a store possesses would reveal it. Reporting the best epoch would be choosing on the
test set; reporting the last would understate a real effect by two points.

The fix is a validation set drawn from the same place as the test set. Scenes are split, never
queries, because two crops from one photograph share lighting, camera and often the product. The
epoch is chosen on the validation scenes and reported on the test scenes, which no part of
training or selection has seen. That also states the deployment requirement plainly: a store
cannot get this gain from product photographs alone, it has to label a few carts.

    python3 server/eval/score_finetune.py --encoder siglipb16 --epochs 3
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

TIERS = ("easy", "medium", "hard")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--encoder", default="siglipb16")
    parser.add_argument("--epochs", type=int, default=finetune.EPOCHS)
    parser.add_argument("--batch", type=int, default=finetune.BATCH)
    # Loading in the main process by default. Worker subprocesses get swept up by process-group
    # cleanup on this machine, and a backward pass dominates JPEG decode anyway, so the
    # parallelism buys little and costs a run that dies an hour in.
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument(
        "--validation-scenes",
        type=int,
        default=20,
        help="scenes used to choose the epoch; the rest are the test set. 0 disables selection",
    )
    args = parser.parse_args()

    import torch
    from PIL import Image

    from rerank_features import features

    meta = json.loads((CACHE / "index.json").read_text())
    sku_names = sorted(set(meta["catalog"]))
    sku_id = {n: i for i, n in enumerate(sku_names)}
    labels = np.array([sku_id[n] for n in meta["catalog"]])
    want = np.array([sku_id[q["label"]] for q in meta["queries"]])
    tier = np.array([q["tier"] for q in meta["queries"]])
    scene = np.array([q["scene"] for q in meta["queries"]])
    catalog_paths = sorted((CACHE / "catalog").glob("*.jpg"))
    query_paths = sorted((CACHE / "queries").glob("*.jpg"))

    # Every third scene validates. Spreading them out rather than taking a contiguous block
    # keeps the clutter tiers balanced across the two sides, since the corpus is ordered by tier.
    scenes = sorted(set(scene.tolist()))
    validation_scenes = set(scenes[:: max(1, len(scenes) // max(args.validation_scenes, 1))][
        : args.validation_scenes
    ])
    validation = np.isin(scene, list(validation_scenes))
    testing = ~validation
    if not args.validation_scenes:
        validation, testing = np.ones(len(want), bool), np.ones(len(want), bool)

    frozen_catalog, frozen_queries = features(args.encoder, CACHE)
    frozen_head, _ = head_module.train(frozen_catalog, labels, len(sku_names))
    frozen_right = np.argmax(head_module.score(frozen_queries, frozen_head), axis=1) == want
    baseline = float(frozen_right[testing].mean())
    print(f"{args.encoder}: {len(catalog_paths)} catalog crops, {len(sku_names)} SKUs")
    print(f"{validation.sum()} queries in {len(validation_scenes)} validation scenes, "
          f"{testing.sum()} in the rest")
    print(f"frozen encoder with a trained head, on the test scenes: {baseline:.1%}\n")

    preprocess, _ = encode.open_clip_visual(args.encoder)
    queries = [preprocess(Image.open(p).convert("RGB")) for p in query_paths]
    device = encode.device()

    history = []

    def score_queries(epoch, loss, visual, weights):
        vectors = []
        with torch.no_grad():
            for start in range(0, len(queries), args.batch):
                batch = torch.stack(queries[start : start + args.batch]).to(device)
                vectors.append(
                    torch.nn.functional.normalize(visual(batch).float(), dim=-1).cpu().numpy()
                )
        scores = np.concatenate(vectors) @ weights.T
        order = np.argsort(-scores, axis=1)
        hit1 = order[:, 0] == want
        hit5 = (order[:, :5] == want[:, None]).any(axis=1)
        tiers = {t: float(hit1[testing & (tier == t)].mean()) for t in TIERS}
        history.append({
            "epoch": epoch, "loss": loss,
            "validation": float(hit1[validation].mean()),
            "r1": float(hit1[testing].mean()), "r5": float(hit5[testing].mean()),
            "tiers": tiers,
        })
        print(f"{epoch:>6}{loss:>9.3f}{hit1[validation].mean():>12.1%}{tiers['easy']:>8.1%}"
              f"{tiers['medium']:>8.1%}{tiers['hard']:>8.1%}{hit1[testing].mean():>8.1%}"
              f"{hit5[testing].mean():>8.1%}", flush=True)

    print(f"{'epoch':>6}{'loss':>9}{'validation':>12}{'easy':>8}{'medium':>8}{'hard':>8}"
          f"{'R@1':>8}{'R@5':>8}")
    print("-" * 67)
    finetune.train(
        catalog_paths, labels, len(sku_names), args.encoder,
        head_module.prototypes(frozen_catalog, labels, len(sku_names)),
        epochs=args.epochs, batch=args.batch, workers=args.workers,
        log=lambda m: print(m, flush=True), after_epoch=score_queries,
    )

    (HERE / f"finetune-score-{args.encoder}.json").write_text(
        json.dumps({"encoder": args.encoder, "frozen_baseline": baseline,
                    "epochs": history}, indent=1)
    )
    picked = max(history, key=lambda h: h["validation"])
    print(f"\nvalidation picks epoch {picked['epoch']}, whose test score is "
          f"{picked['r1']:.1%} first choice and {picked['r5']:.1%} in five")
    print(f"frozen encoder on the same test scenes: {baseline:.1%}")
    print("\nThe epoch is chosen on scenes the test score never sees, and every epoch is")
    print("printed, so any selection after the fact would be visible in the table above.")


if __name__ == "__main__":
    main()
