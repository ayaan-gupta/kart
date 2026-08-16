# Enumeration recall: what the detector actually finds

Companion to `detector-decision.md`. That document settles which detector and which
architecture. This one measures the number that sets the ceiling on everything above it: of the
items in a cart, how many does the enumerator find at all.

## Why this exists

The 56% recall quoted for SAM2.1-tiny was judged by eye from annotated overlays. No labelled
ground truth was ever stored, so no configuration change could be evaluated and no two detectors
could be compared. Every tuning decision was guesswork wearing a number.

## Method

One point per distinct purchasable item, placed inside that item by eye from a 5% grid overlay,
on the 768x768 frame the detector sees. 92 items across five photographs.

Two numbers, because they fail differently:

- **covered**: some proposal contains the item's point. Lenient by design: one mask over the
  whole cart "covers" everything and is worth nothing.
- **isolated**: some proposal contains the item's point and no other item's point. This is the
  one that matters, because a Set-of-Mark badge on a region spanning four products asks the model
  to name four things at once.

Fragmentation is reported but not penalised. A product split into a box and its label still gets
a badge on the box, and the census layer's `inViewCounts` clamps the quantity anyway.

The labels carry my error, so treat the absolute numbers as approximate. Comparisons between
detectors on the same points do not carry it, and comparison is what these are for.

## Only half the corpus was usable

Of the ten cart photographs collected, five depict what the app does: a loaded cart seen roughly
bird's eye with loose items in view. The other five are a parking lot of tied grocery bags, a
frame 60% filled by a handwritten shopping list, a side view of bread bags, a cart of identical
water multipacks, and one similar. Recall averaged over all ten measures the corpus, not the
product. Only the five are scored here, and `server/eval/corpus/README.md` now says what a
usable photograph looks like.

## Results

### The enumerators, on the same 92 items

| enumerator | proposals per photo | covered | isolated |
|---|---|---|---|
| EdgeTAM AMG as previously configured | 44 | 0.456 | 0.380 |
| EdgeTAM AMG, thresholds loosened, 24 points per side | 104 | 0.652 | 0.587 |
| EdgeTAM AMG, thresholds loosened, 32 points per side | 131 | 0.717 | 0.641 |
| Grounding DINO base, boxes | 19 | **0.924** | 0.305 |
| Grounding DINO base, each box turned into a mask by SAM | 19 | 0.869 | **0.348** |

"As previously configured" was `pred_iou 0.7, stability 0.9`, keeping masks between 0.15% and
25% of the frame. Loosening those to `0.6, 0.85` and 0.05% to 40% took isolated recall from 0.380
to 0.587 and ran faster, because the area filter was discarding real items at both ends. That is
a free 55% relative improvement that had simply never been measured.

### The badge budget is what actually decides this

Every proposal becomes a numbered badge burned onto the frame. A frame carries perhaps 30 before
the badges start covering the products they point at. So the honest question is not what recall a
configuration reaches with 131 proposals, it is what recall survives a cap.

Ranked by the generator's own quality signal, `predicted_iou * stability_score`:

| badges kept | covered | isolated |
|---|---|---|
| 20 | 0.228 | 0.206 |
| 30 | 0.250 | 0.228 |
| 40 | 0.326 | 0.305 |
| 60 | 0.457 | 0.402 |
| all 131 | 0.717 | 0.641 |

**SAM's automatic mask generator cannot rank its own output.** If it could, the top 30 of 131
would hold most of the real products and recall would fall gently. Instead two thirds of the
recall is gone by the time the budget bites: at 30 badges it finds under a quarter of the cart.
The scores it reports measure how confidently it segmented a region, which is not at all the same
as whether the region is a product, so cart mesh, shadows, box faces and label panels outrank
whole items.

Grounding DINO gets 0.924 coverage from **19** proposals. That is better coverage than the mask
generator reaches with 131, from a seventh as many badges, because it was asked for objects
matching a description rather than for every stable region. Turning each of its boxes into a mask
with SAM raises isolated recall from 0.305 to 0.348 and costs nothing extra in badges.

### Recommendation

Enumerate with a grounded detector, not with segment-everything. Use SAM only for the shape,
prompted with the detector's boxes. On the measured numbers that is roughly four times the recall
per badge.

The catch is where it runs. Grounding DINO base is a 700MB PyTorch model with a text encoder, not
something to convert to Core ML on a weekend. Capture-then-process is what makes this plausible:
the captured frame already goes to a server, so the enumerator can go with it. OWLv2 is the
alternative worth measuring next, being ViT-based and a friendlier conversion target if
enumeration has to stay on the phone.


## What this changed in the code

Two defects, both found by having a number rather than an impression.

