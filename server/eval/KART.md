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
EXIF orientation honoured, boxes aligned. *This was wrong, and the section below has the
correction: the pixels were turned and the frame was still the wrong shape.*

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
otherwise, which takes the video from 15 units to **11 against 10**.

The same simulation applied to the stills makes them worse, 3 of 6 exact against 4, and the
reason is a limit of the simulation rather than of the change. A local model is not given the
catalog shortlist, so the SKUs here are assigned by matching its words against catalog names, and
within a single call that merges marks the model may have meant as different things. A real
census picks a candidate per region from a shortlist built for that region and cannot make that
mistake. So the stills number stays as measured without SKUs, and the video number stands,
because there the merge being tested is across calls, where "oreo" and "oreo cookies" four
seconds apart are unambiguously one pack. The change is additive: a
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

## What the key showed

The census ran. Everything above this line was written without one, and three of the four things
it concluded hold up. The fourth does not: the compositor was not correct, and neither were two
other pieces of shipped code that nothing without a real answer could have caught.

Five defects, in the order they were found, each with what it cost.

**The harness was not sending what the service sends.** It read `frames.json`, which has no
catalog column, so every request went out with no shortlist while `marksFromRegions` attaches one
on every shipped request and rule 15 of the prompt is written around it. It composited the badges
and then handed the result to `runCensus`, which composites again, so every badge was drawn twice.
It numbered from zero where `marksFor` numbers from one. Reading `frames-named.json` instead moved
badge alignment from 16 of 23 to 22, and turned `catalogSku` from null on every mark into 8 of 8
right on the loaded trolley. Three of the four regions the census had named wrong had the right
answer sitting at the top of a shortlist it was never shown.

**The frame was squashed.** `compositeMarks` sizes its resize from `metadata()`, and sharp turns
the pixels on `.rotate()` but goes on reporting the stored width and height, so orientations 5 to
8 come back the wrong way round. With `fit: "fill"` a 4284 by 5712 trolley became 1536 by 1152
with a third of its width squeezed out. Nothing downstream could notice: boxes are normalized, so
the badges still landed on the right products, the response still parsed, and every count still
looked plausible. Every photograph here is orientation 6, which is what a phone writes when it is
held upright.

The visible symptom was brands. One cauliflower whose wrapper legibly reads MR. LUCKY came back as
"ducky", "misty lick", "pinnacle lucky", "the little potato company?", "goodlife" and "mira lucky"
across runs, every one at confidence 0.95 with `needsCloserLook` false. Writing the composited
image to a file and looking at it is what found this, and the double badges.

**Identify had never run on a phone photograph.** `cropToBox` computes its extract rectangle from
the same unswapped pair. Against a rotated buffer that is not a squashed crop, it is sharp
throwing "bad extract area", so `runIdentify` failed outright on every EXIF-turned photograph. The
second pass, which exists to resolve exactly the items the first pass is unsure about, had never
resolved one. With the rectangle right it reads that wrapper on all six crops of it at confidence
0.97 to 0.99, so the information was in the photograph the whole time.

**`unmarkedItems` was always empty.** Zero on every one of eighteen calls, six photographs at
three resolutions, including a sixteen-product trolley with eleven badges. `applyCensus` is built
on the opposite assumption: enumeration recall is 38%, so the whole-frame answer is meant to be
the main channel rather than a leftovers bin.

Neither obvious cause is the cause. Reasoning effort none, low and medium return 0, 0 and 1 on the
fullest trolley. Long edge 1024, 1536 and 2048 all return zero.

The cause is in the rule. Rule 12 asked for "a product in the cart that has no badge on it", and
the badges are detector boxes that overlap heavily: on a loaded trolley almost every product sits
inside several rectangles, so that phrase describes the empty set. Rewritten to name the direction
of the work, bind each badge to one product and then sweep what is left, with sitting inside a
rectangle said plainly not to be the same as being marked, it moves from 0 of 6 runs to 6 of 6 on
the fullest trolley, listing the meat tray, the purple bag, the yellow bag and the salmon.

**Two spellings of one product, twice.** Marks key by `catalogSku` since that change was made, so
a badge keys as `sku:kart_brussels_sprouts`. `UnmarkedItem` has no `catalogSku` field to offer, so
the same product listed as unmarked can only key as `::brussels sprouts`. The two never meet.

