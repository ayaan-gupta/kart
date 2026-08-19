# Catalog matching: what has been measured

A deployment holds the store's complete product list. That assumption is the whole design, and
what it buys depends entirely on how it is used. Used as a lookup table it buys a nearest
neighbour search. Used as what it actually is, the complete set of possible answers, it buys a
classifier, and that difference is the largest single gain measured in this project.

## How these numbers are made

RPC, 200 SKUs. The catalog comes from the train split, which is single-product exemplars, the
honest analogue of a store handing over product photographs. The queries are 465 labelled
instance crops taken from the 60 committed test scenes, stratified by how crowded the scene is:
easy holds 3 to 5 items with minimal occlusion, hard holds 11 or more with heavy stacking. No
image appears on both sides. Crops carry 8% padding, matching `recognize.ts`.

At 465 queries and accuracies near 85%, one standard error is 1.7 points. Differences below
about three points in the tables below are not differences, and are described as such.

Every figure is produced by a committed script. `build_cache.py` extracts the crops once,
`score_probe.py` compares heads, `score_rerank.py` measures the reranking signals, and
`fuse_rerank.py` combines them. All of them import `server/catalog`, so the numbers describe the
code that deploys rather than a copy of it that has since drifted.

## The result

| pipeline | easy | medium | hard | R@1 | R@5 |
|---|---|---|---|---|---|
| MobileCLIP-S2, nearest neighbour (what shipped) | 90.5% | 65.0% | 54.6% | 65.2% | 84.5% |
| MobileCLIP-S2, trained head | 94.7% | 69.9% | 67.8% | 74.0% | 91.2% |
| SigLIP-B/16, nearest neighbour | 90.5% | 76.2% | 64.8% | 73.5% | 91.4% |
| SigLIP-B/16, trained head | 94.7% | 82.5% | 81.1% | 84.3% | 96.6% |
| **SigLIP-B/16, trained head, reranked** | **95.8%** | **82.5%** | **83.3%** | **85.6%** | |
| published comparable, ~180 references per SKU | | | | 77.0% | 94.5% |

Published figures are from arXiv:2605.18029, 190 open-source models on 409 grocery SKUs.

Two changes account for almost all of it, and neither is a better matching algorithm. Train on
the catalog rather than search it, and stop using an encoder chosen for a phone in a pipeline
that runs on a GPU.

## Training on the catalog beats searching it

An embedding lookup asks which single catalog crop this crop most resembles. A classifier asks
what separates SKU 41 from SKU 42, which is a question the lookup never puts. The catalog is the
complete set of answers, so that question is answerable, and answering it is worth 8 to 11
points depending on the encoder.

| encoder | head | easy | medium | hard | R@1 | R@5 |
|---|---|---|---|---|---|---|
| MobileCLIP-S2 | nearest | 90.5% | 65.0% | 54.6% | 65.2% | 84.5% |
| MobileCLIP-S2 | prototype | 75.8% | 59.4% | 52.0% | 59.1% | 79.4% |
| MobileCLIP-S2 | trained | 94.7% | 69.9% | 67.8% | 74.0% | 91.2% |
| SigLIP-B/16 | nearest | 90.5% | 76.2% | 64.8% | 73.5% | 91.4% |
| SigLIP-B/16 | prototype | 90.5% | 75.5% | 68.3% | 75.1% | 89.5% |
| SigLIP-B/16 | trained | 94.7% | 82.5% | 81.1% | 84.3% | 96.6% |

The prototype row is the control that matters. Averaging each SKU's reference embeddings is free
and requires no training, and it is *worse* than the lookup on MobileCLIP and barely better on
SigLIP. So the gain is not from consolidating a SKU's references into one vector. It is from
learning where the boundary between two SKUs lies, which only training can do.

The gain concentrates on the crowded scenes, which is where the product actually struggles:
54.6% to 67.8% on MobileCLIP, 64.8% to 81.1% on SigLIP. That is the opposite of how most
accuracy aids behave.

The head is also cheaper than what it replaces. Scoring is 200 dot products rather than 20,000,
and adding a product means refitting a head in seconds rather than re-encoding a catalog.

## Which encoder

MobileCLIP-S2 was inherited from a published comparison that picked it as the edge-deployable
option. That reasoning does not apply here. The crops are already on a GPU service beside the
detector, so encoder size costs latency and nothing else.

| encoder | dims | nearest R@1 | trained R@1 | trained R@5 |
|---|---|---|---|---|
| SigLIP-B/16 | 768 | 73.5% | **84.3%** | **96.6%** |
| MobileCLIP-S2 | 512 | 65.2% | 74.0% | 91.2% |
| MobileCLIP-S2 + DINOv2-B, concatenated | 2048 | 61.7% | 73.1% | 90.1% |
| DINOv2-B | 1536 | 40.9% | 56.6% | 77.0% |

