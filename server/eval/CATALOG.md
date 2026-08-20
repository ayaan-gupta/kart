# Catalog matching: what has been measured

A deployment holds the store's complete product list. That assumption is the whole design, and
what it buys depends entirely on how it is used. Used as a lookup table it buys a nearest
neighbour search. Used as what it actually is, the complete set of possible answers, it buys a
classifier, and that difference is the largest single gain measured in this project.

Everything below is measured on RPC, which lays products on a white tray. The same pipeline was
later measured on real store shelves and the numbers are very different:
[`SHELVES.md`](SHELVES.md). Read that one before carrying any constant from this file into a
deployment, because two of them do not survive the move.

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
| SigLIP-B/16, trained head, reranked | 95.8% | 82.5% | 83.3% | 85.6% | |
| SigLIP-B/16 fine-tuned, trained head | 95.8% | 85.3% | 83.3% | 86.5% | 97.2% |
| SigLIP-B/16 fine-tuned, head, reranked | 95.8% | 86.7% | 85.5% | 88.0% | |
| ensemble of two, trained head | 95.8% | 83.9% | 83.3% | 86.1% | 98.9% |
| **ensemble of two, five-view queries, reranked** | **97.9%** | **83.9%** | **87.2%** | **88.0%** | **98.9%** |
| ensemble of three fine-tuned, trained head | 97.9% | 85.3% | 87.2% | 88.8% | 98.3% |
| **ensemble of three fine-tuned, reranked** | **96.8%** | **86.0%** | **89.0%** | **89.7%** | **99.4%** |
| published comparable, ~180 references per SKU | | | | 77.0% | 94.5% |

Published figures are from arXiv:2605.18029, 190 open-source models on 409 grocery SKUs.

The two fine-tuned rows carry a caveat the others do not. The epoch count was chosen on 20
scenes whose queries are among these 465, so one bit of information about a third of them went
into the configuration. The clean comparison is in the fine-tuning section below, on 40 scenes
that took no part in training or selection: 90.0% against 84.1%.

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

## Fine-tuning the encoder

A head learns a boundary inside a feature space it cannot change. When two of a store's products
are near-identical to a frozen encoder, no linear boundary separates them and no head helps.
Fine-tuning moves the features themselves, which is the full version of what the closed-world
assumption implies. It is also by far the most expensive thing here: minutes becomes tens of
minutes per epoch, and it must be rerun when the catalog changes rather than refitted in
seconds.

The first run fixed three epochs in advance and printed every one, which turned out to matter.

| epoch | training loss | R@1 over all 465 |
|---|---|---|
| 0 | 1.024 | 89.2% |
| 1 | 0.888 | 86.9% |
| 2 | 0.874 | 87.1% |

Accuracy peaks after one epoch and falls, while the training loss keeps dropping and held-out
catalog accuracy sits at 99.6% throughout. The encoder overfits away from cart scenes and
towards the clean single-product exemplars it trains on, and every signal available inside the
catalog says the run is going well. Reporting 89.2% would be choosing an epoch with knowledge of
the test set; reporting 87.1% would understate a real effect.

So the second run splits the corpus by scene, never by query, since two crops from one
photograph share lighting, camera and often the product. Twenty scenes choose the epoch and the
other forty are scored, having taken no part in training or selection.

| epoch | loss | validation | easy | medium | hard | R@1 | R@5 |
|---|---|---|---|---|---|---|---|
| **0** | 1.025 | **87.8%** | 96.8% | 89.0% | 87.8% | **90.0%** | **98.4%** |
| 1 | 0.888 | 83.3% | 96.8% | 88.0% | 87.1% | 89.3% | 98.4% |
| 2 | 0.871 | 85.3% | 93.5% | 87.0% | 87.1% | 88.3% | 98.4% |
| 3 | 0.867 | 86.5% | 95.2% | 87.0% | 87.1% | 88.7% | 98.4% |

A frozen encoder with a trained head scores 84.1% on those same forty scenes, so fine-tuning is
worth **5.9 points**, and the validation scenes rank the epochs in the same order the test
scenes do. Standard error on 309 queries at this accuracy is 1.7 points.

