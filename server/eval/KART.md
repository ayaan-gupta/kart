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

## The count this file was scored against was wrong

Read at full resolution on 2026-08-22, two entries in `counts.json` are one object. "purple
produce bag" and "tomatoes on the vine" are a single purple bag of Fuji apples: the purple sheet
runs continuously under and around a white label printed MIDWEST GROWN / FUJI / Sweet to the
core!, the apples show through the clear part beside it, and along the bottom it reads Net Wt 48
oz (3 lb), 2-1/2 inch, Extra Fancy, which is apple grading. The red an earlier pass read as
tomatoes is those apples. On IMG_0254 the only red is the Alaskan sockeye salmon.

IMG_0252 holds nine products, not ten. IMG_0254 holds fifteen, not sixteen. Every figure below
that was taken before this date is against the higher numbers, and the two loaded trolleys are
one and one further from their targets than they read.

Re-scored against the corrected counts, three passes: units 29, 24, 27 of 31, four of six
photographs exact, badge alignment 21 of 23 in every pass. Both loaded trolleys now miss by
exactly one rather than by two and by four, which is a different and smaller problem than the one
ten experiments were aimed at.

The scan's target moves too, because the trolley it scans is IMG_0252's. Re-scored against nine,
six runs: 9, 10, 10, 11, 11, 12. One exact, and the rest one or two over.

So the correction cuts both ways, and the two corpora now fail in opposite directions. The
photographs come in one under on both loaded trolleys, which is a product genuinely in the basket
that no call ever named. The scan comes in one or two over, which is one product described twice
across four calls. Reading them as one number hid that; they are different faults and only the
second is the one ten experiments were aimed at.

One verdict changes materially. Every saved census run re-scored against the corrected counts:

| | photographs exact, per pass | IMG_0252, of 9 | IMG_0254, of 15 |
|---|---|---|---|
| shipped, one produce prompt | 4, 4, 4 of 6 | 8, 8, 8 | 14, 9, 12 |
| paired produce prompts | **5, 5, 5 of 6** | **9, 9, 10** | 11, 13, **15** |

The trolley that had never once reached its count is exact in two passes of three with pairs, and
one pass puts the fullest trolley exactly on fifteen. Pairs were refused because they take the
scan from around ten to 13, 16 and 18, and that still decides it, since the product is a scan.
But the photograph side of that trade was larger than the numbers it was refused on.

What IMG_0252 misses under the shipped prompt is one object and always the same one: the yellow
produce bag. Eight of nine, three passes of three, and never a word about it in unmarkedItems at
any effort or resolution. The paired prompt is what puts a box on it. So the miss is detection and
its fix is known.

**And the split itself is the rule.** Three changes were refused today for helping the photographs
and hurting the scan, which is three measurements of one thing: more regions or more names help an
image the census can adjudicate and hurt one it cannot. What separates those is not size, which is
backwards here, because the detector receives photographs thumbnailed to 1333 and scan frames at
1080 by 1920. It is whether the object is resolved in the pixels at all. Variance of the Laplacian
on exactly what the detector receives:

    ten photographs   1060 1551 1676 1762 1888 2032 2152 2229 2264 2293
    26 scan frames    9.7 low, 116 median, 351 high

Three times between the highest frame and the lowest photograph, no overlap, and those are the
only two populations this pipeline receives. `PAIRED_PRODUCE_SHARPNESS` is 700, in the gap rather
than against either edge, so it is not fitted. Above it the produce nouns run in pairs; below it
they run as one prompt.

Shipped and measured, three passes:

| | photographs exact | IMG_0252, of 9 |
|---|---|---|
| one prompt everywhere | 4, 4, 4 of 6 | 8, 8, 8 |
| conditioned on sharpness | **5, 4, 4 of 6** | **9, 10, 8** |

The trolley that had never reached its count under any shipped configuration reaches it. The scan
is untouched, because every one of its frames falls below the threshold and gets exactly the pass
it had before.

