# Real store shelves: what changed when the corpus stopped being a white tray

Naming and detection, one stage at a time, on still photographs of shelves. The whole
pipeline run end to end on carts, hauls and video is in [`CARTS.md`](CARTS.md), and the
original white-tray numbers are in [`CATALOG.md`](CATALOG.md).

Every accuracy number this project quoted before this file came from RPC, which photographs
individual products laid out on a clean background, evenly lit, unoccluded, one camera. On RPC
the pipeline names 88.0% of crops correctly.

On real store shelves it named 49.3%.

That gap is not a regression and nothing broke. It is the difference between the corpus the work
was tuned against and the thing the product is for, and it had been invisible because no corpus
in the repository contained a crowded scene.

## The corpus

Grocer-Help: 6,289 distinct photographs of Indian grocery shelves, freezers, chest coolers and
baskets, carrying 84,743 labelled instances across 623 product classes. Shelves rather than
carts, which is a real limitation and is stated again at the bottom. What it does contain, and
RPC does not, is density: a median photograph holds eight labelled items and the largest holds
198, behind wire racks, behind price tags, and behind each other.

Reading it correctly took three fixes, and the first was a bug in this repository's own first
attempt at it.

**Two label formats are mixed.** 5,202 files are YOLO detection (`class cx cy w h`), 317 are
YOLO segmentation polygons (`class x1 y1 x2 y2 ...`), and 858 files contain both, together 16%
of all instances. Reading a polygon line as a box raises nothing and returns geometry that is
simply wrong. The first pass rendered those boxes over the photographs, saw garbage, and
concluded the corpus was noisily labelled. The corpus was fine; the reader was not. This is the
failure mode the whole `server/eval/grocer` module is shaped around, and `test_grocer.py` spends
most of its weight there.

**1,141 of the 7,430 shipped photographs are byte-for-byte duplicates** of another, and 69
appear in both the shipped `train` and `valid` directories. Scoring against the shipped split
leaks. Photographs are pooled, deduped by content hash, and re-split by content, never by crop:
two crops from one photograph share lighting, camera, angle and often the product.

**Classes are brand-level and inconsistently so.** `Aashirvaad` covers that brand's atta, besan
and chilli powder alike; `Butter_Amul` names one product. The vocabulary also carries category
catch-alls (`Soap`, `Pulses`, `Drinks`) that overlap the brands inside them, and spelling
duplicates for single products. `ALIASES` folds the duplicates and nothing else is merged.

## What moved the number

All four runs score the same 1,500 query crops, of which 1,442 belong to one of the 292 products
the catalog holds, using one encoder (SigLIP-B/16) and the shipped fusion.

| change | top-1 | top-5 | shortlist ceiling |
|---|---|---|---|
| references filled greedily per class | 49.3% | 66.7% | 72.9% |
| references spread across photographs | 56.4% | 73.1% | 79.8% |
| plus one epoch of fine-tuning | 67.6% | 80.7% | 85.0% |
| plus test-time augmentation | 67.4% | 81.2% | 85.4% |

The top-1 column above counts a declined crop as an error, which is what the product does. The
confidence floor changed partway through this work, so a run made after the change is not
comparable to one made before it on that column alone. Ignoring the floor and asking only whether
the winner was right, the three runs whose per-crop outcomes were kept read 58.9%, 67.6% and
67.4%. The first row predates the harness saving per-crop outcomes, so it has no floor-independent
figure and none is given for it. Top-5 and the ceiling never depended on the floor.

**Spreading the references is worth 7.1 points and costs nothing.** A shelf presents a dozen
faces of the same soap, so a per-class cap of 40 was filled by the first two photographs that
contained the product, and the reference set then described two lighting conditions and two
camera angles. The median class drew its references from seven photographs; 130 of 343 drew from
five or fewer. Capping at three faces per photograph as well spends an identical budget across
more than twice as many scenes. Nothing about this is specific to this corpus: it is a statement
about what a reference set is for, and it applies to whatever a store hands over.