Both guards that exist to stop a product being counted twice compared one spelling. The first,
against the live tracks, let a trolley of three items produce a bag of five. The second, against
everything already in the bag, is the one a scan needs: a scan pans, so the badge that named the
purple produce bag at three seconds is gone by five, and when the census at five seconds lists the
same bag as unmarked only the bag itself can recognise it. That one was worth three units of ten
on the video.

## The census, run

Passes rather than single samples, because the model is not deterministic and these counts move
by two or three units between identical runs:

| | before | five defects fixed | and a SKU on unmarked items |
|---|---|---|---|
| badge alignment | 16 of 23 | 21 of 23, all five passes | 21, 20, 21 |
| units in the bag | 25 of 33 | 28, 27, 30, 28, 29 | **29, 31, 27** |
| photographs exact | 3 of 6 | 4 of 6, all five passes | **4, 5, 4** |

The four sparse trolleys are exact in every pass of every configuration. What remains is the two
loaded ones, and they fail for different reasons.

The sixteen-product trolley reached sixteen exactly, once. It moves between eleven and sixteen,
which is the unmarked sweep being more or less complete on a given call rather than anything
structural.

The ten-product trolley did not move under any of this: eight or nine, never ten, and
`unmarkedItems` empty on it in every run at every effort and every resolution. What moved it was
detection rather than the census, and the section below is how. Reasoning effort was re-tested once
the rule and the frame were both fixed, because "does effort help" is a different question when
the question put to the model is a different question, and the answer did not change: none, low
and medium give 0, 0, 0 on this trolley and 1, 0, 2 on the fullest one. `effort: "none"` is not
what limits the sweep, either before the fixes or after them.

### What the tenth item cost, and what it took to reach it

The two it misses are the yellow produce bag and the tomatoes on the vine, and the census is not
the only thing that never sees them: the detector proposes no box for either. `why_missing.py`
walks the frame through both passes and prints what each one dropped, and the first thing it says
is that the produce pass proposes **nothing at all** on a trolley holding cauliflower, apples,
sprouts, asparagus, a baguette and tomatoes.

`"tomatoes."` on its own finds them, at 0.32, above the shipped threshold of 0.30. The box lands
on them exactly. So the object is detectable and the prompt is what loses it.

`dilution.py` measures what a phrase gives up by sharing a prompt. The score a subject keeps,
against how many phrases are in the prompt with it:

| subject | 1 | 2 | 4 | 8 | 16 | 28 |
|---|---|---|---|---|---|---|
| tomatoes, IMG_0252 | **0.32** | 0.32 | 0.28 | 0.18 | 0.15 | 0.15 |
| cauliflower, IMG_0252 | 0.66 | 0.56 | 0.39 | 0.16 | 0.21 | 0.23 |
| brussels sprouts, IMG_0252 | 0.34 | 0.32 | 0.31 | 0.31 | 0.27 | 0.27 |
| apples, IMG_0252 | 0.30 | 0.30 | 0.21 | 0.23 | 0.17 | 0.27 |
| cauliflower, IMG_0249 | 0.60 | 0.53 | 0.31 | 0.28 | 0.30 | 0.48 |
| asparagus, IMG_0254 | 0.23 | 0.27 | 0.35 | 0.17 | 0.25 | 0.30 |

At one or two phrases, five of six clear 0.30. At 28, two do. `app.py` already records this effect
for the grocery prompt, that "extra phrases dilute the working ones rather than adding to them",
and `PRODUCE_PROMPT` is itself 28 phrases carrying a threshold chosen for a short one.

Two ways out, and both are refused with a number.

**Lower the threshold.** It adds regions and finds nothing:

| produce threshold | regions over the ten photographs | items counted correctly | boxes on IMG_0252 |
|---|---|---|---|
| 0.30, shipped | 127 | 25 of 33 | 8, none from the produce pass |
| 0.22 | 130 | 25 of 33 | 8, none from the produce pass |
| 0.15 | 142 | 25 of 33 | 8, none from the produce pass |

Fifteen more regions for no change in counting at all, and never the tomatoes. At 28 phrases the
detector proposes no box at that location at any threshold, so this is not a threshold that is
set too high; the phrase is simply gone.

