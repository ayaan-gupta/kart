# The real trolley: what ten photographs and nine seconds of video changed

Every other corpus in this directory is a substitute. The shelf corpus is Indian retail shelves,
the cart corpus is openly-licensed haul photographs mostly taken on tables, RPC is products on a
turntable. Each was chosen because it could be obtained, and each was documented with what it
could not answer.

This is the thing itself: a phone held over a real trolley in a real shop, six photographs of one
trolley being loaded item by item, four of the shelves it was filled from, and a scan of the
loaded trolley. Provenance is in `corpus/kart/manifest.json`; the files are the owner's and are
not committed.

Six photographs of one trolley being loaded makes the count knowable at every step rather than
only at the end, which is why this corpus is worth more for counting than any other here.

## Four defects, none of which the substitute corpora could show

**Frames arrived rotated.** Phone photographs carry EXIF orientation and every one of these is
orientation 6. Beyond costing the detector accuracy, `isInFront` reasons about which item is
nearer the bottom of the frame, which is a claim about gravity and is simply wrong a quarter turn
out. Neither other corpus carries an orientation tag, so no earlier number moved.

**The trolley was an item in the trolley.** Photographed from inside the basket with one thing in
it, the detector proposes the thing and the whole frame. `degroup` cannot catch that: it needs
five separately-proposed items inside before it fires, and an empty trolley contains five of
nothing. All four sparse photographs carried a box covering 95% to 98% of the frame; no other
photograph in the set carried one above 16.3%. `deframe` is the fix, and it is not an area cap:
29 of the 84,743 labelled shelf instances cover more than 90% of their photograph and every one
is a close-up of a real product. A trolley contains the shopping; an item held up to the lens
contains nothing.

**The keyframe gate delivered nothing.** `MAX_KEYFRAME_MOTION` was 0.06, chosen by eye. On a
nine-second handheld scan it rejected 23 of 27 frames, made one census call and put nothing in
the bag. See `config.ts` for the table; 0.15 is where the gate stops binding and the limiter
becomes the pacing interval that is supposed to do this job.

**A track is not one item.** Four of eleven tracks contain a point where the box slides onto a
neighbour, so labelling a track labels two products as one. References are cut into
appearance-consistent runs at exactly those points before being labelled.

## Counting

| photograph | real | proposed | correct | error |
|---|---|---|---|---|
| one cauliflower | 1 | 2 | 1 | +1 |
| one cauliflower | 1 | 1 | 1 | 0 |
| + sprouts | 2 | 3 | 2 | +1 |
| + asparagus | 3 | 3 | 3 | 0 |
| loaded | 10 | 8 | 8 | -2 |
| full | 16 | 11 | 10 | -5 |

**25 of 33 items counted correctly**, 15 of 17 on the five photographs where the count is
certain. The two `+1` errors are the same object: a white plastic disc moulded into the trolley's
child seat, correctly detected and correctly not a product.

## Naming

References from the video and the four earliest photographs, queries from the two loaded ones,
which contribute nothing to the catalog. Distractors are the whole 292-product shelf catalog, so
the choice is among 562 products.

| configuration | named | right | absent declined |
|---|---|---|---|
| frozen, single encoder | 8/13 | 8/8 | 5/5 |
| frozen, two-encoder ensemble | 7/13 | 7/7 | 5/5 |
| **fine-tuned, single encoder** | **10/13** | **10/10** | **5/5** |
| fine-tuned, two-encoder ensemble | 10/13 | 10/10 | 5/5 |

On this corpus the ensemble adds nothing once the encoder is fine-tuned: identical decisions on
all nineteen boxes, the same +0.05 separation, the same ten named. Top-1 is 92.3% in every
configuration.

Nineteen boxes is not enough to conclude that, and the shelf corpus does not quite agree. On its
1,442 answerable crops, each configuration at its own shipped floor:

| configuration | top-1 | named | precision | right of all |
|---|---|---|---|---|
| frozen, single encoder | 58.9% | 36.1% | 89.6% | 32.3% |
| frozen, two-encoder ensemble | 64.3% | 39.7% | 92.0% | 36.5% |
| fine-tuned, single encoder | 67.6% | 52.6% | 90.0% | 47.4% |
| fine-tuned, two-encoder ensemble | 68.2% | 53.8% | 90.1% | 48.5% |

