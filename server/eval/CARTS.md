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

## Counting: what could honestly be established

Neither corpus carries a per-item count. The shelf annotation is partial, and on a dense haul or
a filled trolley the true number is not knowable from the photograph at all. Two things could be
done.

**Counted by hand, where a person can actually count.** Every proposal was numbered on the image
and judged one at a time (`corpus/cart-counts.json`, `score_carts_counting.py`). Sixteen of the
twenty-four have been judged; six are countable, and the counts were redone against the
proposals the current prompt produces.

| photograph | real products | proposed | correct | error |
|---|---|---|---|---|
| Asian groceries on a glass table | 7 | 6 | 6 | -1 |
| wine, yogurt, oranges, a six-pack | 7 | 5 | 5 | -2 |
| peanut butter, hummus, bananas | 5 | 6 | 5 | +1 |
| tortillas, spices, bulbs, sprays | 8 | 8 | 7 | 0 |
| two turkey packs and a cheese bag | 3 | 2 | 2 | -1 |
| produce haul laid out on a table | 13 | 7 | 7 | -6 |

Mean signed error -1.5 items, mean absolute 1.8, n=6. Still far too few to quote as an accuracy,
and recorded because the alternative was to say nothing about counting at all.

`correct` counts real products covered by at least one proposal, and it depends on the detector
prompt where `products` does not. All six were re-judged against the current prompt; the first
three had been counted under the shape-word prompt and two of them changed. Every item that drew
nothing is listed individually in `cart-counts.json` rather than summarised, so the next detector
change can recount rather than re-argue.

The sign has flipped since the prompt was chosen by measurement. Under the shape-word prompt
nothing was ever missed and every error was an over-count. The counts now run short.

Note the fourth row. Eight proposals for eight products, error zero, and it is wrong twice: one
proposal is on a napkin holder and one product, a tortilla packet standing behind another,
drew nothing. `correct` is recorded separately from `products` because a harness comparing
totals alone would have scored that photograph perfect.

**The mechanism, measurable across all 24.** Under the old prompt every over-count had one
shape: a proposal sitting inside another proposal. A twin-pack of peanut butter arriving as the
pack and both jars, a six-pack of ale as the carrier and three bottle necks. That is what
`applyCensus` folding by containment exists to fix. It is now down to 2.6% of 268 proposals, and
the errors it explained have gone with it.

### The misses are produce, and it is not a vocabulary gap

Across the six photographs the detector drew nothing for eleven items, and **nine of the eleven
are produce**: seven loose, two in net bags. The other two are packaged items in the one
configuration that also defeats it, an item standing directly behind another and one of two
near-identical bags lying side by side.

| what was missed | count |
|---|---|
| loose produce | 7 |
| netted produce | 2 |
| packaged, standing behind another item | 1 |
| packaged, beside a near-identical one | 1 |

The last row of the table above is the cleanest case in the corpus: thirteen items laid flat on a
table, nothing behind anything, even lighting. All seven packaged items were found. All six
loose or netted items were missed: celery, parsley, a leek bunch, a parsnip, a net bag of
onions, a net bag of potatoes.

None of the three phrases in the shipped prompt names an unpackaged vegetable, so the obvious
move is to add one. It was measured on both corpora and it fails on both.

| prompt | shelf recall | shelf precision | proposals/scene |
|---|---|---|---|
| shipped | 61.2% | 45.9% | 14.8 |
| plus "a fruit or vegetable." | 52.2% | 39.5% | 14.7 |
| plus "a fresh fruit. a fresh vegetable." | 50.8% | 37.4% | 15.1 |

Nine points of recall for no change in how many boxes come back, so the phrase moves boxes onto
worse targets rather than finding more items.

Run directly on the photograph that motivated it, the single-phrase version recovers **none** of
the six and loses the loaf of bread. The split version recovers two, celery and parsley, by
taking the proposals from 7 to 22 and losing the apples and the clementines: two items bought
for fifteen phantom boxes, trading a count error of -6 for one of +9.

Both are kept in `sweep_prompt.py` as recorded negatives so the idea is not had twice. What this
leaves is a real and unexplained limitation rather than a fix: Grounding DINO at the shipped
threshold does not localise loose produce on a table, and telling it the word for produce does
not change that.

## What is still missing

**Naming on cart imagery.** It needs a catalog for these products, which 24 photographs cannot
build. The number quoted for naming is the shelf number and belongs to shelves.

**Counting accuracy, as a number.** See below: three photographs were counted by hand, which is a
characterisation rather than a metric.

**The census.** Every identity in every number above is the catalog matcher's own decision,
standing in for a model that would choose among the candidates it offers. That step has still
never executed.
