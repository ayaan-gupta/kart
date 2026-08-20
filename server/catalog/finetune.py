"""
Fine-tunes the encoder on the store's catalog.

`head.py` learns where the boundary between two SKUs lies inside a feature space it cannot
change. When two of a store's products are near-identical to a frozen encoder, no linear
boundary separates them and no head can help. This moves the features themselves, so the
encoder learns to attend to whatever actually distinguishes these particular products, which is
what "a model fine-tuned for this store" means in full.

Measured on cart crops from 40 test scenes against a 200-SKU catalog, SigLIP-B/16, with the
epoch chosen on 20 scenes the score never sees: a frozen encoder with a trained head reaches
84.1% first choice, and this reaches 90.0%. The gain concentrates where the product fails.

It is by far the most expensive thing in the pipeline. A frozen pass over the catalog is
minutes; this is tens of minutes per epoch, and it has to be rerun when the catalog changes
rather than refitted in seconds. That trade is the reason both paths exist.

It also carries a requirement that is easy to miss. Accuracy peaks after one epoch and falls
afterwards, while the training loss keeps dropping and held-out catalog accuracy stays above
99%: the encoder overfits away from cart scenes towards the clean exemplars it trains on, and
every signal inside the catalog says the run is going well. Choosing when to stop needs a
handful of labelled carts. A store cannot reach this from product photographs alone.

Augmentation deliberately excludes horizontal flips and hue jitter. Packaging carries text,
which does not appear mirrored in a cart, and hue is one of the things that separates two
flavours of one product, so both would teach the model to ignore real evidence.
"""
import numpy as np

from . import encode, head as head_module

# One. Measured across four, with the stopping point chosen on scenes the score never saw, and
# the first is the best on both the validation and the test scenes. More epochs cost accuracy
# rather than buying it.
EPOCHS = 1
BATCH = 32
# The encoder moves slowly and the head moves fast. The encoder already knows what a product
# looks like and only needs nudging towards this catalog's distinctions; the head starts from
# prototypes and has a genuine fit to perform.
ENCODER_LR = 1e-5
HEAD_LR = 1e-3
WEIGHT_DECAY = 1e-4


class Crops:
    """Paths and labels, decoded and transformed on demand.

    At module level rather than nested in a function: DataLoader workers pickle the dataset by
    qualified name, and a class defined inside a function has no importable name to pickle.
    """

    def __init__(self, paths, labels, transform):
        self.paths, self.labels, self.transform = paths, labels, transform

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, i):
        from PIL import Image

        return self.transform(Image.open(self.paths[i]).convert("RGB")), int(self.labels[i])


def augmentation(preprocess):
    """Training transform, sharing the encoder's own normalization and input size."""
    from torchvision import transforms as T

    normalize = [t for t in preprocess.transforms if t.__class__.__name__ == "Normalize"][0]
    sized = [t for t in preprocess.transforms if hasattr(t, "size")][0].size
    side = sized[0] if isinstance(sized, (list, tuple)) else sized
    return T.Compose(
        [
            T.RandomResizedCrop(side, scale=(0.7, 1.0), ratio=(0.85, 1.18)),
            T.RandomApply([T.ColorJitter(brightness=0.25, contrast=0.25)], p=0.5),
            T.RandomApply([T.RandomRotation(8)], p=0.3),
            T.ToTensor(),
            normalize,
        ]
    )


def train(paths, labels, classes, encoder, initial_head, epochs=EPOCHS, batch=BATCH,
          workers=0, log=print, after_epoch=None, seed=17):
    """Returns the fine-tuned vision tower and its head.

    `initial_head` is where the classifier starts, normally the prototypes of the frozen
    features. Starting from random would spend the first epoch relearning what a frozen pass
    already established in seconds.

    `after_epoch(epoch, loss, visual, weights)` is called with the model in eval mode, so a
    harness can score it without this module needing to know what a query is.
    """
    import torch
    from torch.utils.data import DataLoader

    torch.manual_seed(seed)
    device = encode.device()
    preprocess, visual = encode.open_clip_visual(encoder)
    weights = torch.nn.Parameter(torch.from_numpy(initial_head).to(device).clone())

    loader = DataLoader(
        Crops(paths, labels, augmentation(preprocess)),
        batch_size=batch, shuffle=True, num_workers=workers, drop_last=True,
    )
    optimizer = torch.optim.AdamW(
        [
            {"params": visual.parameters(), "lr": ENCODER_LR},
            {"params": [weights], "lr": HEAD_LR},
        ],
        weight_decay=WEIGHT_DECAY,
    )
    schedule = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=max(1, epochs * len(loader))
    )

    for epoch in range(epochs):
        visual.train()
        running, batches = 0.0, 0
        for images, targets in loader:
            vectors = torch.nn.functional.normalize(
                visual(images.to(device)).float(), dim=-1
            )
            logits = head_module.SCALE * (
                vectors @ torch.nn.functional.normalize(weights, dim=-1).T
            )
            loss = torch.nn.functional.cross_entropy(
                logits, targets.to(device), label_smoothing=head_module.LABEL_SMOOTHING
            )
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            schedule.step()
            running += float(loss.detach())
            batches += 1
            if batches % 50 == 0:
                log(f"    batch {batches}/{len(loader)} loss {running / batches:.3f}")
        visual.eval()
        if after_epoch:
            after_epoch(epoch, running / max(batches, 1), visual, _numpy_head(weights))

    return visual, _numpy_head(weights)


def _numpy_head(weights):
    return head_module.normalize(weights.detach().cpu().numpy()).astype(np.float32)


def state_dict(visual):
    """CPU tensors, so the saved index does not pin a GPU it was built on."""
    return {k: v.detach().cpu() for k, v in visual.state_dict().items()}