That last point is the one that matters for deployment, and it is a requirement rather than an
observation. The gain is real and it is only reachable if something can tell the store when to
stop, which nothing inside its own product photographs can. Twenty labelled carts was enough
here. Without them a store following the same recipe would have no way to know whether it landed
on 90.0% or trained past it.

### After fine-tuning, the head is nearly redundant

The head and the fine-tune are doing the same job. Both learn what separates this store's
products from each other; one learns it in a fixed feature space and the other by changing the
space. Once the second has happened, the first has little left to add.

| stage one | frozen encoder | fine-tuned encoder |
|---|---|---|
| nearest neighbour | 73.5% | 87.1% |
| trained head | 84.3% | 86.5% |
| weight the fusion gives the head | 0.41 | 0.08 |
| weight the fusion gives nearest neighbour | 0.04 | 0.42 |

On a frozen encoder the head is worth 10.8 points over the lookup and the fusion leans on it. On
a fine-tuned one the lookup is *better* than the head, and the fusion moves almost all of the
weight across without being told to. So the two configurations want different constants, and
`matcher.py` picks them from the index rather than the call site: handing a fine-tuned index the
frozen weights raises nothing and quietly matches worse.

The head is still worth keeping in a fine-tuned deployment. It costs 200 dot products, it is
what produces the shortlist, and it still carries 0.08 of the fused score.

### The reranker still earns its place afterwards

Worth checking rather than assuming, because a reranker recovers the gap between first choice
and top five, and fine-tuning shrinks that gap from 12.3 points to 10.7.

| tier | queries | fine-tuned head | reranked | gain |
|---|---|---|---|---|
| easy | 95 | 95.8% | 95.8% | +0.0 |
| medium | 143 | 85.3% | 86.7% | +1.4 |
| hard | 227 | 83.3% | 85.5% | +2.2 |
| ALL | 465 | 86.5% | 88.0% | +1.5 |

The same shape as on a frozen encoder: nothing on the uncluttered scenes, most on the stacked
ones. Confidence stays calibrated to 2.1 points, and the floor that keeps silent additions right
90% of the time moves to 0.62, where it defers 31 items of 465 rather than 43.

## Items that are not in the catalog

The closed-world assumption is what makes every number above good, and this is its bill. All of
them are measured on crops whose right answer is definitely present. `score_openset.py` withholds
20 of the 200 SKUs from the catalog, trains the head on the remaining 180, and treats the queries
belonging to the withheld 20 as items with no right answer.

That is a generous proxy. A withheld SKU is still a grocery product photographed the same way as
the rest, where the real case is a trolley strut, a hand, a shopper's own bag. Read these as an
upper bound.

| floor | declines the absent | wrongly declines the present | accuracy of what it accepted |
|---|---|---|---|
| 0.40 | 0% | 0% | 74% |
| **0.59, the shipped floor** | **39%** | **10%** | **82%** |
| 0.70 | 58% | 17% | 85% |
| 0.80 | 71% | 25% | 88% |
| 0.90 | 85% | 41% | 91% |

Median confidence is 0.93 for a product that is present and 0.67 for one that is not, so the two
groups do separate, and not nearly well enough. At the shipped floor three fifths of the absent
products are accepted and named as something the shopper did not buy.

The reason is structural rather than a tuning problem. The confidence is a function of the margin
between the first and second candidate, and a margin answers "which of these is it", not "is it
any of them". A product the catalog does not contain, which happens to resemble one kept SKU more
than the others, produces a large margin and a confident wrong name. That is the classic failure
of a closed-set classifier asked an open-set question.

Absolute evidence answers the open-set question better than relative evidence does:

| signal | separation |
|---|---|
| confidence, from the margin (what ships) | 0.789 |
| keypoint inliers, absolute count | 0.777 |
| head score, absolute cosine | 0.815 |
| all three combined, fitted and scored on opposite halves of the scenes | 0.844 |

Separation is the area under the ROC curve: the chance that a present product outranks an absent
one. 0.5 is a coin toss.

So there is a real improvement available and it is not enough. 0.844 cannot be the only thing
standing between a trolley strut and the shopper's bag, which is why no presence score is shipped
from this: a number that looks like a guard and is right five times in six would be trusted
further than it deserves. Two things would change that, and both are outside what has been
measured here. The census path already carries an `isProduct` judgement from a vision-language
model, which is a second opinion from a completely different kind of evidence. And nothing here
has been tested against an actual non-product, because RPC contains none.

