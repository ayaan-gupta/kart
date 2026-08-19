# Catalog matching: what has been measured

The design assumes a deployment holds the store's full product catalog, which turns naming from
open-world description into retrieval over a known set. Two scripts measure that:

- `score_catalog.py` uses RPC, whose catalog is clean single-product exemplars
- `score_catalog_yolo.py` takes any YOLO-format dataset, which is the shape a store would hand
  over, and was run against a 647-class Indian grocery set

## Results

| set | catalog source | classes | queries | Recall@1 | Recall@5 | gap |
|---|---|---|---|---|---|---|
| grocer-help | crops from shelf scenes, 8 per class | 261 | 1,472 | 27% | 40% | 13 |
| grocer-help | crops from shelf scenes, 25 per class | 419 | 2,059 | 38% | 52% | 14 |
| published comparable | clean references, ~180 per SKU | 409 | n/a | 77% | 94.5% | 17.5 |

Published figures are from arXiv:2605.18029, 190 open-source models on 409 grocery SKUs. Model
here is MobileCLIP-S2/datacompdr throughout, which that paper picked as the edge-deployable
choice.

## The gap between Recall@1 and Recall@5 is the finding that matters

It is 13 to 14 points on our data and 17.5 in the published work. That consistency is the whole
argument for the architecture: an embedding lookup is good at narrowing a 400-way choice to five
candidates and bad at picking between them. So the design is a shortlist followed by a reranker,
not a nearest-neighbour lookup, and the shortlist doubles as the alternatives shown to a shopper
when confidence is low.

Whatever the absolute numbers turn out to be, this shape has held on every set measured.

## Why grocer-help scores half the published figure

Two hypotheses were tested and one was wrong.

**Inconsistent labelling: ruled out.** The taxonomy genuinely is messy. `Amul`, `Butter_Amul`,
`Milk_Amul` and `Cheese_Amul` are four classes for one brand, a generic `Butter` sits alongside
seven brand-specific butters, and nine pairs collide on spelling alone (`CocaCola`/`Cocacola`,
`MAggi`/`Maggi`, `Zandu`/`Zhandu`). Scoring a prediction correct whenever it shares any word with
the truth moved Recall@1 from 38% to 40%. Two points. Not the cause.

**Thin catalog: partly.** Going from 8 to 25 crops per class gained 11 points, and did so while
the class count rose from 261 to 419, which makes the task harder. Still far below the ~180
references per SKU behind the published number.

**Catalog image quality: the remaining suspect.** Both the catalog and the queries here are crops
out of cluttered shelf photographs. Neither is a clean product image. Products on a packed shelf
touch, so a crop of one packet carries slices of the two beside it, on both sides of the match.
The published setup compares a scene crop against a clean reference photograph.

That distinction is worth stating plainly because it is a requirement, not an excuse: **the
catalog a store provides must be clean product photographs, not crops harvested from shelf or
cart imagery.** RPC separates these cleanly, its train split being single-product exemplars at
about 160 views each, which is why it is measured separately.

## What these numbers cannot tell you

Neither set is a cart. grocer-help is shelf photography; RPC lays products on a white tray. Both
are proxies for the naming half only. Detection numbers must not be read off either, and shelf
imagery in particular was measured and does not transfer to carts at all
(`server/enumerator/README.md`).