**The tracker was a ceiling on quantity.** The in-view clamp read
`min(trackCount, modelCount)`, so the model could only ever revise a count downward. Its own
comment claimed the opposite: "where it disagrees with the tracker, it wins". With enumeration
recall at 38%, one polygon landing on a row of three cartons capped the bag at one. The clamp now
takes the model's count outright, in both directions. The high-water mark across keyframes is
unchanged, so panning away and back still cannot double count.

**Items the model saw were thrown away.** `unmarkedItems` is the channel the census prompt gives
the model for products no badge landed on. It reached the client, fed one occlusion heuristic,
and was discarded. Given the recall above, that is most of a cart: the app could see an item,
name it, and then drop it because no polygon happened to cover it. Unmarked items now reach the
bag. They arrive with a name and no outline, which is the honest rendering of "seen but not
located", and the bag already handles a missing photograph.

Making that work needed one wire change. An unmarked item had only a free-text description, and a
description carries no brand, so "Froot Loops" keys as `::froot loops` and would never meet the
badge's `kelloggs::froot loops`. One box, two bag lines. `unmarkedItems` now carries the model's
own `productKey`, the same string it already computes for `inViewCounts`, so the join is exact.

The census prompt was scoped to the cart at the same time. It used to say "count what is visible
in this image", which was harmless while the tracker capped the count and is not harmless now: a
shelf behind the cart would inflate the bag.

## Measured against the live model

With a working API key the whole pipeline ran end to end on three of the labelled photographs:
real detector proposals, the real Set-of-Mark composite, the real census call, the real counting
rule. That turned up two defects that only real model output could show, both now fixed.

**Badges on non-products became bag lines.** Rule 8 told the model to describe a badge that had
landed on nothing, which is right, and gave it no way to say the region was not a product. It
described them accurately and confidently, so the bag filled up with them: `1 x shopping cart
frame`, `2 x dark clothing/leg in background`, `2 x paper grocery bag handle`, `1 x empty region,
no product`. Confidence could not filter these, because the model was correct and sure: it rated
the cart frame 0.98. Marks now carry an explicit `isProduct` boolean, and on a re-run the model
used it exactly as intended, rejecting cart frames at 0.97 to 0.99 and a shopper at 0.98. On one
photograph 13 of 22 badges were non-products, which is what a 38% enumerator looks like from the
model's side.

**The two key spaces disagreed.** A mark named "packaged carrots" derives `::packaged carrots`,
while the same carrots came back as an unmarked sighting keyed `::carrots`, so the bag showed four
carrots where there were two. An unmarked item is now matched against both spellings before it is
allowed to open a new line.

Bag totals against hand-labelled units, across the three photographs:

| | bag units | vs 48 labelled | junk lines |
|---|---|---|---|
| before | 72 | +50% | 8 units of cart frame, leg, bag handle, empty region |
| after | 45 | -6% | none |

The remaining error is not one-sided any more, and nothing in the bag is furniture.

Worth noting what the model is good at. On the Walmart cart it reported 21 units against 20
labelled, and per-product attribution was imperfect while the total was nearly exact. Counting a
handful of things in one image is the job it does well, which is the assumption the counting rule
was built on, and it holds.

## Can the model do the detector's job?

Asked directly for every product in the cart with a bounding box, no detector involved:

| enumerator | boxes per photo | covered | isolated |
|---|---|---|---|
| gpt-5.4-mini | 15 | 0.870 | 0.283 |
| gpt-5.4 | 16 | **0.902** | 0.380 |
| gpt-5.4-mini boxes refined into masks by SAM | 15 | 0.478 | 0.337 |

gpt-5.4 finds 90% of the items with names attached, from a sixth as many proposals as the tuned
mask generator needs to reach 72%. Its `isolated` score of 0.380 equals what the original detector
managed, which is the more interesting comparison: the model matches the detector's usable output
while also saying what each thing is.

But the third row is the catch, and it is why the detector does not simply go away. Refining those
boxes with SAM **halves** coverage, 0.870 down to 0.478, where the same refinement of Grounding
DINO's boxes barely moved (0.924 to 0.869). The model's boxes are placed well enough to say "a
product is here" and not tightly enough to say "this exact region is the product", so SAM latches
onto whatever the offset box actually contains. Rendered over the frame the pattern is plain: the
names are right, the boxes drift and run large.

So the division of labour is settled by measurement. **Naming and counting belong to the model**,
which is why unmarked items now reach the bag. **Outlines belong to the detector**, because only a
tight box makes a mask worth drawing, and items the detector cannot locate should appear in the
bag without an outline rather than not at all.

## Can the phone turn the model's boxes into outlines on its own?