## What the last 12% actually is

Worth knowing before spending anything on it. Of 56 errors remaining after reranking, on 465
crops:

- **46% are two variants of one product**, not two different products. One pair of chocolate
  SKUs accounts for 13 errors by itself, a fifth of everything wrong.
- **79% still hold the truth in the top five.** Only 3 errors in 465 put it outside the top
  twenty, so retrieval finds the right neighbourhood almost every time.
- Splitting queries by how close their top two candidates are, **the clear half is 100% correct
  and every error is in the other half.**

So this is not a recognition problem in the ordinary sense. The system knows what kind of thing
it is looking at and cannot tell two near-identical packages apart. That is a different problem
with different fixes, and three plausible ones were measured and rejected.

**Reweighting per regime: no gain, exactly zero.** Fitting separate fusion weights for the
ambiguous and clear halves, cross-fit on scene, scores identically to one global set. The
signals are saturated; the ambiguous half needs different evidence, not a different mixture.

**Geometry as a veto rather than a ranker: 87.7% against 88.0%.** Keypoint matching is the
signal built for near-identical packaging, and on the errors that matter it points the wrong
way: where truth and the top pick are the same product family, geometry favours the wrong
variant 20 times against 4. Two variants share almost all their artwork, so the shared region
dominates the match and the small differing panel is drowned. Using it only to eliminate
candidates with no keypoint support, and letting appearance rank the survivors, is worse than
leaving it as a weighted ranker at every threshold tried. It earns its place by rejecting
unrelated candidates, not by separating variants.

**An angular margin: helps one feature set and hurts the other, so it stays off.** The ArcFace
construction should force a gap between two near-identical SKUs, which is exactly the failure
here. Measured on the same scene split, it does the opposite of what it does on a frozen encoder:

| margin | 0 | 0.05 | 0.10 | 0.20 |
|---|---|---|---|---|
| frozen encoder | **84.1%** | 82.5% | 81.6% | 80.3% |
| fine-tuned encoder | 87.1% | 87.1% | 87.7% | 88.0% |

It costs 2.5 points on the frozen encoder, which is the default deployment, and buys at most 0.9
on a fine-tuned one, inside the standard error of the 156 scenes measuring it. Frozen features
are already spread apart by contrastive pretraining and a margin over-constrains them; fine-tuned
features have collapsed towards their class centres and can afford one. A large margin is worse
again, collapsing the near-identical case it exists for.

This was briefly shipped at 0.1 on the strength of the fine-tuned column alone, which regressed
the default path by 2.5 points until the frozen column was measured. Both feature sets, always.

What is left is better features or a reader. Higher encoder resolution and capacity is one, since
the distinguishing detail between two variants is a small printed panel. A vision-language model
that can read that panel is the other, and it only has to run on the ambiguous half, which is
where every error already is.

## Five views of one crop, averaged

Worth 1.9 points overall and 3.2 on the stacked scenes, with no training and no new model. It is
the second largest single gain measured here and the cheapest by a wide margin.

| queries | R@1 | hard tier |
|---|---|---|
| one view | 86.1% | 83.1% |
| five views averaged | **88.0%** | **86.3%** |

A crop out of a cart is one arbitrary framing of a product. A few pixels more or less around the
edge, a few degrees of rotation, and the encoder lands somewhere else in feature space. Averaging
over several framings cancels that, and it cancels most where the framing is worst, which is
exactly the crowded scenes.

No horizontal flip in the set. Packaging carries text and mirrored text is not something a cart
contains, so a flipped view is a vote cast from evidence that cannot occur.

It also changes what the reranker is worth, which is the part worth reading carefully. Averaging
moves a query towards its class centre and away from any single catalog crop, so a trained head
gains and a nearest-neighbour lookup loses, falling from 88.4% to 80.2% on its own:

| signals, with five-view queries | R@1 | hard |
|---|---|---|
| head alone | 88.0% | 86.3% |
| **head + geometry** | **88.0%** | **87.2%** |
| all four | 87.5% | 86.3% |