There the second encoder is still worth 1.1 points of correctly-named crops after fine-tuning,
against 5.4 before it. So the honest statement is that fine-tuning absorbs most of what the
ensemble was providing, not all of it, and dropping the second encoder costs about a point in
exchange for halving the work per crop. That is a deployment trade with a number on it rather
than a free saving.

Both corpora agree on the part that matters more: fine-tuning is worth 11 to 12 points of
correctly-named crops over the shipped frozen ensemble, and the shipped default uses neither
encoder fine-tuned.

Top-1 is 92.3% in all three. Fine-tuning does not rank better here, it calibrates better, and
calibration is the half that decides what the shopper sees. Frozen, a box with no answer scored
up to 0.93 while a correct match could score 0.73, so the ranges overlapped through most of their
mass and only a floor above nearly everything kept false names at zero. Fine-tuned, nothing
without an answer scores above 0.84 and nothing named correctly scores below 0.90.

The shopper's tote bag follows the same path: 0.93 frozen, 0.75 fine-tuned.

## The four capabilities, on the six trolley photographs

| state | share |
|---|---|
| counted, green | 53.6% |
| needs a closer look, amber | 21.4% |
| covered | 25.0% |
| unexamined | 0.0% |

Every region reaches a decided state. The trolley's plastic disc and the shopper's tote both land
in amber rather than green: the system is unsure and says so, which is the fourth capability
doing exactly its job on two objects that are not products at all.

On the four shelf photographs 80.8% is amber, which is correct: those products are not in this
catalog and the system declines all of them.

## Moving the camera recovers what a single frame cannot

IMG_0252 and the video are the same trolley, so the two can be compared directly.

| | products found |
|---|---|
| the best single still | 8 of 10 |
| somewhere in the 27 video frames | **9 of 10** |

The yellow produce bag, which no still ever proposed, gets its own box in frame 4 once the camera
has moved a few centimetres. The tomatoes are never isolated in any frame: they sit between the
purple bag and the apples and are always inside somebody else's box.

This matters more than the difference of one item suggests. Occlusion is the whole of the
remaining count error, and the shipped path is a video scan rather than a single photograph, so
the video number is the one that describes the product. It also says what the `covered` state is
for: an item the system can see is covered is an item it can ask the shopper to move, and moving
the camera alone already recovers some of them.

## The census, as far as it can be taken without a key

The census is built and has never executed. Three of its four parts turn out to be measurable
anyway, and the fourth is the one to check first when a key exists.

**The plumbing is correct.** `census-oracle.ts` supplies the marks a correct model would return,
from the committed per-region labels, and everything downstream is shipped code:

| census | units in the bag | photographs exact |
|---|---|---|
| none, detection alone | 25/33 | 2/6 |
| `isProduct` from a real model | 31/33 | 5/6 |
| a census that answers correctly | **33/33** | **6/6** |

Every count error on this corpus closes when the census answers correctly. Detection recall, the
produce threshold and the covered rule are no longer what limits counting.

That run also exercised two cases nothing had: two egg cartons side by side arriving as two units
rather than one, and a second Muenster that no badge landed on arriving through `unmarkedItems`.
A wrong `isProduct` false is unrecoverable, because `applyCensus` refuses to build a bag line
from an `inViewCounts` entry alone, so a model that rejects a real badge must also list it as
unmarked or the item is gone.

**The question is answerable from a crop.** Qwen2-VL-2B, asked the census's own `isProduct`
question on the same 28 regions, scores 24 of 28 and rejects both plastic discs, which is the
case neither the detector's score nor a negative prompt could reach.

**The compositor is correct.** `compositeMarks` draws the badges on a real trolley photograph,
EXIF orientation honoured, boxes aligned.

**Badge alignment is the part at risk.** Set-of-mark prompting is what no per-crop measurement
can test, and it is where a small model fails outright. On IMG_0249, three items and three
badges, the simplest case here:

| badge | truth | said |
|---|---|---|
| 0 | cauliflower | asparagus |
| 1 | brussels sprouts | cauliflower |
| 2 | asparagus | cauliflower |

Every one misaligned, and every product named is really in the trolley. That is the failure the
census prompt and `match_regions` both carry warnings about, observed rather than reasoned about.