### The same rule does not carry to the census model

`PAIRED_PRODUCE_SHARPNESS` works because the produce pass either adds a region or does not, and on
a sharp image the census can throw away what it should not have. The larger census model was the
obvious next thing to condition the same way, since it split the two corpora identically, and it
is refused. Six passes with gpt-5.4 above the threshold and mini below it, against three of mini
everywhere:

| | units of 31 | photographs exact | alignment of 23 |
|---|---|---|---|
| mini everywhere | 27, 28, 28 | **5, 4, 4** | **21, 21, 21** |
| larger, conditioned | 30, 30, 29, 33, 32, 32 | 4, 2, 4, 3, 3, 5 | 20, 21, 22, 20, 20, 20 |

The corpus total lands closer, 31.0 against 27.7 of 31, and that is the wrong thing to read. It
gets there by overshooting as often as it undershoots: the fullest trolley goes 15, 14, 14, 17, 16
where fifteen is the truth, and the ten-product one goes 7, 7, 8. Per photograph the count is right
less often, 3.5 of six against 4.33, and alignment costs half a badge.

A shopper sees one photograph's bag, not the corpus total. So the rule that picks a detector pass
does not pick a model, and the difference is that a wrong region can be discarded downstream while
a wrong count cannot.

### The fullest trolley is not a defect, it is the recall number

IMG_0254 still reads 11 to 13 of 15, and `why_missing.py` says detection is behaving correctly.
The grocery pass proposes 20 boxes and 11 survive. Every one of the nine dropped is dropped for a
reason that is right: two are group boxes containing 7 and 8 of the kept members, and the other
seven are NMS duplicates at IoU 0.53 to 0.99 of a box that was kept. The paired produce pass adds
nothing, because its single proposal sits entirely inside a box the first pass already drew.

That reading was wrong, and a targeted prompt shows why. The products with no bag line do get
proposed; they are refused. On IMG_0254, against the eleven boxes the grocery pass keeps:

| prompt | boxes proposed | added by merge_produce |
|---|---|---|
| `broccoli.` | 3 | 0 |
| `asparagus. broccoli.` | 2 | 0 |
| `cheese.` | 1 | 0 |
| `a pack of meat.` | 1 | 0 |
| the shipped 28-noun prompt | 1 | 0 |

Every one is rejected for sitting inside a box the first pass already drew. `PRODUCE_INSIDE` is
0.7 and it is there for a good reason, written three sections up: one clementine inside a net of
clementines is a part of a purchasable unit, not a unit, and without the containment test one net
became seven fruits. On a trolley this dense the eleven kept boxes blanket the basket, so the same
test that protects the net refuses a whole bag of asparagus.

This is the fifth time today that heavily overlapping detector boxes have been the mechanism:
rule 12 asking for products with no badge on them, a centre-point spatial join, the same join at
0.4 overlap, and now this. It is one property of a loaded trolley seen from five directions.

Loosening the containment test is the 0.12 threshold sweep in another form, and that one is
already measured: it shatters the cart corpus's net bags into 27 proposals. So the products are
visible, they are proposed, and the rule that refuses them is protecting something real.

There is one structural distinction that would separate the two cases, and it does not hold here.
A clementine inside a net of clementines is a part because the container is one product; a bag of
asparagus inside a box that also holds two other separately-detected products would be a unit,
because that container is not one product. `degroup` only fires at five members, so a container of
two to four survives and is treated as a single item, which is where such a case would hide.

Checked on IMG_0254. Of the seven refused produce boxes, six sit inside a kept box that contains
**zero** other kept boxes, and the seventh inside one that contains one:

    broccoli 0.50  inside #3, which contains 0 others
    broccoli 0.34  inside #9, which contains 0 others
    cheese   0.37  inside #7, which contains 1 other
    a pack   0.41  inside #5, which contains 0 others

So the containers are single-product boxes by every test available, and the refusals are correct
by every one of them. What is actually happening is that one grocery box covers two adjacent
products whose own boxes overlap rather than nest, so no containment count can see the second.