DINOv2 was expected to win and did not, which is worth recording because the reasoning behind
the expectation was sound. Self-supervised features are trained to make two views of one object
agree, which is exactly the instance-level question a catalog asks, and DINOv2 is the standard
choice for instance retrieval. On this data it scores 40.9% where MobileCLIP scores 65.2%. The
likely reason is that packaged groceries are discriminated by printed graphics rather than by
shape or texture, and a model trained against captioned web images has seen far more product
packaging than one trained on ImageNet-scale photographs. Concatenating it with MobileCLIP made
the pair worse than MobileCLIP alone, so it does not even add as a second opinion.

## How many photographs a store has to supply

This overturns an earlier conclusion in this file. Catalog depth was measured as the largest
lever available, worth 21 points between 20 and 100 references per SKU. That was true, and it
was a property of the lookup, not of the problem.

| references per SKU | MobileCLIP nearest | MobileCLIP trained | SigLIP nearest | SigLIP trained |
|---|---|---|---|---|
| 3 | 49.0% | 47.5% | | |
| 5 | 53.8% | 52.7% | 66.7% | 67.5% |
| 10 | 60.2% | 71.8% | 68.8% | 74.4% |
| 20 | 61.7% | 75.1% | 70.1% | 81.1% |
| 50 | 63.7% | 74.4% | 72.3% | 81.5% |
| 100 | 65.2% | 74.0% | 73.5% | 84.3% |

Three things are visible and all three are requirements rather than observations.

**Ten is a hard floor.** At 3 and 5 references the trained head is no better than the lookup and
sometimes slightly worse. There is too little per class to learn a boundary from. Between 5 and
10 the head gains 11 points on MobileCLIP and 7 on SigLIP. `matcher.py` refuses to index a
product below this floor rather than silently giving it the worse pipeline.

**Twenty is the knee.** Going from 10 to 20 is worth 7 points on SigLIP. Going from 20 to 100 is
worth 3, which is five times the photography for one standard error of accuracy.

**Depth substitutes for training, not the other way round.** A head trained on 10 references
beats a lookup over 100 on both encoders. A store that photographs 20 views per SKU and trains a
head lands ahead of one that photographs 100 and searches them.

## The reranker

Stage one hands over the ten best candidates. That shortlist holds the right answer 98.9% of the
time, which is the hard ceiling on everything after it: a reranker reorders, it cannot rescue.
Between 84.3% first-choice and that 98.9% there are 14.6 points to argue over.

Four signals, each measured alone by how often it picks the right candidate out of the ten:

| signal | alone | what it knows that the others do not |
|---|---|---|
| trained head | 84.3% | the whole catalog, learned |
| nearest neighbour | 73.8% | which single reference view matches |
| geometry | 69.0% | whether two pictures can be one physical object |
| colour | 31.0% | which panel of the packet is which colour |

Geometry is RootSIFT correspondences that survive a single homography, over the three reference
views of each candidate that most resemble the query. On its own it reaches 69.0%, which is more
than the entire shipped nearest-neighbour pipeline managed with everything it had, from a
descriptor published in 1999 and no training at all. Colour is weak alone by design: it is a
3x3 grid of hue and saturation histograms, and it earns its place because keypoint matching runs
on greyscale and every encoder pools colour into a global average, so it is the only signal here
that can see two packets sharing a layout and differing in the colour of one panel.

Fused, with weights fitted by 4-fold cross-validation split on scene, never on query:

| signal | weight | spread across folds |
|---|---|---|
| head | 0.41 | 0.02 |
| geometry | 0.32 | 0.04 |
| colour | 0.23 | 0.02 |
| nearest | 0.04 | 0.02 |

| tier | queries | head alone | reranked | gain | ceiling |
|---|---|---|---|---|---|
| easy | 95 | 94.7% | 95.8% | +1.1 | 100.0% |
| medium | 143 | 82.5% | 82.5% | +0.0 | 100.0% |
| hard | 227 | 81.1% | 83.3% | +2.2 | 97.8% |
| ALL | 465 | 84.3% | 85.6% | +1.3 | 98.9% |

The weight on nearest neighbour is 0.04, which says the lookup is fully redundant once the head
exists. Weights are averaged over the ten best grid points per fold rather than the single best:
picking one grid point on a couple of hundred queries fits their noise, which showed up as folds
disagreeing about whether geometry deserved 0.6 or 0.2. After averaging, the spread across folds
is 0.02 to 0.04.

A gain of 1.3 points is one standard error, so on its own it would not be worth reporting. It is
here because it is 2.2 points on the crowded scenes, where the fusion is doing what it was built
for, and because it costs nothing that is not already computed.

## Knowing when it is wrong