So two of the four reranker signals now subtract, and the shipped weights drop them. Two
improvements that each looked good alone overlap: they were both compensating for the same
instability, and once one is in place the other has less to do. Neither was wrong, and adding
them up would have been.

## Two encoders beat one, including the one that is worse

The single most useful thing SigLIP2-L does is disagree. On its own it is the weakest encoder
measured; concatenated with SigLIP-B/16 it is worth 2.1 points, and after fine-tuning the same
trick pays again. Four-fold cross-validation over 60 scenes and three seeds, standard deviation
under half a point throughout:

| | R@1 | hard tier |
|---|---|---|
| SigLIP-B/16 | 84.0% | 81.1% |
| SigLIP2-L | 80.9% | 75.9% |
| **both** | **86.1%** | **83.1%** |
| both plus MobileCLIP | 84.7% | 82.7% |
| fine-tuned B/16 | 86.7% | 83.1% |
| fine-tuned plus SigLIP2-L | 88.5% | 85.8% |
| **fine-tuned plus frozen B/16 plus SigLIP2-L** | **89.2%** | **87.1%** |

What an ensemble needs from a member is different errors, not fewer of them. That is why the
weaker encoder helps and why MobileCLIP does not: it is a third opinion that agrees too often
with the first two, and it costs accuracy rather than buying it. It is also why a fine-tuned
tower is kept alongside the frozen one it came from rather than replacing it, worth 0.7 points.

This is the reading that makes the previous section's result useful rather than merely
disappointing. A larger encoder is not better at this task on its own and is still worth having,
because it is wrong about different crops.

## A larger encoder is worse, not better

The small encoders were chosen on the reasoning that the matcher had to be edge-deployable. It
does not: it runs server-side in the same container as a 700MB detector. That reasoning was
wrong, and correcting it did not help, which is the more useful finding.

| encoder | parameters | easy | medium | hard | R@1 | R@5 |
|---|---|---|---|---|---|---|
| MobileCLIP-S2 | 35M | 92.6% | 66.4% | 65.2% | 71.2% | 89.7% |
| SigLIP-B/16 | 86M | 94.7% | 79.0% | 77.5% | 81.5% | 95.1% |
| **SigLIP-B/16, fine-tuned** | 86M | **96.8%** | **85.3%** | **83.7%** | **86.9%** | **97.6%** |
| SigLIP2-L/16 at 256px | 316M | 94.7% | 78.3% | 73.6% | 79.4% | 96.1% |

A model three and a half times larger, from a newer and stronger family, at a higher input
resolution, scores two points *below* the small one and seven and a half points below the small
one after fine-tuning. It is worst exactly where the product hurts most, the stacked scenes,
73.6% against 83.7%.

The lesson is that this task is not bottlenecked by how good the general-purpose features are.
Web-scale contrastive training buys semantic breadth, which is the ability to tell a chocolate
bar from a milk carton, and the remaining errors are not that. They are two chocolate bars from
one brand. Nothing in a general pretraining objective rewards separating those, so more of it
does not help, and a few minutes of training on the store's own catalog does.

Capacity is not the lever. Adaptation is, and after adaptation the lever is something that can
read the packaging.

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

**A larger encoder than SigLIP-B/16.** ViT-L-14 is registered in `encode.py` and was started,
then stopped at 35% of the catalog. It was running at roughly a sixth of SigLIP-B/16's rate on
this machine and needed another 1.6 hours of the same GPU that fine-tuning needs. The question
it answers is marginal next to the one fine-tuning answers, so it lost the slot. Recorded as
unmeasured rather than dismissed.

**A vision-language reranker.** Sending the crop and its five candidates' reference images to a
model and asking which matches is the obvious source of the new evidence the fusion needs. It is
unmeasured because the key is deferred, not because it was judged unpromising.

**Anything about a real cart.** The paired cart photographs specified in
`server/eval/corpus/README.md` are still outstanding, and until they exist every number here
describes a tray.

Two of these have since been partly answered on a denser corpus, and the answers are in
[`SHELVES.md`](SHELVES.md): naming falls from 88.0% to 49.3% when the background stops being
white, fine-tuning is worth twice as much there as it is here, and the confidence floor fitted on
this corpus admits every crop on that one.
