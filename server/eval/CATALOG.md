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
| RPC | clean single-product exemplars, 20 per SKU | 200 | 465 | 45% | 65% | 20 |
| RPC | clean single-product exemplars, 100 per SKU | 200 | 465 | 66% | 87% | 21 |
| published comparable | clean references, ~180 per SKU | 409 | n/a | 77% | 94.5% | 17.5 |

Catalog depth is the single largest lever measured. Holding everything else fixed, going from
20 reference images per SKU to 100 is worth 21 points of Recall@1 and 22 of Recall@5. Three
points on the curve, ours at 20 and 100 and the published one at about 180, line up on a
consistent shape, which says the shortfall was never an implementation defect. The pipeline was
starved of catalog and behaves like the published work once fed.

RPC broken out by its own clutter tiers, which is the controlled comparison. Identical model,
identical catalog, identical method. Only how crowded the scene is changes:

| tier | items in scene | queries | R@1 at 20 | R@5 at 20 | R@1 at 100 | R@5 at 100 |
|---|---|---|---|---|---|---|
| easy | 3 to 5, minimal occlusion | 95 | 71% | 82% | **91%** | **98%** |
| medium | 6 to 10, occasional overlap | 143 | 37% | 55% | 64% | 85% |
| hard | 11 or more, heavy stacking | 227 | 40% | 64% | 57% | 84% |

With a hundred references per SKU an uncrowded scene is close to solved, at 91% first-choice
and 98% within five. A stacked scene still costs 34 points of first-choice accuracy, so clutter
remains the dominant failure even after the catalog is properly fed.

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

## Clutter, not catalog cleanliness, is what costs the most

Recognition accuracy nearly halves between an uncrowded scene and a crowded one: 71% to about
40%, with everything else held constant. Nothing else measured here moves the number that far.

Two things follow, and both were previously assumptions.

The occlusion warning is not a courtesy feature. Asking a shopper to move the thing on top is
worth roughly thirty points of naming accuracy on the items underneath, which makes it one of
the highest-value behaviours in the product rather than a nicety bolted onto the end.

The reranker matters most exactly where the problem is hardest. At a hundred references per
SKU the gap between Recall@1 and Recall@5 runs 7 points on clean scenes and 26 on stacked ones:
the shortlist keeps holding the right answer while the embedding's own ranking of it decays.
On the hard tier that is 57% first-choice against 84% within five, so a reranker able to pick
correctly from five candidates is worth 27 points precisely where the product struggles most.
That is the opposite of how most accuracy aids behave.

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
cart imagery.** RPC separates these cleanly, its train split being single-product exemplars.

The RPC run puts a size on it, and it is smaller than expected. A clean exemplar catalog scores
45% against 38% for one built from shelf crops. Real, worth having, and nowhere near the
thirty-point swing that clutter causes. Catalog cleanliness is a second-order lever.

Catalog depth was that lever and it has now been measured: 20 to 100 references per SKU is
worth 21 points, taking Recall@1 from 45% to 66% and Recall@5 from 65% to 87%. The remaining
distance to the published 77% is consistent with the remaining distance in depth, 100 against
roughly 180.

This is the concrete requirement to put to a store. Not "send product photographs" but roughly
a hundred views per SKU, which is what a turntable capture rig produces in a few minutes per
item and what RPC itself did at about 160.

## What these numbers cannot tell you

Neither set is a cart. grocer-help is shelf photography; RPC lays products on a white tray. Both
are proxies for the naming half only. Detection numbers must not be read off either, and shelf
imagery in particular was measured and does not transfer to carts at all
(`server/enumerator/README.md`).
