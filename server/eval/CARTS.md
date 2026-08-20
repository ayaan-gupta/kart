# Carts, hauls and video: the whole pipeline, end to end

`CATALOG.md` measures naming on products laid out on a white tray. `SHELVES.md` measures naming
and detection on real store shelves. Both measure one stage at a time on one still image.

This one runs everything at once, on photographs of loaded shopping carts and grocery hauls, and
then on video, which is the only way to test the half of the system that is about time.

A composition can be worse than either half. An item the detector misses is not a naming error,
it is simply absent. A box drawn around two items produces a confident name for a thing that does
not exist. A name that arrives on frame 12 is worth nothing if the track carrying it dies on
frame 13.

## The corpus

**24 photographs**, curated from 115 fetched under open licences with their provenance recorded
at fetch time (`corpus/fetch_carts.py`, `cart-manifest.json`, `cart-curation.json`). Six are
products inside a shopping cart, which is the exact use case. Eighteen are a shop's worth of
products piled on a counter, which is accepted because it has the property a shelf does not:
products at angles, overlapping each other, rather than faced in rows.

The yield is recorded rather than hidden. A keyword search on a photo aggregator returns nests of
empty trolleys, aisles, a tram, chefs dicing potatoes and a vernier caliper. 115 images yielded
24, and every one of them was looked at on a contact sheet.

**360 frames of video**, sampled at the app's own detector rate from four thirty-second segments
of a Costco haul filmed handheld (CC BY 3.0, Wikimedia Commons). Someone walking a full trolley
through a warehouse and then panning over the unloaded pile. Motion blur, changing exposure,
items entering and leaving frame, the same item seen from four angles.

## What this corpus can and cannot answer

| | |
|---|---|
| detection and counting | yes, and this is what it is for |
| covered items | yes. A pile is the geometry the depth cue was reasoned about |
| low confidence | yes, in its hardest form. See below |
| tracking, fusion, the keyframe gate | yes, and nowhere else in this repository |
| naming accuracy | **no.** There is no catalog for these products |

The last row is the important caveat. These are American and European groceries and the only
catalog available is Indian. Naming accuracy stays measured on Grocer-Help, which has 623 real
products and a genuine closed world. What the mismatch buys instead is the open-set test, and it
is a harder and more valuable one than a closed-set number: **every item is outside the catalog,
so the correct behaviour is to decline every single one.**

## The floor was wide open, and this is what proved it

348 regions, none of them a product the catalog contains.

| floor | named | declined |
|---|---|---|
| 0.48 (inherited from the tray corpus) | 100.0% | 0.0% |
| 0.70 | 44.8% | 55.2% |
| 0.87 (fitted on real shelves) | 6.3% | 93.7% |
| 0.95 | 0.3% | 99.7% |

At the shipped floor the matcher named every single unfamiliar product, at a median confidence of
0.68. It does not degrade on things it has never seen. It asserts. Nothing would ever have gone
amber and the shopper's bag would have filled with confident nonsense they were never asked
about.

The same constant that rejects 89.7% of these still names 53% of in-catalog shelf crops at 90%
precision, so this is not a matter of trading coverage for safety on one axis. The tray value was
simply wrong for real imagery, and the tray is the least cart-like of the three corpora.

## Three defects the overlay had, all found by looking at it

Numbers cannot tell you that a box is drawn around a whole trolley. `render_carts.py` draws the
four states over the photograph they came from, using the states the TypeScript engine computed.

**A box that encloses an item was hiding it.** The detector proposes a region over the whole
trolley. It has the lowest bottom edge in the frame, so the depth cue reads it as nearest, and
its overlap with everything inside it is total. One such proposal marked every item in the cart
as covered: 16 to 25 per cart photograph against 2 to 6 per haul, which has no trolley in it.
Occluders that contain the subject are now excluded. The argument is not that they are unhelpful,
it is that they are not evidence: we are looking at this item because the detector found it,
which means it is visible, so whatever encloses it entirely is not what is in front of it.