**Split the prompt.** Five passes of six, or seven of four, add exactly zero regions on all six
photographs: four companions already cost the tomatoes their 0.32. **Pairs recover it.** The six
trolley photographs gain exactly one region between them and it is the tomatoes, offered by
"bananas. apples." at 0.34, with the four sparse trolleys gaining nothing at all. That is what
holding PRODUCE_THRESHOLD at 0.30 buys, and it is the difference between this and the 0.12 sweep.

On photographs the change is good, and IMG_0252 reaches ten of ten for the first time in any
configuration:

| | one prompt of 28 | pairs |
|---|---|---|
| ten trolley photographs, mean absolute count error | 1.5 items | **1.2** |
| the five where the count is certain | 0.8 items | **0.4** |
| IMG_0252, regions proposed | 8 | **10**, for 10 real products |
| IMG_0252, census bag over three passes | 8, 9, 9 | **9, 9, 10** |
| 24 cart photographs, items counted correctly | 38 of 43 | 38 of 43 |
| 24 cart photographs, mean absolute error | 0.5 items | 0.5 items |

The cart corpus is unmoved, which is the thing the 0.12 sweep destroyed and the reason it was
refused. So on every photographic corpus here, pairs are the same or better.

**And they are refused anyway, because the product is not a photograph.** Re-detected with pairs,
the nine-second scan goes from 137 boxes to 205, and its bag from 10, 10, 10 units against 10
real products to **16, 13, 18**. The extra boxes land on produce fragments in motion-blurred
1080p frames, where the census cannot sort them out the way it can on a 24 megapixel photograph.
The cart corpus says the same thing statically: proposals sitting inside another proposal go from
8 of 289 to 27 of 303.

The trade is one unit on one photograph against three to eight on every scan, for fourteen
forward passes instead of one. `app.py` keeps the single prompt and carries both sets of numbers
at the loop. `PRODUCE_PROMPTS` stays, with `--produce-pairs` on `score_kart.py`, `score_carts.py`
and `score_video.py`, because a sharper camera would change this answer and the next person
should not have to find it again.

So the tenth item of that trolley is reachable, and reaching it costs more than it is worth. The
pipeline's answer there stays the designed one: nine of ten counted, `occlusion.severity` "some"
with a reason naming the overlapping bags on every run, and a scan of the same trolley that
counts exactly ten. The two it misses are the yellow
produce bag and the tomatoes on the vine. Looking at the photograph at full size, the yellow bag
shows one corner from under the baguette and the tomatoes show as red through the purple bag's
plastic, so this is close to what the frame contains rather than a defect in reading it. The
census does report `occlusion.severity` "some" with a reason naming the overlapping bags, every
time, which is the designed answer to a trolley that is hiding something. The scan is the other
one.

## The scan, run

The video had a defect of its own, and it is not the model's. `video-frames.json` carries the
matcher's shortlist per box and not one of its 137 boxes had a single one of this trolley's eight
products anywhere in its five entries. A cauliflower was offered Pulses, Salt and Poha. The
matcher is not at fault: `score_video.py` ran first and `build_kart_catalog.py` cut this trolley's
references out of the video afterwards, so the column was never refreshed and the catalog channel
has been silently dead on this video for every run over it. Refreshed against the same index, 129
of 130 boxes carry one.

| | units | lines | real |
|---|---|---|---|
| stale catalog column, drifting names | 19 | 18 | 10 |
| refreshed column | 13 | 12 | 10 |
| the bag able to see both spellings | 10, 11, 13 | 10, 11, 12 | 10 |
| a SKU on unmarked items too | **10, 10, 10** | 10, 10, 10 | 10 |

Four census calls of a cap of eight, and exactly ten every time.

The last row is the one that closes it. A badge that matched the catalog keys by SKU; the same
product listed as unmarked on a later keyframe could only key by the words the model chose, and
across four calls four seconds apart those words are not the same words. "Bag of apples" is a
second sighting of the Granny Smiths and shares nothing with the badge's name. So `UnmarkedItem`
gained a `catalogSku` and rule 12 points at rule 15 for how to fill it, and in the run that
follows the purple produce bag is listed as unmarked in two separate calls and merges both times.

Those references were cut from this same video, so the refreshed shortlist is better than a
store's catalog would be and this bounds the shipped path from above rather than estimating it.
The stills are where the shortlist is honest: references from the video, queries from photographs
it never saw.

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
