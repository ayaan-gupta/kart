"""
Fine-tunes the encoder on the store's catalog, rather than only a head on top of it.

The head measured in score_probe.py learns where the boundary between two SKUs lies inside a
feature space it cannot change. If two products are near-identical to a frozen SigLIP, no linear
boundary separates them and the head cannot help. Fine-tuning moves the features themselves, so
the encoder can learn to attend to whatever actually distinguishes this store's products, which
is what "a model fine-tuned for that store" means in full.

It is also the most expensive thing in this project by a wide margin: a frozen pass over the
catalog is minutes and this is hours, and it has to be redone when the catalog changes rather
than refitted in seconds. So the question is not only whether it wins but whether it wins enough
to be worth that.

Protocol, fixed before running so the number is honest:

  epochs are fixed at 3 in advance. Nothing is selected on the 465 query crops, and every
  epoch's score is printed rather than the best one, so any selection would be visible.
  Augmentation deliberately excludes horizontal flips and hue jitter. Packaging carries text,
  which does not appear mirrored in a cart, and hue is one of the things that separates two
  flavours of the same product, so both would teach the model to ignore real evidence.

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

from catalog import encode, head as head_module  # noqa: E402

TIERS = ("easy", "medium", "hard")


class Crops:
    """Paths and labels, transformed on demand.

    Defined at module level rather than inside main: DataLoader workers pickle the dataset by
    qualified name, and a class defined in a function has no importable name to pickle.
    """

    def __init__(self, paths, labels, transform):
        self.paths, self.labels, self.transform = paths, labels, transform

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, i):
        from PIL import Image

        return self.transform(Image.open(self.paths[i]).convert("RGB")), int(self.labels[i])


def transforms(preprocess, train):
    """Training and evaluation transforms sharing the encoder's own normalization."""
    from torchvision import transforms as T

    normalize = [t for t in preprocess.transforms if t.__class__.__name__ == "Normalize"][0]
    size = [t for t in preprocess.transforms if hasattr(t, "size")][0].size
    side = size[0] if isinstance(size, (list, tuple)) else size
    if not train:
        return preprocess
    return T.Compose(
        [
            T.RandomResizedCrop(side, scale=(0.7, 1.0), ratio=(0.85, 1.18)),
            T.RandomApply([T.ColorJitter(brightness=0.25, contrast=0.25)], p=0.5),
            T.RandomApply([T.RandomRotation(8)], p=0.3),
            T.ToTensor(),
            normalize,
        ]
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--encoder", default="siglipb16")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch", type=int, default=32)
    # Loading in the main process by default. Worker subprocesses get swept up by process-group
    # cleanup on this machine, and a ViT-B backward pass dominates JPEG decode anyway, so the
    # parallelism buys little and costs a run that dies an hour in.
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--encoder-lr", type=float, default=1e-5)
    parser.add_argument("--head-lr", type=float, default=1e-3)
    args = parser.parse_args()

    import open_clip
    import torch
    from torch.utils.data import DataLoader

    from rerank_features import features

    meta = json.loads((CACHE / "index.json").read_text())
    sku_names = sorted(set(meta["catalog"]))
    sku_id = {n: i for i, n in enumerate(sku_names)}
    catalog_label = np.array([sku_id[n] for n in meta["catalog"]])
    want = np.array([sku_id[q["label"]] for q in meta["queries"]])
    tier = np.array([q["tier"] for q in meta["queries"]])
    catalog_paths = sorted((CACHE / "catalog").glob("*.jpg"))
    query_paths = sorted((CACHE / "queries").glob("*.jpg"))

    _, model_id, pretrained = encode.ENCODERS[args.encoder]
    device = encode.device()
    model, _, preprocess = open_clip.create_model_and_transforms(
        model_id, pretrained=pretrained
    )
    visual = model.visual.to(device)
    print(f"{model_id}/{pretrained} on {device}, {len(catalog_paths)} catalog crops, "
          f"{len(sku_names)} SKUs")

    # The head starts where the frozen features already put it. Starting from random would
    # spend the first epoch relearning what score_probe.py measured in seconds.
    frozen, _ = features(args.encoder, CACHE)
    weight = torch.nn.Parameter(
        torch.from_numpy(head_module.prototypes(frozen, catalog_label, len(sku_names)))
        .to(device)
        .clone()
    )

    train_loader = DataLoader(
        Crops(catalog_paths, catalog_label, transforms(preprocess, True)),
        batch_size=args.batch, shuffle=True, num_workers=args.workers, drop_last=True,
    )
    query_loader = DataLoader(
        Crops(query_paths, want, transforms(preprocess, False)),
        batch_size=args.batch, shuffle=False, num_workers=args.workers,
    )

    optimizer = torch.optim.AdamW(
        [
            {"params": visual.parameters(), "lr": args.encoder_lr},
            {"params": [weight], "lr": args.head_lr},
        ],
        weight_decay=1e-4,
    )
    schedule = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=args.epochs * len(train_loader)
    )

    def evaluate():
        visual.eval()
        hit1 = hit5 = 0
        by_tier = {t: [0, 0] for t in TIERS}
        seen = 0
        with torch.no_grad():
            for images, labels in query_loader:
                vectors = torch.nn.functional.normalize(
                    visual(images.to(device)).float(), dim=-1
                )
                logits = vectors @ torch.nn.functional.normalize(weight, dim=-1).T
                order = logits.argsort(dim=1, descending=True).cpu()
                for row, truth in zip(order, labels):
                    right = int(row[0] == truth)
                    hit1 += right
                    hit5 += int((row[:5] == truth).any())
                    bucket = by_tier[tier[seen]]
                    bucket[0] += right
                    bucket[1] += 1
                    seen += 1
        return hit1 / seen, hit5 / seen, {
            t: (v[0] / v[1] if v[1] else 0.0) for t, v in by_tier.items()
        }

    frozen_head, _ = head_module.train(frozen, catalog_label, len(sku_names))
    baseline = (np.argmax(head_module.score(features(args.encoder, CACHE)[1], frozen_head),
                          axis=1) == want).mean()
    print(f"frozen encoder with a trained head: {baseline:.1%}\n")
    print(f"{'epoch':>6}{'loss':>9}{'easy':>8}{'medium':>8}{'hard':>8}{'R@1':>8}{'R@5':>8}")
    print("-" * 55)

    history = []
    for epoch in range(args.epochs):
        visual.train()
        running, batches = 0.0, 0
        for images, labels in train_loader:
            images, labels = images.to(device), labels.to(device)
            vectors = torch.nn.functional.normalize(visual(images).float(), dim=-1)
            logits = head_module.SCALE * (
                vectors @ torch.nn.functional.normalize(weight, dim=-1).T
            )
            loss = torch.nn.functional.cross_entropy(
                logits, labels, label_smoothing=head_module.LABEL_SMOOTHING
            )
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            schedule.step()
            running += float(loss.detach())
            batches += 1
            if batches % 50 == 0:
                print(f"    batch {batches}/{len(train_loader)} loss {running / batches:.3f}",
                      flush=True)
        r1, r5, tiers = evaluate()
        history.append({"epoch": epoch, "loss": running / max(batches, 1),
                        "r1": r1, "r5": r5, "tiers": tiers})
        print(f"{epoch:>6}{running / max(batches, 1):>9.3f}{tiers['easy']:>8.1%}"
              f"{tiers['medium']:>8.1%}{tiers['hard']:>8.1%}{r1:>8.1%}{r5:>8.1%}", flush=True)

    (HERE / f"finetune-score-{args.encoder}.json").write_text(
        json.dumps({"encoder": args.encoder, "frozen_baseline": float(baseline),
                    "epochs": history}, indent=1)
    )
    print("\nEpoch count was fixed before the run. Every epoch is printed, so any selection")
    print("after the fact would be visible in the table above.")


if __name__ == "__main__":
    main()