If it could, the product would need no detector and no new infrastructure: one model call
enumerates and names, and the device draws the shapes. `VNGenerateForegroundInstanceMaskRequest`
returns one whole-cart blob on a full frame, which is why it was written off, but "separate the
salient object from the background" is a much easier question when the input is a crop holding
mostly one product. That was worth measuring rather than assuming.

Each of gpt-5.4's boxes was cropped with 12% padding, run through the request, and the largest
instance traced into a polygon the way `MaskContour` traces one on device.

| | covered | isolated | boxes yielding a mask |
|---|---|---|---|
| the model's boxes, unrefined | 0.902 | 0.380 | 79 of 79 |
| cropped and segmented on device | 0.739 | 0.196 | 60 of 79 |

It costs about 25ms per box after warmup, so a whole cart is well under a second, and that is not
the problem. The problem is that it loses 16 points of coverage and half the isolation, and a
quarter of the boxes produce no mask at all. Better than prompting SAM with the same boxes on the
full frame (0.478), still a clear regression on doing nothing.

**So there is no route to real outlines that avoids a real detector.** Grounding DINO's tight
boxes refine cleanly (0.924 to 0.869); nothing else measured here does. That makes where the
grounded enumerator runs a live question rather than a detail, since it is a 700MB PyTorch model
with a text encoder.

## Counting one item once

The run in `runs/2026-08-16-pipeline-run` put four boxes on two Coca-Cola bottles lying cap-up in
one cart: three nested on the lower bottle, one on the upper. Across three censuses the model
named them "cola soda", "Coca-Cola can", "Coca-Cola" and "soda can", so they became four product
keys, and the bag opened with four units of a two-bottle cart, all called cans.

The in-view clamp could never have caught this. It groups live tracks by product key, and these
carried four different keys; nothing in the pipeline ever compared two live tracks to each other.
Geometry is what settles it. By IoU the duplicates score 0.23 to 0.63, indistinguishable from two
adjacent products. By containment, how much of the smaller box lies inside the larger, the true
duplicates score 0.93 to 1.00 and the true neighbours score 0.00.

`applyCensus` now takes the live boxes and folds a track whose box sits at least 85% inside
another's into the existing `merged` set, which already means "keeps its outline, stops counting".
The **smaller box always survives**. That is not a preference for tighter crops, it is the only
rule that is right in both cases nesting can mean: two proposals on one bottle, where the tighter
one is simply better, and a proposal covering a row of four milk cartons alongside a proposal on
each carton, where the large box is the mistake. Keeping the larger was tried first, on the
grounds that the more trusted identity should win, and it folded 14 of 24 tracks on a real cart
and returned a twenty-item cart as six units.
The loser's key is aliased onto the survivor's so the quantity it accumulated migrates instead of
stranding in a second bag line. A brand disagreement blocks the fold, because nesting between two
brands is a multipack rather than a duplicate, and two decoded barcodes never fold at all.

Two prompt rules went alongside it: name the whole object rather than the face pointing at the
camera, since a bottle seen cap-down is still a bottle; and use one name for one product
throughout a response.

Measured on the five photographs, sum of per-photo unit error against 92 hand-labelled units:

| configuration | total units | sum of per-photo error |
|---|---|---|
| before | 93 | 21 |
| geometric fold plus the two naming rules | 91 | **11** |
| and also tightening the unmarked-items rule | 74 | 18 |

The Coca-Cola case goes from four units across three lines, called cans, to two units across two
lines, called bottles.

The third row is a rejected change, kept here because the mechanism is worth remembering.
Telling the model that unmarkedItems is "only for what the badges genuinely missed" made it shy,
and the photograph with the fewest proposals, which depends on that channel most, lost half its
items. The net total looks closest to 92 in the first row, which is why per-photo error is the
number to read: errors in opposite directions cancel in a sum and do not cancel in a shopper's
bag.

These are single runs against a stochastic model. The fold is deterministic and covered by unit
tests; the prompt rules are one sample each, and the mechanism, not the margin, is the evidence.

## What is still open

- The photographs cannot be committed, because they were collected without recording source URLs
  and licences. Anyone extending the corpus should record a manifest as they go.
- Whether tighter prompting, or asking for a point rather than a box, closes the localisation gap
  that stops the model's own boxes from being refined into outlines.
- The formal eval harness still has nothing to score against: `ground-truth.json` needs per-photo
  product names, which is a different labelling job from the points used here.
- Grounding DINO is a 700MB PyTorch model. Nothing here says how to run it on a phone, and the
  capture-then-process architecture is what makes running it on a server plausible at all. With
  crop-and-segment now measured and rejected, this is the one decision standing between the
  measured pipeline and a shipped one.
- Two bag lines can still hold one product under two names when both carry a badge, since the
  fold only claims boxes that are physically nested. Name-level merging is a separate job and
  needs the name-level ground truth that does not exist yet.