Asking one crop at a time cannot misalign. Same model, same regions: 17 of 23 named correctly,
alignment perfect by construction, and it reads packaging it has never seen, returning "ALASKAN
Sockeye Salmon", "Muenster cheese" and "Eggs" for three out-of-catalog products. It costs one
call per region instead of one per frame.

None of this shows the shipped census failing: a 2B model is not its model, and frontier models
do set-of-mark far better. What it gives is a first diagnostic and a fallback with a number
behind it.

## A census answered by a local model, with no key

`applyCensus` trusts `unmarkedItems`. Every entry not already carried by a live track becomes a
bag line, with no cap and no cross-check against the catalog. That is deliberate and the code
argues for it: enumeration recall is 38%, so a tracker used as a ceiling on quantity is wrong far
more often than it is right, and the model looking at the whole frame is the better witness.

Whether that trust is safe had never been tested, because no model had ever answered. A 2B open
model can, asked three separate questions rather than one, each in the form that measured best:

| question | form | result |
|---|---|---|
| `isProduct` | yes or no, one crop, exclusions spelled out | 24 of 28, rejects both plastic discs |
| the name | one crop at a time | 17 of 23, alignment exact by construction |
| `unmarkedItems` | one question about the whole frame | 9 to 14 products per trolley |

Asking one question to do two jobs does both worse: "name it, or say NOT A PRODUCT" calls the
trolley's plastic disc a product, where the dedicated yes-or-no question refuses it.

| photograph | real | bag | error |
|---|---|---|---|
| one cauliflower | 1 | 1 | **0** |
| one cauliflower | 1 | 1 | **0** |
| + sprouts | 2 | 2 | **0** |
| + asparagus | 3 | 4 | +1 |
| loaded | 10 | 9 | -1 |
| full | 16 | 16 | **0** |

**33 units against 33 real items, four of six photographs exact**, against two of six for
detection alone and six of six for a census that answers correctly. Every sparse trolley is
exact, which is the plastic disc finally leaving the bag and is exactly what `isProduct` is for.
The two that miss cancel: one over by one, one under by one.

Both misses are the stand-in model's naming rather than anything in the pipeline.

On the three-item trolley it called the asparagus "brussels sprouts", so two tracks carry that
name and become two units of it, while the whole-frame question separately and correctly names
asparagus. The asparagus is counted twice, once wrongly as a sprout and once rightly as itself.
On the loaded one it called the purple produce bag "subway sandwich" and offered "mr. lucky
cauliflower" alongside a badge already named "cauliflower".

`applyCensus` handled both correctly given what it was told. Fixing them by matching names more
loosely would be tuning to one 2B model's particular mistakes, which is why it is not done here.

A bigger model was the obvious next move and it does not help. Qwen2.5-VL-3B, asked the same
three questions:

| | 2B | 3B |
|---|---|---|
| isProduct, of 28 regions | **24** | 20 |
| real products kept, of 25 | **22** | 17 |
| non-products rejected, of 3 | 2 | **3** |
| units in the bag, of 33 | **33** | 29 |
| photographs exact | 4 of 6 | 4 of 6 |

The 3B refuses every non-product, including the tote the 2B waves through, and pays for it by
refusing eight real products instead of three. It also fixes the asparagus the 2B called brussels
sprouts, and breaks two things the 2B had right. Four of six either way, on different
photographs.

So the failures are different rather than fewer, and going from two billion parameters to three
is not the axis.

Combining them does not help either, and the reason is worth writing down. The 3B's refusals are
a superset of the 2B's: it refuses everything the 2B refuses and more. So "refuse only if both
refuse" is the 2B exactly, and "keep only if both keep" is the 3B exactly, and no rule over the
two beats the better of them. They are nested, not complementary, which is what an ensemble needs.

The census was designed around a frontier model, and what these three attempts establish is that
the gap is real rather than a matter of picking a slightly larger open model or voting between
two of them.

An earlier run of this reported 37 units and an over-count of four on the fullest trolley, and
blamed the model for listing 24 products in a 16-product basket. That was a parsing fault in the
harness: a reply numbered "1.\nOreo\n2.\nBread" had its bare numbers counted as products. The
model named fourteen. Corrected, and the trust `applyCensus` places in `unmarkedItems` survives
its first contact with a real answer rather than failing it.