And raising `PRODUCE_INSIDE` is not an escape either, which is worth stating because it is the
obvious thing to reach for. Every refused box is inside its container at 0.99 or 1.00:

    broccoli 0.50 at 1.00    broccoli 0.34 at 1.00    bro 0.30 at 0.99
    broccoli 0.47 at 1.00    broccoli 0.35 at 1.00    cheese 0.37 at 0.99
    a pack   0.41 at 1.00

The threshold is 0.7. Moving it to 0.8, 0.9 or 0.95 admits none of them, because they are not
marginally inside, they are wholly inside. Only removing the containment test admits them, and
that is measured two sections up: with an overlap test alone the second pass took 7 proposals to
19, splitting one clementine net into seven fruits and one onion net into four.

So there is no setting of this knob that helps, only its absence, and its absence is worse. This
is where the corpus stops being able to answer.

Resolution is not it either, and this is the one that settles it. The detector receives a 1333
thumbnail; the census was raised to 1536 today because it could not read labels, and the detector
was never re-checked. Run at 1333, 2000 and 2666:

| | 1333 | 2000 | 2666 |
|---|---|---|---|
| IMG_0252, regions of 9 real | **9** | **9** | **9** |
| IMG_0254, regions of 15 real | 11 | 11 | 11 |

Identical at every scale, down to the same 20 raw proposals collapsing to the same 11. The four
are not small, they are covered. More pixels of a tote bag is still a tote bag.

Which makes the two photographs different problems, and only one of them was ever a bug. IMG_0252
was a detector miss on a visible object; detection now proposes exactly nine regions for its nine
products at any resolution, and it is fixed. IMG_0254 is a trolley packed densely enough that the
containment rule protecting one purchasable unit from being split refuses a second unit sitting
against it. The product's answer to that photograph is asking the shopper to move things, which
is what `occlusion.severity` on it reports every time.

This was checkable on day one and was not checked. Ten attempts were made at a gap that was
partly an artifact of the target, and the corpus is small enough that a single mislabelled bag
moves every number in this file.

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
counts ten on a third of runs and eleven to thirteen on the rest. The two it misses are the yellow
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

| | units against 10 real | lines |
|---|---|---|
| stale catalog column, drifting names | 19 | 18 |
| refreshed column | 13 | 12 |
| the bag able to see both spellings | 10, 11, 13 | 10, 11, 12 |
| a SKU on unmarked items too | **10, 10, 10** | 10, 10, 10 |

Four census calls of a cap of eight. That last row is three runs and it is not the distribution.
Thirteen more runs later, on a byte-identical input file and with nothing in the path between
them changed, the fifteen readings are:

    9  9  10 10 10 10 10 10  11 11  12  13 13 13 13

Five of fifteen exact, median eleven, and the spread is one over to three over rather than under.
The first three being ten each was a streak, and reporting it as "exact and stable" was wrong.

Two things in that spread turned out to be fixable, and one did not.

**One product badged twice opened two lines.** `markKey` takes the catalogSku when there is one
and brand-and-name when there is not, and across a session the same product gets both: the
shortlist for a sharp frame carries `kart_oreo` and the one four seconds later, on a blurred
frame, does not. "Oreo" was badged at one second and again at seven and the bag held two packets.
A mark that matches the catalog now records that its brand and name are that SKU, as an alias, so
the SKU survives and the accumulated quantity moves across.

**"red apples" at five seconds and "red apple" at seven were two products.** `productKey` now
folds an English plural in the name segment. Not the brand: a brand is a proper noun and does not
arrive singular one call and plural the next. The key is opaque, so a fold that mangles a word
costs nothing as long as it is deterministic, and "asparagus" becomes "asparagu" on both sides.

| | exact | mean units | spread |
|---|---|---|---|
| neither, 15 runs | 5 of 15 | 10.93 | 9 to 13 |
| both, 14 runs | **6 of 14** | **10.36** | 8 to 12 |