**Fine-tuning is worth 11.2 points here against 5.9 on RPC.** Held-out catalog accuracy for the
head goes from 70.7% to 78.4%. The gain is larger than on RPC for the reason it should be: the
domain gap is larger. A frozen encoder trained on web images has never seen a product at this
angle, at this scale, behind this much wire.

**Test-time augmentation is worth nothing here**, against 1.9 points on RPC, for five times the
encoding. The crops are tight annotator boxes on a crowded shelf, so cropping to 80% of one
discards packaging that carries the answer and rotating it fills the corners with white. It
stays enabled by default because RPC is the corpus the default was measured on, but a deployment
that looks like this one should turn it off and get its latency back.

**The two-encoder ensemble is worth 5.4 points here against 2.1 on the tray**, and every row of
the table above uses one encoder while `DEFAULT_ENCODERS` ships two. Measured on the same 1,500
crops, ignoring the floor so the runs are comparable:

| encoders | top-1 | top-5 | shortlist ceiling |
|---|---|---|---|
| SigLIP-B/16 | 58.9% | 73.1% | 79.8% |
| SigLIP-B/16 + SigLIP2-L/16 | 64.3% | 79.7% | 85.0% |
| SigLIP-B/16, fine-tuned | 67.6% | 80.7% | 85.0% |

The frozen ensemble reaches the fine-tuned encoder's shortlist ceiling without any training at
all, and lands within three points of its top-1. For a store unwilling to label carts, which is
what fine-tuning requires, that is the configuration to ship. It costs six times the encoding
time, and encoding is a per-catalog cost rather than a per-scan one.

**Refitting the fusion weights is worth nothing.** Fitted on half the photographs and reported on
the other half, the best weighting scores 74.6% within the shortlist against 74.5% for the
RPC-fitted weights. Recorded because three regressions in this project came from carrying a
constant across feature sets, and "we checked and it did not need changing" is worth the same as
a change.

## The floor was wide open, and nothing said so

`FLOOR` decides whether a name is added silently or offered to the shopper as a question. It is
the mechanism behind capability 4 in CLAUDE.md, and behind the amber outline.

It was fitted on RPC at 0.51, where it names 95% of crops and is right about 90% of them.
Carried onto shelves, it admits every crop:

| floor | names | right |
|---|---|---|
| 0.48 / 0.51 (shipped) | 100.0% | 67.4% |
| 0.70 | 75.3% | 79.6% |
| 0.884 (fitted here) | 51.6% | 92.5% |
| 0.95 | 35.2% | 93.9% |

The failure is not that accuracy is 67%. It is that at the shipped floor the matcher declines
nothing, so all 33 points of error arrive as confident answers, and the interface never has
cause to draw a single amber outline. The system does not degrade visibly. It goes quiet about
being wrong, which is the one failure a shopper cannot catch.

`rank.fit_floor` is the criterion the floor was always chosen by — the lowest cut at which the
names added silently are right 90% of the time — written down as code so it is re-run per
feature set rather than re-derived. It refuses to reach the target by naming almost nothing,
both as a share and as an absolute count, because a precision estimated from four crops is not a
precision.

The shipped constants stay at RPC's values. They are what the RPC numbers were measured with,
and changing a global default on the strength of one corpus is precisely the mistake that cost
2.5 points when an angular margin measured on fine-tuned features was made universal. A store
fits this the way it fits the fine-tune: on labelled carts of its own.

## Detection is the binding constraint, and the pipeline was deleting its own findings

Naming can only ever name what the detector proposes. On RPC the enumerator finds 86% of
labelled instances. On these shelves, at the shipped threshold, it found 35.3%.

Splitting the pipeline apart showed the model was not the problem:

| threshold | de-duplication | raw boxes/scene | kept | recall | precision floor |
|---|---|---|---|---|---|
| 0.23 | shipped | 12.0 | 8.4 | 51.3% | 48.3% |
| 0.23 | off | 12.0 | 12.0 | 66.8% | 44.3% |
| 0.12 | shipped | 107.4 | 36.1 | 28.1% | 6.2% |
| 0.12 | off | 107.4 | 107.4 | 85.9% | 6.4% |

(25 photographs. Precision is a floor throughout; at 0.12 it is a very low floor and that
configuration is not a candidate, it is a diagnostic.)