**The amber state was unreachable.** It required an identity that scored below GREEN_CONFIDENCE,
and the matcher's floor sits far above that, so anything named was automatically green and
anything declined had no identity at all and drew as a plain outline. An item the system examined
and could not name looked exactly like one nothing had looked at yet. With the floor where real
imagery needs it that was 90% of regions: the commonest outcome in the whole pipeline, with no
colour of its own.

**The trolley box survived to the bag.** Fixing the inverted size guard in the de-duplication was
necessary, but it handed back the group boxes the broken guard had been removing by accident. A
third pass counts members instead of measuring size, because what identifies a group is not that
it is large but that the things inside it were separately proposed.

Together, on the same 24 photographs:

| | green | amber | covered | plain |
|---|---|---|---|---|
| before | 8.3% | 0.0% | 55.5% | 36.2% |
| after | 9.6% | 57.9% | 32.5% | 0.0% |

Amber dominating is the correct answer here, not a failure: these are products the catalog does
not contain, and the system saying so on every one of them is the fourth capability working.

## Video: the half that had never been measured

Four thirty-second sessions, frames fed to the real `processFrame`, `applyCensus` and
`outlineStateFor` at three frames a second.

| segment | frames | ids | confirmed | median life | longest | peak | census | bag units |
|---|---|---|---|---|---|---|---|---|
| 205s | 90 | 131 | 44 | 8 | 29 | 15 | 8 | 0 |
| 245s | 90 | 138 | 47 | 6 | 58 | 11 | 8 | 3 |
| 320s | 90 | 129 | 51 | 7 | 56 | 11 | 8 | 4 |
| 425s | 90 | 135 | 63 | 11 | 57 | 18 | 8 | 3 |

**The tracker works.** The first version of this harness reported "131 distinct ids against 15
concurrent items" and the conclusion drawn from it, that tracking was broken, was wrong. Every
unmatched detection mints an id, so an unstable detector inflates that number without the tracker
doing anything at all: 82% of detections have a partner in the next frame at or above the
configured `minIou`, with a median IoU of 0.70. What matters is that a confirmed track survives a
median of 6 to 11 frames and up to 58, which is two to nineteen seconds. That is a real window
for an identity to attach and persist.

**The keyframe gate is well calibrated, and nearly got changed on the strength of a harness bug.**
The first measurement reported a median motion of 0.129 against a ceiling of 0.06 and a gate that
fired 9 times in 360 frames. Motion had been computed between frames the detector saw, a third of
a second apart, rather than between adjacent camera frames as `FrameMetrics` computes it. In the
right units the median is 0.0247 and **91.8% of frames pass the ceiling**; 96.1% clear the
sharpness floor and 87.8% clear both. The gate's dominant verdict is `too-soon`, its own pacing
limiter, not `moving`. Two constants documented as guesses are now measured and both stand.

**The census budget is spent in the first fifteen seconds.** Every session used all eight calls
by 13.7 to 16 seconds of a thirty-second segment, every call landing on the same items as the
camera lingered, and everything entering frame afterwards was never examined. The last frame of
each session is dominated by tracks nothing has looked at.

`worthACensus` now declines to spend the second half of the budget on a frame where every
confirmed track is already named. **It changes nothing on this footage**, and the reason is worth
stating: with a catalog containing none of these products, nothing is ever named, so every frame
genuinely holds unexamined items and the rule never fires. It is correct for a deployment with
the store's own catalog and inert here, and it is recorded as such rather than as an improvement.

## What is still missing

**Naming on cart imagery.** It needs a catalog for these products, which 24 photographs cannot
build. The number quoted for naming is the shelf number and belongs to shelves.

**Counting accuracy.** Neither corpus here carries per-item ground truth. Detection recall is
measured on shelves, where the annotation permits it; nobody has counted the items in these 24
photographs, so no count error is claimed.

**The census.** Every identity in every number above is the catalog matcher's own decision,
standing in for a model that would choose among the candidates it offers. That step has still
never executed.