Modest, and it brings one new failure mode: a run of 8, where the fold brought two produce bags
together. The stills are unmoved, alignment 20 and 21 of 23 and four and five of six exact.

**What is left does not have a rule.** A census that says "green produce item in bag" on one call
and "brussels sprouts" on the next has given two descriptions that share nothing, and no
normalisation reaches them. An unmarked sighting keys by SKU only when the model offers one, and
on a motion-blurred frame it often cannot. Every remaining reading over ten is that, and every
reading under ten is a product no call ever named.

Corroboration was the obvious answer and it is measured and refused. The codebase already holds
one sighting to be noise and two in a row to be evidence, for a fresh guess landing on a barcoded
track, and applying the same standard to a SKU-less unmarked sighting from the second census
onward is a two-line change. It is provably free on the photographs, where each is its own
session of one call and the first call's sightings land immediately.

On the scan it trades the error for a worse one:

| | exact | mean units | readings |
|---|---|---|---|
| as shipped, 14 runs | 6 of 14 | 10.36 | 8 to 12 |
| a SKU-less sighting waiting for a second census, 8 runs | **0 of 8** | **8.5** | 8, 8, 8, 8, 9, 9, 9, 9 |

Every reading under ten. A scan pans, so a product that is genuinely in the trolley and genuinely
visible on one keyframe of four never gets its second census and never reaches the bag. The rule
does not separate a re-description from a single sighting, it separates things seen twice from
things seen once, and on a pan those are not the same distinction.

A shopper misses a duplicate on the screen. They do not miss a product that is not there, and
they are charged for it either way, so an over-count is the error to keep.

Giving the census the frame's whole catalog was the other idea and it is also refused. Rule 15
lets a badge copy a SKU from its own region's "catalog:" line, so an unmarked product, which has
no region and therefore no line, can never carry one. The union of every shortlist in the frame
costs nothing to compute, since the shortlists are already in the request, and it would give an
unmarked bag of apples a `kart_granny_smith_apples` to key on. Measured over eight scans it reads
9, 9, 10, 11, 11, 11, 11, 12: one of eight exact against six of fourteen, with the mean unmoved
at 10.5. The model does not take the offer often enough to matter, and offering it appears to
cost a little precision elsewhere.

**And handing the census its own earlier answers is worse still.** That was the one described
here as needing a change to the architecture rather than a fix inside it, so it was built: each
call in a scan receives the names already in the bag and is told to reuse one exactly if it sees
that product again. It is the only idea that addresses the drift at the source instead of
repairing the wording afterwards, and a photograph is untouched because it makes one call and the
list is empty.

Eight scans: 6, 7, 7, 7, 9, 9, 9, 13. Zero of eight exact against six of fourteen, mean 8.4
against 10.36, and the spread got wider rather than narrower. Told that a product is already in
the shopper's bag, the model stops reporting it, so its `inViewCounts` entry disappears and the
item falls out. The instruction to reuse a name reads to it as permission to stop looking.

That is worth knowing for its own sake: the architecture is not what stands in the way here. The
idea is.

**A bigger census model splits the two corpora the same way the produce pairs did.** "Perception,
not reasoning" is the assumption `MODELS.census` is built on, and it had only ever been tested
against more reasoning effort on the same model, which does nothing. `KART_CENSUS_MODEL` exists
now so it can be tested against a larger one.

| gpt-5.4 in place of gpt-5.4-mini | |
|---|---|
| stills, units of 33 | **30, 32, 30**, against 26 to 32 |
| stills, photographs exact | 4, 5, 4 of 6, unchanged |
| stills, badge alignment | 20, 20, 22 of 23, unchanged |
| scan, units against 10 | **12, 13, 14, 14, 14, 14** against 8 to 12 |

Better on photographs and much worse on the scan, and the reason is the same property doing both:
a larger model sweeps harder for unmarked items. On one call that is more of the trolley found. On
four calls of a pan it is more descriptions that cannot be joined, so the bag fills with them.
Perception was never the bottleneck on the scan.