The confidence is a logistic on the gap between the first and second fused scores, fitted on the
same held-out folds as the weights. Held out, it is close to true:

| items | it says | it is |
|---|---|---|
| 93 | 60% | 56% |
| 93 | 84% | 86% |
| 93 | 92% | 92% |
| 93 | 96% | 96% |
| 93 | 98% | 98% |

Average gap between the stated probability and the observed rate: 1.4 points. That is what
allows a threshold to be set on evidence rather than on a round number:

| tolerance for a wrong name added silently | floor | items added | their accuracy | items asked about |
|---|---|---|---|---|
| 90% correct | 0.59 | 90.8% | 90.0% | 43 of 465 |
| 95% correct | 0.88 | 63.7% | 95.3% | 169 of 465 |
| 98% correct | 0.97 | 22.4% | 98.1% | 361 of 465 |

Ninety percent is cheap and ninety-five is not. An item below the floor is not a failure: it is
the one the interface offers as a short list of alternatives instead of adding silently, and the
shortlist it offers holds the right answer 98.9% of the time.

## Measured and rejected

Recorded so they are not tried again.

**Hubness correction and alpha query expansion, minus 2 to 3 points each.** Both are standard in
instance retrieval and both hurt here. Query expansion re-queries with the query averaged into
its own best matches, which reinforces the error whenever the top match is wrong, and at 65%
first-choice accuracy it was wrong often. Hubness correction subtracts each catalog crop's
average similarity to the rest of the catalog, which in a catalog of 100 near-identical views
per SKU mostly penalises the SKUs whose references genuinely agree.

**How a SKU's reference crops are aggregated: worth nothing.** Max, and the mean of the best 3,
5, 10 or 20, all land between 64.3% and 65.4%. This was expected to matter and does not.

**DINOv2, alone and concatenated.** Covered above.

**Prototypes.** Averaging each SKU's references is free and is worse than the lookup.

**More keypoint evidence, plus 0.2 points.** Comparing six reference views per candidate
instead of three, and running geometry over all ten shortlist slots instead of the top eight,
lifts geometry alone from 69.0% to 70.3% and the fused result from 85.6% to 85.8%. That is 2.5
times the keypoint matching per item for one eighth of a standard error. The shipped settings
stay at three references and the top eight.

**A listwise ranker over richer candidate features, plus 0.2 points.** Ten features per
candidate rather than four, including how far behind the leader it sits, its absolute keypoint
count, and its shortlist position, fitted with a softmax loss on the same folds. 85.8% against
85.6%, which is one item. Worth knowing because of what it implies: the four-weight blend is
already extracting what these signals contain, so the remaining distance to the ceiling needs
new evidence rather than better arithmetic on the evidence in hand.

## Earlier work, on a different corpus

`score_catalog_yolo.py` accepts any YOLO-format dataset, which is the shape a store would hand
over, and was run against a 647-class Indian grocery set built from shelf photographs.

| catalog source | classes | queries | R@1 | R@5 |
|---|---|---|---|---|
| crops from shelf scenes, 8 per class | 261 | 1,472 | 27% | 40% |
| crops from shelf scenes, 25 per class | 419 | 2,059 | 38% | 52% |

Two hypotheses were tested there and one was wrong. The taxonomy is genuinely inconsistent
(`Amul`, `Butter_Amul` and `Milk_Amul` are three classes for one brand, and nine pairs collide on
spelling alone), but scoring a prediction correct whenever it shares a word with the truth moved
R@1 from 38% to 40%. Two points. Not the cause. The remaining suspect is that both the catalog
and the queries there are crops out of cluttered shelf photographs, so a crop of one packet
carries slices of its neighbours on both sides of the match. That is the reason the catalog a
store provides must be photographs of the product alone, not crops harvested from shelf or cart
imagery.

## What these numbers cannot tell you

RPC lays products on a white tray. It is a proxy for naming only, and a generous one: a cart is
darker, deeper, and full of things at angles a tray never produces. Detection numbers must not
be read off it at all, and shelf imagery in particular was measured and does not transfer to
carts (`server/enumerator/README.md`).

Three things are untested rather than measured, and none of them is small.

**Items that are not in the catalog.** Every RPC query has a catalog entry, so nothing here
measures what happens when a shopper puts in something the store does not sell, or a personal
bag, or a phone. The closed-world assumption is exactly what makes the numbers above good, and
this is its bill.

**A vision-language reranker.** Sending the crop and its five candidates' reference images to a
model and asking which matches is the obvious source of the new evidence the fusion needs. It is
unmeasured because the key is deferred, not because it was judged unpromising.

**Anything about a real cart.** The paired cart photographs specified in
`server/eval/corpus/README.md` are still outstanding, and until they exist every number here
describes a tray.