Grounding DINO proposes the items. `dedupe` then removed them. The cause was a single inverted
comparison in its second pass, which drops the larger of two boxes when one sits inside the
other. The pass is guarded by `NESTED_MAX_RATIO` so that it only fires on boxes of comparable
size, on the reasoning that a small box inside a much larger one is two real items, one standing
in front of the other, and deleting the larger one deletes the item being occluded. The guard
compared the *smaller* box's area against four times the larger's. The pass visits boxes
smallest first, so that comparison is always true and the guard never fired once.

An item with something standing in front of it is not an edge case here. It is the case the
product exists to notice, and the pipeline was silently deleting it.

Fixed, on the same 25 photographs at 0.23: recall 51.3% to 60.3%, precision floor 48.3% to
49.6%. On the full 100: 35.3% to 39.3%. On RPC, unchanged threshold: recall 86% to 92.9%,
precision 89% to 89.3%, count error 0.37 to 0.72.

That last number is a genuine regression and it is a corpus artefact. Products laid out on a
white tray almost never truly nest, so the broken guard only ever fired there on spurious group
boxes, where deleting the larger box is right. It looked like a working rule because the only
corpus that could see it had none of the case it breaks.

The threshold stays at 0.23. Re-tuning it now would mean tuning on the corpus that cannot show
the failure just fixed, and this repository has paid for that mistake twice already.

### The prompt was the largest single lever, and it had never been measured

`GROCERY_PROMPT` was written by looking at overlays on five cart photographs. It carried one real
finding from that exercise, that container words made the model propose the trolley, and nothing
else about the phrase list had ever been tested. Detection is the binding constraint on this
product, and the prompt is the cheapest thing that could move it.