## A scan amplifies what a single photograph hides

The stills are one census call each. A scan is up to eight, and the difference is not a detail.

Asked the same three questions on the four frames the keyframe gate actually fires on, the 2B
model put 15 units in the bag against 10 real products, where the same model on the same trolley
as a single photograph put in exactly 9 against 10. Fixing the first of the two causes below
brought that to 11.

Two things compound across calls, and neither can happen when there is only one.

**Names drift.** The same product comes back as "oreo" and "oreo cookies", as "bread" and
"seedstastic bread" and "seedblossom bread", as "baguette" and "baguette bread". Every variant
keys differently and becomes its own bag line. The alias mechanism in `FusionState` is for
linking a barcode to a repeated VLM guess, not for merging name variants, and `productKey`
normalises case, accents and punctuation but nothing else, so two spellings of one product are
two products.

There was a stable identifier for this and the client threw it away. `catalogSku` is required by
`CENSUS_RESPONSE_SCHEMA`, the prompt asks the model which catalog candidate the region is, and
`marksFromRegions` carries each region's shortlist into the request so the model can answer. The
field appeared zero times in `src/`: `recognitionClient.ts` parsed `name`, `brand` and
`isProduct` and dropped it, and `applyCensus` keyed the bag on the free-text name. So the
pipeline did the work to obtain a stable key and then keyed on the one field that varies, which
is not an artefact of a small model: any model writing a name twice writes it slightly
differently, and a SKU copied from a shortlist does not drift.

`markKey` now returns `sku:<sku>` when the model picked a catalog candidate and the name key
otherwise, which takes the video from 15 units to **11 against 10**. The change is additive: a
mark with no SKU keys exactly as it did. `marksSameProduct` goes with it, because
`IdentifyResponse` carries no `catalogSku` and a closer look can therefore only produce a name
key, so a single-key comparison would read a census and an identify that agree as disagreeing.

**Hallucinations accumulate**, and this one is not fixed. Across four calls the whole-frame
question added a leek, broccoli, kale and a cucumber. None is in the trolley. One call can invent
one of those; four calls invent four, and nothing later removes them because `unmarkedItems` is
trusted by design. The single unit the video is still over is one of them, a leek, which has no
catalog entry and therefore no SKU to merge on.

Requiring a sighting to repeat before it enters the bag, the way `pendingAlias` already makes a
barcode wait for a VLM guess to repeat, does not work here. Counted across the four calls, the
leek appears twice while cauliflower, apples, bread and asparagus each appear once. The rule
would drop four real products to remove one invented one, and on a single photograph, which is
one census call, nothing could ever corroborate and the bag would empty.

So the census being wrong costs more in a scan than in a photograph, and the pacing that limits
cost also limits exposure: four calls here rather than the eight allowed. This says nothing about
the shipped model, which is what the design assumes and what has never answered. It says the
measurement to run first, once one does, is the video rather than the stills, because the stills
cannot show this at all.

## What this corpus still cannot answer

**The shipped census has never run.** It needs an OpenAI key, and the one supplied was already
revoked, so every number above that involves a census comes either from an oracle or from a 2B
open model standing in.

Grounding DINO cannot stand in for its `isProduct` judgement, in either direction. Measured on
the three non-product boxes here, the trolley's moulded plastic disc and the shopper's tote:

| test | non-products | real products | separable |
|---|---|---|---|
| detector score | 0.568, 0.569, 0.643 | 0.572 to 0.702 | no, the tote outscores 17 of 25 |
| match against "a shopping trolley. a plastic fitting. a handbag. a shoe." | 0.315 to 0.390 | up to 0.416, all 25 match | no |

It cannot be thresholded into the judgement and it cannot be asked for it. A model can: a 2B one
gets 24 of 28 and refuses both discs. What remains unmeasured is the shipped model's own answers,
and the part of them most at risk is badge alignment, which the section above says why.

**Sixteen items is the largest trolley here.** **Sixteen items is the largest trolley here.** A full weekly shop is several times that, and the
misses already concentrate on items lying under other items.

**One video, nine seconds, one trolley.** Enough to find a gate that rejected everything. Not
enough to tune one.