The shipped model stays mini. The product is a scan.

Seven things have now been tried against the last one or two units and each is refused with a
number: a lower produce threshold, produce prompts split into groups, produce prompts in pairs,
corroboration before an unmarked sighting counts, the frame's catalog offered to the unmarked,
the census given its own session's answers, and a larger census model. Five of the seven made the
scan worse, and two of those did it by under-counting, which is the error a shopper cannot see.

Three of the seven point the same way. Anything that makes the census see or say more helps a
photograph and hurts a scan, because a photograph asks once and a scan asks four times with no
way to join the answers. That is the shape of what is left, and it is one mechanism rather than
seven separate problems.

**The eighth was the opposite direction, and it settles what the four calls are worth.** If each
call re-describes a static trolley in fresh words and nothing joins them, the cheapest fix is to
ask fewer times. `--max-calls` on the scan harness, four runs each:

| censuses allowed | units against 10 real |
|---|---|
| 1 | 6, 6, 7, 7 |
| 2 | 7, 7, 8, 8 |
| 3 | 6, 7, 6, 7 |
| 4, as shipped | 8, 9, 10, 10, 10, 10, 10, 11, 11, 11, 11, 12, 12, 12 |

Every cap under-counts and none comes close. The fourth call is finding products, not just
renaming the ones already found, so the drift is the price of coverage rather than waste. Which
also means the over-count and the coverage cannot be separated by pacing: they are the same
mechanism seen from two sides.

**The ninth was the one this file predicted would work, and it does not.** Handing the census the
bag's contents fails because a list of what the shopper already has reads as permission to stop
looking. The narrower version does not have that shape: each badge is told what the tracker says
that same physical object was called earlier in this scan, with rule 17 saying plainly that it is
an assertion about which object this is and not a reason to leave anything out.

Eight scans: 10, 11, 12, 12, 12, 12, 12, 13. One of eight exact against six of fourteen, mean
11.75 against 10.36. It over-counts slightly more than saying nothing.

That prediction is worth leaving in the record next to its refutation. The reasoning behind it
was that a stable identity per region is the missing join, and the reasoning still looks right;
what it got wrong is that the drift is not mostly on the badges. A badged region is already
joined, by the tracker and now by the SKU alias. The descriptions that do not join are the
unmarked ones, and an unmarked product has no region for a per-region prior to attach to.

**The tenth followed straight from that.** If an unmarked product has no region to join on, give
it one: `UnmarkedItem` gains a rectangle, the model is asked to point at the thing, and a sighting
whose rectangle agrees with a live track is that track's product whatever either of them was
called. It is the only join in any of these ten that is not lexical, and the diagnosis above says
lexical is exactly what fails.

The first cut used the sighting's centre landing inside a track's box and over-merged badly, 7 8 8
8 8 8 10 10 units against 10. The reason was already three sections up in this file: detector
boxes overlap so heavily on a loaded trolley that almost any point is inside something. Tightened
to real overlap at 0.4:

| | exact | mean units | stills, units of 33 |
|---|---|---|---|
| no spatial join, 14 runs | 6 of 14 | 10.36 | 26 to 32 |
| overlap at 0.4, 14 runs | **8 of 14** | 10.29 | **24, 28, 26** |

Two more exact runs in fourteen, which is inside the run-to-run spread, against three units a pass
off the photographs, which is not. The same overlap that blankets the frame for the centre test
still reaches most unmarked sightings at 0.4, and on a photograph the unmarked channel is the main
contributor rather than a duplicate source. So it is refused, and the reason it fails is the same
sentence that made rule 12 fail this morning.

That is ten attempts. Seven made the scan worse or cost the stills more than they gave, one made
it worse in the other direction, one did nothing, and the two that helped both worked by joining
answers rather than by changing them: a mark teaching the session that its name is a SKU, and a
plural folded out of the key.

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