Nine shape words ("a product. a box. a bottle. a carton. a can. a jar. fruit. a vegetable. a
tub.") against three grocery nouns ("a grocery product. a packaged food item. a drink
container."), on 200 photographs holding 2,585 labelled instances:

| prompt | recall | precision floor | 1-12 | 13-25 | 26+ |
|---|---|---|---|---|---|
| nine shape words | 39.0% | 42.6% | 54.7% | 46.7% | 30.2% |
| three grocery nouns | **54.1%** | **44.1%** | 57.8% | 58.0% | **51.1%** |

Better on both axes, and the gain is largest exactly where the product is worst. On RPC the same
change takes recall from 92.5% to 98.3%, precision from 89.2% to 99.6%, and count error from 0.68
items per scene to **0.10**.

`"a product."` alone scores as well on a shelf and was rejected. On the cart corpus it proposes a
box over the whole trolley twice, which is the failure the old list existed to prevent, and it
returns 8.0 boxes per photograph against 11.2. A shelf corpus cannot show that, because there is
no trolley in frame. The three-noun prompt proposes no box covering more than 40% of the frame on
any of the 24.

**Detection remains the binding constraint**, but it is a different size now. On 250 photographs,
3,190 labelled instances, before and after the prompt:

| labelled items in the photograph | photographs | instances | recall before | recall after |
|---|---|---|---|---|
| 1-5 | 114 | 215 | 55.3% | 63.3% |
| 6-12 | 54 | 420 | 48.3% | 57.4% |
| 13-25 | 42 | 743 | 46.8% | 58.8% |
| 26+ | 40 | 1,812 | 28.0% | 47.5% |
| all | 250 | 3,190 | 36.9% | **52.5%** |

By instance size: small 21.1% to 36.1%, medium 33.6% to 51.6%, large 47.2% to 59.6%.

The overall figure is dragged down by the crowded photographs, which hold 57% of all the
instances: a wall of a hundred packets, far more than a cart. A cart holds ten to thirty items,
so the two middle bands are the ones that describe this product, and they now sit near 57-59%.

That is still below RPC's 98.3%, and it is the honest number for cart-like density in a real
store environment rather than on a tray. Where the missing items go: 47.2% of large instances are
found, 33.6% of medium, 21.1% of small. Recall on items the covered rule flags is 24.9% against
38.9% for the rest, so the items most likely to be missed are the ones most likely to be hidden,
which is the compounding failure guided capture exists to interrupt.

Part of the shortfall is the measurement rather than the miss. IoU 0.5 is the detection
convention and it is stricter than this pipeline needs: a matched box is cropped with 8% padding
and handed to the matcher, which wants a crop centred on the right product, not a tight one.
Scored at IoU 0.3 the same run reads

| labelled items in the photograph | IoU 0.5 | IoU 0.3 |
|---|---|---|
| 1-5 | 65.6% | 74.9% |
| 6-12 | 48.8% | 59.3% |
| 13-25 | 47.1% | 51.8% |
| 26+ | 28.0% | 30.7% |

so around nine points of the apparent misses at cart-like density are items the detector did
find and drew a loose box around. Both numbers are reported because they answer different
questions: 0.5 is what a detection paper would print, 0.3 is closer to what this pipeline can
actually use.

### Tiling was tried, and it is a density knob rather than an improvement

Running the detector over a grid of half-overlapping tiles as well as the whole frame is the
standard fix for many small objects, and it was measured as harmful on RPC (-36 points) where
the objects are neither many nor small. On 120 shelf photographs, at ten detector passes per
photograph instead of one:

| labelled items in the photograph | whole frame | plus 2x2 tiles |
|---|---|---|
| 1-5 | 66.1% | 31.3% |
| 6-12 | 50.6% | 40.4% |
| 13-25 | 52.0% | 57.0% |
| 26+ | 30.0% | 50.8% |
| all | 39.3% | 49.8% |
| precision floor | 44.5% | 21.3% |

It nearly doubles recall on the most crowded photographs and halves it on the sparsest, because
a tile boundary cuts a large item into pieces and the pipeline then keeps the pieces. That is
the same effect the RPC measurement saw, and this explains it rather than contradicting it: RPC
is sparse with large items, and so is the low band here.

A cart holds ten to thirty items, which is the two middle bands, where tiling loses ten points
in one and gains five in the other while halving the precision floor and costing ten times the
compute. It is not shipped. It would be the right move for a fixture aimed at a shelf, and this
product is not that.

## Covered items

`hiddenFraction` scores each item by how much of it the items in front of it cover, where "in
front" is the only depth cue two boxes carry: things resting nearer the camera end lower in the
frame. Items scoring at or above 0.2 are named correctly 47.1% of the time against 57.6% for the
rest, which sets `COVERED_FRACTION`.

Ten points is a real signal and a modest one. Two things bound it. The corpus is partially
annotated, so an item covered by an unlabelled product scores zero and sits in the clear group,
which makes ten points a floor rather than an estimate. And boxes are a poor instrument for
occlusion; the strongest available signal is almost certainly the census model's own per-region
read, which cannot be measured until there is a key.

**Silhouette fill was tried and rejected.** For the 13,369 instances carrying a polygon, the
share of its own bounding box an item's outline fills looked like a direct occlusion label, and
it is available at runtime because the detector returns masks. It shows no usable trend: 66.7%,
47.2%, 48.3%, 50.6% across increasing fill bands, with n=12 in the lowest. The annotator
polygons are coarse rather than tight silhouettes.

## What this corpus still cannot tell you

**It is shelves, not carts.** Density, occlusion and clutter are real; the geometry is not. A
cart is looked into from above, its items lie at angles a shelf never produces, and the depth
cue `hiddenFraction` relies on is better founded there than here. The paired cart photographs in
`server/eval/corpus/README.md` remain outstanding and remain the thing that would settle it.

**Counting is not measured and is not reported.** The annotation is partial, so the true number
of items in these photographs is unknown. Recall against labelled instances is honest, precision
is a lower bound, and count error is unmeasurable. Reporting recall as though it were counting
accuracy would be the most misleading number available here, which is why
`score_grocer_detection.py` refuses to print one.

**The classes are not SKUs.** Brand-level labels with category catch-alls make some rows harder
than a store's catalog would be (`Soap` against `Dove`, which is a soap) and some easier (one
answer covers a brand's whole range). It is not a proxy for SKU-level accuracy in either
direction.

**The census has never run on any of it.** Every number here is the local matcher. The step that
reads the flavour text separating two variants of one product needs a key, and there is not one.
