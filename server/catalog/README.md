# Catalog matching

Names a detected crop against the store's product list. The enumerator (`server/enumerator`)
finds the items in a cart; this decides what each one is.

## Why a classifier and not a lookup

The design assumes a deployment holds the store's complete catalog. That assumption makes
naming a closed-world problem, and the obvious way to use it is a lookup: embed the crop, embed
the catalog, take the nearest neighbour. That was the shipped behaviour and it wastes the
assumption. If the catalog is the complete set of possible answers then naming is
classification, and a classifier gets to learn what separates the two SKUs a lookup keeps
confusing. A lookup never looks at the other products at all.

Training a head on the store's own catalog is the largest single gain measured in this project.
It is also cheaper to run than the lookup it replaces, two hundred dot products instead of
twenty thousand, and refitting it when a product is added takes seconds rather than a re-encode.

Numbers, corpus sizes and the things that were measured and rejected are in
[`server/eval/CATALOG.md`](../eval/CATALOG.md).

## The pipeline

| stage | file | what it adds |
|---|---|---|
| encode | `encode.py` | image features, plus a colour-layout descriptor no encoder provides |
| classify | `head.py` | a head trained on this store's catalog |
| shortlist | `rank.py` | the ten best, which is the ceiling everything after inherits |
| rerank | `geometry.py`, `rank.py` | colour and keypoint evidence the encoder cannot represent |
| decide | `rank.py` | a calibrated probability, and a floor below which it declines |

`matcher.py` assembles them. Nothing in `rank.py` or `head.py` holds a model or opens a file, so
the eval harness and the deployed service run the same code and the unit tests reach the parts
where a mistake would be silent.

## Building an index

One directory per product, its photographs inside, which is the shape a turntable capture rig
writes out and the shape a store can actually produce.

```
catalog/
  gala-apples-1kg/     0001.jpg 0002.jpg ...
  oat-milk-barista/    0001.jpg 0002.jpg ...
```

```python
from catalog.matcher import Index, Matcher

Index.build("catalog/", encoder="siglipb16").save("index.npz")
matcher = Matcher(Index.load("index.npz"))
matcher.match([crop])       # [{"sku": ..., "confidence": ..., "alternatives": [...]}]
```

A product with fewer than `MIN_REFERENCES` photographs is skipped rather than added badly: below
that floor the head has too little to learn from and scores no better than the lookup, so a
thinly photographed product would silently get the worse pipeline.

## What to ask a store for

Ten photographs per product is the floor and twenty is the knee. Past twenty the curve is flat,
so the earlier guidance of roughly a hundred views per SKU was a requirement of the lookup, not
of the problem. Photographs of the product alone, not crops taken out of shelf or cart imagery:
products on a packed shelf touch, so a crop of one carries slices of its neighbours on both
sides of the match.

## Running the tests

```bash
cd server && pytest catalog/test_catalog.py
```

They need `numpy`, `opencv-python` and `torch`. No network and no model weights: the encoders
are stubbed, because what these tests exist to check is the wiring, and downloading a
four-hundred megabyte encoder to assert that a shortlist is sorted would be a worse test.
