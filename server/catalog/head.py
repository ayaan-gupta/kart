"""
A classifier trained on the store's own catalog.

Every earlier measurement treated the catalog as a lookup table: embed the crop, embed the
catalog, take the nearest. That is the obvious thing to do and it wastes the assumption the
whole design rests on. If the catalog is the complete set of possible answers, then naming is
classification, and a classifier gets to learn what separates the two SKUs that a lookup keeps
confusing. A lookup never sees the other products at all.

Measured on 465 held-out cart crops against a 200-SKU catalog, same frozen encoder, same crops:
nearest neighbour 65.2% first-choice, this 73.8%. On the crowded scenes that are the product's
real problem, 54.6% against 68.3%. It is also cheaper to run, two hundred dot products rather
than twenty thousand.

Two properties matter for deployment. Adding a SKU means refitting the head, which is seconds
on cached embeddings rather than a re-encode of the catalog. And below about ten reference
images per SKU there is too little to learn from and the head is no better than the lookup, so
that floor is a real requirement on the store, not a preference.
"""
import numpy as np

# Logit scale. Cosine similarities live in [-1, 1], and a softmax over that range is nearly
# flat, so the gradient carries almost no signal. 20 is the value CLIP-style training settled
# on and there was no measured reason to move it.
SCALE = 20.0
# The catalog is not clean supervision: a crop of the back of a packet genuinely could be
# several SKUs, and a head trained to be certain about those is learning the noise.
LABEL_SMOOTHING = 0.1
EPOCHS = 60
BATCH = 1024
LEARNING_RATE = 1e-3
WEIGHT_DECAY = 1e-4
# Reference images per SKU below which the head has nothing to learn. Measured: at 5 it scores
# 52.7% against the lookup's 53.8%, at 10 it scores 71.8% against 60.2%.
MIN_REFERENCES = 10


def normalize(matrix):
    return matrix / (np.linalg.norm(matrix, axis=-1, keepdims=True) + 1e-9)


def prototypes(features, labels, classes):
    """Mean embedding per SKU. The cheapest possible head, and the bar training has to clear."""
    return normalize(
        np.stack([features[labels == sku].mean(axis=0) for sku in range(classes)])
    )


def train(features, labels, classes, holdout=0.1, epochs=EPOCHS, seed=17, log=None):
    """Fits a cosine classifier over the catalog and returns its per-SKU weight vectors.

    Initialized at the prototypes rather than at random. The prototypes are already a workable
    classifier, so training begins from something sensible and spends its whole budget on the
    SKUs the prototypes confuse. Held-out catalog crops choose the stopping epoch, so no query
    the head is later scored on is involved in fitting it.
    """
    import torch

    device = "cuda" if torch.cuda.is_available() else (
        "mps" if torch.backends.mps.is_available() else "cpu"
    )
    rng = np.random.default_rng(seed)
    order = rng.permutation(len(features))
    cut = max(1, int(len(order) * holdout))
    hold, fit = order[:cut], order[cut:]

    x = torch.from_numpy(features[fit]).to(device)
    y = torch.from_numpy(labels[fit]).long().to(device)
    xv = torch.from_numpy(features[hold]).to(device)
    yv = torch.from_numpy(labels[hold]).long().to(device)

    weight = torch.nn.Parameter(
        torch.from_numpy(prototypes(features, labels, classes)).to(device).clone()
    )
    optimizer = torch.optim.AdamW(
        [weight], lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY
    )
    best, best_score, best_epoch = weight.detach().clone(), -1.0, 0

    for epoch in range(epochs):
        shuffle = torch.randperm(len(x), device=device)
        for start in range(0, len(x), BATCH):
            rows = shuffle[start : start + BATCH]
            logits = SCALE * (
                torch.nn.functional.normalize(x[rows], dim=-1)
                @ torch.nn.functional.normalize(weight, dim=-1).T
            )
            loss = torch.nn.functional.cross_entropy(
                logits, y[rows], label_smoothing=LABEL_SMOOTHING
            )
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

        with torch.no_grad():
            scored = (
                torch.nn.functional.normalize(xv, dim=-1)
                @ torch.nn.functional.normalize(weight, dim=-1).T
            )
            accuracy = float((scored.argmax(dim=1) == yv).float().mean())
        if accuracy > best_score:
            best, best_score, best_epoch = weight.detach().clone(), accuracy, epoch

    if log:
        log(f"held-out catalog accuracy {best_score:.1%} at epoch {best_epoch}")
    return normalize(best.cpu().numpy()), best_score


def score(features, weight):
    """Cosine score of every query against every SKU. Both sides are already normalized."""
    return normalize(features) @ normalize(weight).T
