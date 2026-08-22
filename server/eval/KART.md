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

IMG_0252 holds nine products, not ten. IMG_0254 holds fifteen, not sixteen.

**Any figure in this file with a denominator of 33, or "of 10 real products", or "of 16", was
measured before 2026-08-22 and is against the old counts.** The corrected denominators are 31 for
the six photographs, 9 for IMG_0252 and the scan, and 15 for IMG_0254. Those figures are left as
they were rather than rewritten, because each was taken at a particular time against a particular
target and changing the numbers after the fact would misrepresent when they were measured. The
two loaded trolleys are one and one closer to their targets than the old figures read.

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

Detection alone, before any census. The `real` column carries the corrected counts from the
section above; the two loaded rows read 10 and 16 until 2026-08-22.

| photograph | real | proposed | correct | error |
|---|---|---|---|---|
| one cauliflower | 1 | 2 | 1 | +1 |
| one cauliflower | 1 | 1 | 1 | 0 |
| + sprouts | 2 | 3 | 2 | +1 |
| + asparagus | 3 | 3 | 3 | 0 |
| loaded | 9 | 8 | 8 | -1 |
| full | 15 | 11 | 10 | -4 |

**25 of 31 items counted correctly**, 15 of 16 on the five photographs where the count is
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

## The other two capabilities

`CLAUDE.md` says success is four things and this file has been almost entirely about the first
two. The other two are measurable on the same runs and had not been read.

**Items hidden under others are flagged.** On every pass, the four sparse trolleys report
`occlusion.severity` "none" with `itemsLikelyHidden` false, and the two loaded ones report "some"
or "many" with it true. Eighteen of eighteen by the reading that matters, which is whether the
trolley is actually hiding anything, and the loaded ones are. A first attempt scored this against
"did the bag come up short" and read 14 of 18; that proxy is wrong, because a trolley can be both
occluded and over-counted, which is exactly what the fullest one does.

**Items the census is unsure about are flagged.** This one is not working. Across 69 scored
regions the census got 9 wrong, and only 4 of the 9 carried `needsCloserLook` or a confidence
below 0.6. Five wrong answers were asserted flat out, which `IDENTIFY_SYSTEM_PROMPT` calls worse
than an honest uncertain one, and which stops `runIdentify` from ever being asked to look closer.

Rule 15 already covers part of this: a region shown a "catalog:" line that matches nothing must set
`needsCloserLook`. That is server-checkable and the obvious enforcement, and it does not help.
Measured on the same runs, 5 of 83 product regions violate it and **none of those five is one of
the wrong answers**. Enforcing it would flag five correct calls and catch nothing.

The five that matter look like this, and the pattern is that confidence is highest where the
answer is worst:

    IMG_0254 #11  truth Fuji apple bag   said "asparagus"            confidence 0.90 to 0.92
    IMG_0254 #5   truth the tote bag     said "baguette"             confidence 0.86
    IMG_0254 #5   truth the tote bag     said "purple produce bag"   confidence 0.72

Three of the five are the same two regions across passes, so this is two objects the model is
reliably and confidently wrong about rather than noise. Both are the shopper's woven tote and the
bag beside it, which looks like the hardest thing in the corpus: a bag that is not a product,
sitting on top of bags that are.

That reading is wrong, and the fix built on it fails. Rule 8 lists what is not a product and does
not name the shopper's own bag, which on a trolley full of produce bags looks like the gap. Naming
it, with the distinction spelled out between packaging and an object with handles and a strap,
changes nothing: the tote is still called "baguette" in all three passes, and the photographs go
from five, four, four exact to four, four, four with alignment from a flat 21 to 21, 20, 21.

It fails because the model is not deciding whether a bag is a product. It is reading a tan woven
texture as a baguette in plastic, which on that trolley is also true of the actual baguette two
inches away. The error is naming, so a rule about what counts as a product cannot reach it, and
`isProduct` is being answered correctly for the thing the model thinks it is looking at.

## What this corpus still cannot answer

**The shipped census had never run when the sections above were written.** It needs an OpenAI
key, and the one first supplied was already revoked, so the numbers in those sections come
either from an oracle or from a 2B open model standing in. A working key arrived later and the
shipped census has since been run many times against this corpus; the runs are reported in "The
census, run" and "The scan, run" above, and in the section below. Read the paragraphs that
follow this one as the state of the corpus, not as the state of the key.

Grounding DINO cannot stand in for its `isProduct` judgement, in either direction. Measured on
the three non-product boxes here, the trolley's moulded plastic disc and the shopper's tote:

| test | non-products | real products | separable |
|---|---|---|---|
| detector score | 0.568, 0.569, 0.643 | 0.572 to 0.702 | no, the tote outscores 17 of 25 |
| match against "a shopping trolley. a plastic fitting. a handbag. a shoe." | 0.315 to 0.390 | up to 0.416, all 25 match | no |

It cannot be thresholded into the judgement and it cannot be asked for it. A model can: a 2B one
gets 24 of 28 and refuses both discs. What remains unmeasured is the shipped model's own answers,
and the part of them most at risk is badge alignment, which the section above says why.

**Sixteen items is the largest trolley here.** A full weekly shop is several times that, and the
misses already concentrate on items lying under other items.

**One video, nine seconds, one trolley.** Enough to find a gate that rejected everything. Not
enough to tune one.

## Seventeenth investigation: the spread itself

Every earlier investigation tried to fix an answer. This one tried to fix the *measurement*, on
the theory that a corpus whose run-to-run spread is three units cannot adjudicate a one-unit
change, so narrowing the spread would unblock everything behind it.

The census sends no sampling parameters, so it runs at the API default. Two handles exist:

| handle | result |
|---|---|
| `seed: 7` | rejected, 400 `Unknown parameter: 'seed'` |
| `temperature: 0` | accepted |

Temperature 0 is not a fitted parameter and there is nothing to tune about it, so it was run
straight against the six photographs, three independent rounds of five passes per arm:

| round | baseline exact | temp 0 exact | baseline units | temp 0 units |
|---|---|---|---|---|
| 1 | 22 of 30 | 24 of 30 | 29, 24, 29, 29, 26 | 31, 30, 33, 32, 32 |
| 2 | 21 of 30 | 23 of 30 | 27, 28, 31, 32, 30 | 30, 27, 31, 28, 31 |
| 3 | 22 of 30 | 22 of 30 | 27, 32, 30, 30, 31 | 28, 29, 26, 30, 32 |
| pooled | **65 of 90** | **69 of 90** | **mean 29.0** | **mean 30.0** |

Against 31 real units. Badge alignment was 21 of 23 on all thirty passes in both arms.

**This is a null result, and the first two rounds are why it needs saying twice.** After round 1
the gain looked real: four units of undercounting removed, and the first six-of-six pass this
corpus has ever produced. Round 2 reproduced the direction. Round 3 tied, and across the three
rounds the two arms' unit means converged rather than separated. Four counts in ninety is 0.7
standard errors; the unit difference is 1.3. Neither clears noise. The earlier video claim in
this file was overstated in exactly this way, on exactly this much evidence, so the shipped
census keeps the default and `KART_CENSUS_TEMPERATURE` stays an eval-only override that defaults
to changing nothing.

The scan was measured too, four passes per arm: 9, 11, 10, 10 at the default against 11, 9, 11,
10 at temperature 0, on nine real products. No effect, and here the reason is structural rather
than statistical. A scan's bag is fused from four census calls on four *different* frames.
Pinning the sampling makes one call repeatable on one input; it cannot make two calls agree about
what to name a product they each saw differently. That is the unmarked-description fault this
file already names, and it is untouched by anything done here.

**What this closes.** The spread on this corpus is irreducible through sampling controls: one
handle is unavailable and the other is measurably inert, and at temperature 0 the same fixed six
photographs still returned anywhere from 26 to 33 units across fifteen passes. So the standing
conclusion in this file, that a one-to-two-unit change cannot be verified here, is no longer an
observation about investigations that happened to fail. It is a property of the instrument. More
captures raise the denominator and lower the noise floor; nothing in the request shape will.

## Eighteenth investigation: holding the model still

The seventeenth closed off narrowing the spread at the model. This one goes around it.

Everything in the scan harness except `runCensus` is deterministic: `processFrame`, `marksFor`,
the shortlist attach, `applyCensus` and `bagLines` return the same thing for the same input,
every time. So the model's answers can be recorded once and replayed, which holds the noise
perfectly still and lets a fusion-layer change be measured exactly rather than statistically.

`--replay=<file>` does that, against a file this harness already wrote. Six live runs were
captured and each replayed: **9, 10, 10, 12, 12, 10 units live, and the identical numbers on
replay, six for six.** The instrument is exact, not approximate.

### What the extra lines are

With the model held still, the bags can be read rather than sampled. Both twelve-line runs carry
`Oreo Oreo` **and** `Cadbury Oreo` as separate lines. It is one packet of Oreos.

| | call 0 | call 3 |
|---|---|---|
| name | `Oreo` | `Oreo` |
| brand | `Oreo` | `Cadbury` |
| `catalogSku` | `Oreo` | `kart_oreo` |
| track | `track_1` | `track_12` |

Three things this rules out. The SKUs are not hallucinated: every one of the 78 non-null
`catalogSku` values across all six runs appears in the shortlist that box was actually offered,
so the model chose validly both times. The two sightings are not one track, so no shared identity
exists to carry the answer across. And `productKey` cannot join them, because the brand differs.

The shortlists offer `kart_oreo` (12 times), `Oreo` (12 times) and `Cadbury` (12 times) for the
same box: the reference index holds 310 SKUs, of which 8 are this trolley's `kart_*` references
cut from the video and the other 302 come from a public grocery dataset whose SKUs are brand
words. The same shape produces `bread` against `Seedtastic Bread` in run 6, from `Bread` (15
times) against `kart_seedtastic_bread`.

### What it costs, exactly

Rewriting only `Oreo` to `kart_oreo` in the saved answers and replaying all six:

| | as-is | one SKU collapsed |
|---|---|---|
| units per run | 9, 10, 10, 12, 12, 10 | 9, 10, 9, 11, 11, 9 |
| mean against 9 real | 10.5 | 9.83 |
| exact | 1 of 6 | 3 of 6 |

Every run that split merged; no run got worse. This is not a sampled result and does not need a
confidence interval: the model was byte-identical in both columns.

### Why this is scan-only

Thirty photograph passes were checked for the same thing and contain **zero** within-pass SKU
splits. A photograph is one census call, and one call cannot disagree with itself. The split
needs two calls, which is what a scan is.

### The part that is not mine to decide

The obvious fix is to collapse the duplicate in the index, and I have not done it, because the
argument against is real. `Oreo` and `kart_oreo` may not be one product: the trolley holds an
Oreo party size, the generic entry is some other Oreo pack, and a store that stocks two pack
sizes genuinely has two SKUs. If that is the case the matcher is right to offer both, the census
is right to pick either, and the defect is that nothing pins the choice across calls — which is
the unmarked-description fault this file already names, now with a measured price.

The two readings need different fixes and only one of them is a code change, so the reading has
to be settled first. What is settled either way is the size: **one line per scan, in four runs of
six**, and an instrument that can now tell a one-line change from nothing at all.

No fusion-layer fix is safe without that answer. Joining on name alone would merge the two apple
bags this trolley really does contain, and `addAlias`'s conflict path, reached when one key is
pulled toward two targets, deliberately strands both rather than guessing.

## Nineteenth: the fold, and what the corpus can and cannot say about it

The eighteenth priced the scan's extra lines and left the fix open, because the two readings of
the Oreo split needed different fixes and I could not tell which reading was right. Looking at
IMG_0252 settles it without needing the catalog's opinion at all: **the trolley holds one packet
of Oreos, party size, and no second Oreo anywhere.** Whatever a store's product list says, the
correct bag has one Oreo line, so two lines is wrong however many SKUs exist. That makes it a
code fix rather than a corpus edit.

### The evidence that makes a name fold safe

The name is all the two sightings share, and the name alone is not enough: this trolley holds two
bags of apples, and folding on the name would collapse them. What separates the cases is already
in the data and is evidence rather than a threshold. **A census is shown numbered badges and
answers each one separately, so two badges in a single call are two objects, whatever it calls
them.** Counted over the six captured runs, exactly one name ever did that: `bread`, in run 6's
second call, where the baguette and the Seedtastic loaf were both called bread. That is the one
case a fold must refuse, and the rule refuses it without being told to.

So `FusionState` gained `sharedNames`, and `bagLines` folds two same-named lines only when that
name has never appeared twice in one call. The fold happens at the line, not through `addAlias`,
whose conflict path deliberately strands both quantities to protect barcodes; nothing here
touches identities, aliases or quantities, so a wrong fold costs one line's display and no state.

### Measured exactly, with the model held still

| | before | after |
|---|---|---|
| scan, six replayed answer sets | 9, 10, 10, 12, 12, 10 | 9, 10, 9, 11, 11, 9 |
| exact, of 6 | 1 | 3 |
| photographs, thirty replayed passes | 22 of 30 exact, 145 units, 105/115 badges | **identical, to the number** |

Every split merged, nothing regressed, and the photographs did not move at all, which is what
should happen: one call cannot disagree with itself. This equals the ceiling the eighteenth
measured by collapsing the SKU in the corpus, so the code fix buys the whole of what the corpus
edit would have bought, without editing the corpus.

### What the live corpus cannot show, and why that is not a contradiction

Six live scans after the fold: 9, 11, 11, 11, 9, 10, mean 10.17, against a pooled 10.29 over the
fourteen live runs recorded before it. **That is not a demonstration and I am not offering it as
one.** The fold is worth about two thirds of a unit; the live spread is about one and a half. A
six-run live sample cannot resolve an effect four times smaller than its own noise, which is
exactly what the seventeenth investigation established and exactly why the replay instrument was
built. The claim rests on the held-still measurement, where the model was byte-identical in both
columns, and on nothing else.

### The risk it carries

Two identical products that no single census ever badges together would fold into one line, and
the bag would undercount by one. Nothing in this corpus does that, so the risk is reasoned rather
than measured. It is the direction this corpus's error does not currently run, and a second
capture set with genuine duplicates is the thing that would test it.

## Twentieth: the largest remaining gap is not the fault this file named

IMG_0254 is the fullest trolley and carries the whole residual: 11 regions against 15 products,
error −4, while the other five photographs are within one. This file has carried a diagnosis for
that gap, one detector box blanketing two adjacent products with `PRODUCE_INSIDE` refusing the
proposals inside it. Measured directly, that diagnosis is **wrong**.

### What merge_produce actually refuses here

23 produce proposals, none accepted. The reason is not what was assumed:

| refused by | count | what they are |
|---|---|---|
| overlap with a base box | 16 | the same item the grocery prompt already drew, at IoU 0.49 to 0.97 |
| containment, inside base box 5 | 6 | individual apples inside the Granny Smith bag, IoU 0.07 to 0.12 |
| containment, inside base box 4 | 1 | one proposal inside the tote |

Base box 5 is the apple bag. Those six refusals are the clementine-in-a-net case the containment
test was written for, and accepting them would badge six apples as six products. **The rule is
doing its job on this photograph, not blocking it.** Loosening `PRODUCE_INSIDE` would make this
image worse, not better, which also retires the "live trade-off" this file once offered.

### What dedupe removes

Nine of the twenty grocery proposals are dropped, and every one is a correct drop: four are
near-duplicates of a survivor at IoU 0.79 to 0.99, three more at 0.53 to 0.72, and two are
whole-trolley GROUP boxes holding 14 and 12 members. Nothing removed is a missing product.

### What it really is

Neither pass is losing the four products, because **no pass ever proposes them.** Three settings,
one ceiling:

| setting | IMG_0254 proposed | **correct** | error | corpus mean abs error |
|---|---|---|---|---|
| shipped | 11 | **10** | −4 | 1.2 |
| `--tiles 2` | 25 | **10** | +10 | 14.7 |
| `--threshold 0.20` | 14 | **10** | −1 | 1.2 |

Correct never moves. Tiling adds fourteen regions and not one product, and wrecks the sparse
photographs, proposing seventeen regions for a trolley holding one item, because half-overlapping
tiles turn the trolley's own wire mesh into goods. The lower threshold flatters the error to −1
purely by adding three regions that are not products, trading an undercount for an overcount
while the corpus mean absolute error stays at 1.2. That also answers the question `propose`'s
docstring left open, which was whether tiling harmful on RPC might still help a loaded trolley:
measured here, it does not.

**Ten of fifteen is this detector's ceiling on this photograph.** Looking at the image says why:
the missing items are a second cheese pack, a purple produce bag and a yellow item lying under
the shopper's tote and the baguette, and greens behind the salmon tray. They are not
under-proposed, they are barely visible. This is the one photograph in the corpus whose count is
marked `moderate` rather than `certain` precisely because a person has to judge rather than read
it, and on the five certain photographs detection is 15 of 16.

Recovering them needs a different detector or a second viewpoint, which is what a scan is for and
what the capability-3 occlusion flag is for: this trolley reports "some" hidden, every pass. It
is not reachable by tuning the three constants measured above.

## Twenty-first: four of the six photographs are already finished

Reading the thirty recorded passes per photograph rather than in aggregate changes what the
remaining work is:

| photograph | real | units per pass | exact |
|---|---|---|---|
| IMG_0244 | 1 | 1, 1, 1, 1, 1 | **5 of 5** |
| IMG_0245 | 1 | 1, 1, 1, 1, 1 | **5 of 5** |
| IMG_0246 | 2 | 2, 2, 2, 2, 2 | **5 of 5** |
| IMG_0249 | 3 | 3, 3, 3, 3, 3 | **5 of 5** |
| IMG_0252 | 9 | 9, 11, 8, 10, 10 | 1 of 5 |
| IMG_0254 | 15 | 12, 11, 11, 13, 15 | 1 of 5 |

Four of the six are exact on every pass, with no spread at all. The whole 22-of-30 figure is two
loaded trolleys, and every earlier statement in this file about "photographs" was averaging four
solved cases together with two open ones.

### The variance is one channel, and it is not detection or naming

Badges are perfectly stable on both hard photographs: IMG_0252 returns 10 marks and 10 products
on all five passes, IMG_0254 returns 11 and 11 on all five. Detection does not move, and the
census names the badges it is given consistently. **Everything that moves is `unmarkedItems`**,
the channel where the census volunteers products no badge landed on: 3, 0, 9, 4, 4 on IMG_0254,
for the same fixed photograph.

That also retires "ten of fifteen is the ceiling", written one section up. It is the ceiling for
*detection*. The bag is not bounded by it: on pass 4 the census volunteered exactly the four
missing items, red meat, purple bag, yellow bag, peppers, and the bag came to **15 of 15**. The
system has already produced a perfect answer for the hardest photograph in the corpus. It just
does not do it reliably.

### The paraphrase fix, measured and abandoned

The obvious next fix is to fold an unmarked description onto a badge it paraphrases. Classifying
all 25 unmarked descriptions across the thirty passes says not to bother:

| how the description relates to a badge in the same call | count | today |
|---|---|---|
| exact name match | 14 (56%) | already folded, costs nothing |
| shares a word, different name | 2 (8%) | counted as new |
| shares nothing | 9 (36%) | genuinely new, correctly counted |

Eight per cent, two occurrences in thirty passes, and one of the two is `green produce bag`
against `red produce bag` and `purple produce bag`, where folding would be wrong: this corpus
really does hold produce bags of different colours holding different things. So the fix would buy
at most one unit across thirty passes and risk a wrong merge doing it. Not worth building, and
that is now measured rather than assumed.

### What is actually left

One thing: the census's discretionary channel is inconsistent on a dense trolley. Given the same
photograph five times it volunteers nine already-badged items once, nothing once, and the right
four once. That is model-level variance on a free-text decision, which the seventeenth
investigation measured as unreachable through sampling controls, both handles being unavailable
or inert.

So the corpus now says: **four photographs solved and stable, one scan improved and stable to
within two, and two dense trolleys whose answer is correct on some passes and not others.** The
gap is consistency on dense scenes, not capability, and the evidence that it is consistency is
that the perfect answer has already been produced for both of them.

## Twenty-second: the two paths want different models, and now get them

The twenty-first left one thing open: the residual on the photographs is the census's unmarked
channel, where it volunteers products no badge landed on, and that channel is inconsistent on a
dense trolley. A bigger model sweeps that channel harder. This file already measured that and
rejected it, in "The census, run", on the grounds that it wrecked the scan.

**That rejection predates the fold.** The stated reason it wrecked the scan was "more descriptions
that cannot be joined", and the nineteenth investigation shipped a join. So it was worth asking
again.

### Photographs, two independent rounds of five passes

| photograph | real | mini exact | gpt-5.4 exact | mini MAE | gpt-5.4 MAE |
|---|---|---|---|---|---|
| IMG_0244 | 1 | 10 of 10 | 10 of 10 | 0.00 | 0.00 |
| IMG_0245 | 1 | 10 of 10 | 10 of 10 | 0.00 | 0.00 |
| IMG_0246 | 2 | 10 of 10 | 10 of 10 | 0.00 | 0.00 |
| IMG_0249 | 3 | 10 of 10 | 9 of 10 | 0.00 | 0.10 |
| IMG_0252 | 9 | 3 of 10 | **7 of 10** | 0.90 | 0.30 |
| IMG_0254 | 15 | 1 of 10 | **3 of 10** | 2.40 | 1.30 |
| **all six** | | **44 of 60** | **49 of 60** | **0.55** | **0.28** |

Badge alignment is 21 of 23 on all twenty passes of both. The sparse four are untouched, which is
the important safety property: the model only changes what was already wrong. IMG_0252 is the
clearest case, its spread collapsing from 7 to 11 units down to 8 or 9.

### The scan, asked again with the fold in place

| | units against 9 real |
|---|---|
| mini, with the fold | 9, 11, 11, 11, 9, 10 (mean 10.2) |
| gpt-5.4, with the fold | 15, 13, 14, 13, 13, 13 (mean 13.5) |

**The fold does not rescue it, and the reason is structural rather than disappointing.** The fold
joins two lines with the same name. A model that sweeps harder does not produce the same name
twice; it produces more different descriptions of the same goods, which is precisely what a name
fold cannot touch. The original rejection stands on the scan.

### So the choice is per path, not per product

The two corpora disagreed because they are two different calls, and the service already knows
which it is making. The orchestrator has exactly two census call sites: one sends no marks and
asks the server to find the regions, which is a still the shopper captured, and one sends the
marks its on-device tracker already has, which is a scan frame. An empty marks array arriving at
`/api/census` is therefore the capture path, structurally and not by guesswork.

`MODELS.censusCapture` is `gpt-5.4`, `MODELS.census` stays `gpt-5.4-mini`, and the route passes
which one it is. Nothing else about the request changes: same prompt, same effort, same strict
schema, pinned by tests. The eval harnesses keep the scan model by default, because they hand in
cached marks to avoid re-running detection, so `marks.length` cannot stand in for the path there
the way it can at the door.

The one cost, stated because it is real: IMG_0249 went from 10 of 10 to 9 of 10, one pass in ten
on a photograph that mini never missed.

## Twenty-third: the scan's last two units, and two fixes refused with numbers

With the model split settled, the scan is the weaker half: 10.2 units against 9 real. Replaying
the six captured answer sets and reading the bags rather than the totals says the residual is two
kinds of error in the free-text channel, and neither has a safe fix.

**Paraphrase.** Run 4's bag holds `bread` and `Seedtastic Bread` as separate lines. One loaf, two
descriptions, no shared key, and the fold shipped in the nineteenth cannot touch it because it
matches whole names and these differ.

**Invention.** Run 5 has `watermelon`; run 2 has `bunch of bananas`. Neither is in the trolley.

### A confidence filter cannot remove the inventions

All 32 unmarked descriptions across the six runs, sorted by the confidence the model gave them:

| item | confidence | real? |
|---|---|---|
| `red produce item` | 0.56 | yes |
| `packaged apples` | 0.63 | yes |
| `apple` | 0.68 | yes |
| **`watermelon`** | **0.77** | **no** |
| `red apple` | 0.78 | yes |
| **`bunch of bananas`** | **0.92** | **no** |
| `loaf of bread`, `green lettuce`, `baguette` | 0.95 | yes |

The two inventions sit in the middle and the high end. Cutting `bunch of bananas` needs a
threshold of 0.93, which deletes 25 of the 32 items, nearly all of them real. **The filter would
remove real products before it removed the invented ones**, so confidence is not a usable signal
here and no threshold was fitted.

### A substring fold would be wrong twice as often as right

The obvious repair for paraphrase is to fold a line whose name ends another line's, which is
exactly the `bread` into `Seedtastic Bread` case. Counted over the same six bags:

| run | pair | verdict |
|---|---|---|
| 2 | `apples` + `Fresh Grown Granny Smith apples` | **wrong** |
| 4 | `bread` + `Seedtastic Bread` | right |
| 5 | `apple` + `Granny Smith apples` | **wrong** |

One correct merge, two wrong. And the wrong ones are the dangerous kind: **this trolley holds two
bags of apples**, a Granny Smith and a Fuji, so folding `apple` into `Granny Smith apples` deletes
a real product the shopper is buying while moving the count towards the truth. It would score
better on this corpus and mean less. The `sharedNames` guard does not save it either: `bread` is
the one name a single call ever put on two badges, so the guard blocks the merge that is right
and permits the two that are wrong. It is inverted on exactly this case.

### Where that leaves the scan

The remaining error is one to two units of paraphrase plus roughly a third of a unit per run of
invention, in a free-text channel with no key, no usable confidence signal, and no lexical rule
that separates "the same loaf twice" from "two different bags of apples" on the evidence
available. Both refusals are measured on held-still answers, so they are not statements about
this corpus's noise; they are statements about the fixes.

## Twenty-fourth: the scan's systematic extra line, traced and not fixable from the label

Reading the six replayed scan bags rather than their totals shows the same extra line in all six:
a `purple produce bag` line beside a separate apple line. Both are the Fuji bag. Verified by
zooming into IMG_0252 at full resolution: the purple bag is printed **"WEST GROWN FUJI, Sure to
please!"** and holds red apples, with the Granny Smith bag in green beside it. The trolley really
does hold two bags of apples, and this is the same one twice.

The SKUs say why they never join:

| description | catalogSku |
|---|---|
| `purple produce bag`, every occurrence, six runs | `kart_purple_produce_bag` |
| `packaged apples`, `red apple`, `apples in plastic bag`, `apple` | **`None`**, every one |

Across all 32 unmarked items in the six runs, **17 carry no SKU at all (53%)**. So the one channel
that could join two descriptions of one product is empty for exactly the descriptions that need
it.

### The label really is wrong, and correcting it does not help

`corpus/kart/run-labels.json` labels that track `purple_produce_bag`, and `build_kart_catalog.py`
turns it into the SKU. That is the same misreading already corrected in `counts.json` and in
`census-live.ts`'s SAME map, never propagated here. It is a genuine corpus defect: a model shown
red apples and offered a SKU literally named `purple_produce_bag` is right to decline it.

Renaming it to `kart_fuji_apple_bag` in the scan's shortlist and re-running six times:

| | units against 9 real |
|---|---|
| shortlist as-is | 9, 11, 11, 11, 9, 10 (mean 10.2) |
| SKU named for what the bag is | 11, 10, 11, 11, 11, 10 (mean 10.7) |

No better, and the mechanism says why rather than leaving it to the spread: **only 1 of 14 apple
descriptions picked the renamed SKU up**, and the overall attachment rate fell, 15 of 32 to 10 of
28. The model's wording changed (`purple produce bag` became `bagged apples`) while the join
stayed missing. So the wrong label is not what was stopping it.

### The structural reason

An unmarked item has no region, so it has no `catalog:` line of its own. Rule 12 asks it to search
every *other* region's list for a match, which is a harder question than copying from its own, and
it is answered about half the time. That is a design gap, not a wording one, and this file already
records the fix for it being tried and refused: "the frame's catalog offered to the unmarked" is
one of the seven listed above.

The rename was reverted so the corpus stays self-consistent. Correcting the label properly means
rebuilding the index, and this measurement says the rebuild would be cosmetic.

### One thing this changes about how the scan should be read

Run 3 scores 9 units against 9 real and is still wrong: its lines are the Fuji bag twice, once as
`Kart purple produce bag` and once as `red apple`, with the yellow produce bag and the brussels
sprouts missing. **A correct total is not a correct bag**, and on this corpus the unit count
flatters the scan. Every scan figure in this file should be read with that in mind.

## Twenty-fifth: scoring the scan by contents, which says something better and something worse

The twenty-fourth ended on the observation that a correct total is not a correct bag. The scan
harness now scores contents as well as size, assigning each bag line to at most one real product,
unambiguous words first, and reporting both a strict count and one that allows words this trolley
shares between two products. Both numbers are reported because resolving "bread" between the
baguette and the Seedtastic loaf, or "apple" between the Granny Smith bag and the Fuji bag, is
inventing the answer the scorer exists to check.

On the six replayed answer sets, with the model held still:

| run | units | products found, strict | allowing shared words | missing | lines matching nothing |
|---|---|---|---|---|---|
| 1 | 9 | 6 of 9 | 8 of 9 | yellow bag | `packaged apples` |
| 2 | 10 | 6 of 9 | 8 of 9 | yellow bag | `apples`, `bunch of bananas` |
| 3 | 9 | 6 of 9 | 8 of 9 | yellow bag | `red apple` |
| 4 | 11 | 7 of 9 | **9 of 9** | none | `bread`, `red apples` |
| 5 | 11 | 8 of 9 | 8 of 9 | yellow bag | `apple`, `watermelon`, `red produce item` |
| 6 | 9 | 6 of 9 | 8 of 9 | yellow bag | `apples in plastic bag` |

**The better news: the scan is not blind.** It finds eight or nine of the nine products on every
single run. The bag's error is duplication, not absence, and that is a materially different
problem from the one "10.2 units against 9" describes.

**The worse news: the totals were ranking the runs backwards.** Run 4, the joint worst by units at
11, is the *best* bag here: it is the only run that finds all nine products, and both its extra
lines are second descriptions of things it already has. Run 3, which scores a perfect 9 units, is
one of the weakest: it misses the yellow bag and spends a line on a duplicate `red apple`. Every
comparison in this file that ranked scan runs by unit count was ranking partly by luck.

### One specific, repeatable miss

The yellow produce bag is absent in **five of the six runs**, and it is the only product that is
ever missing. Everything else in this trolley is found every time. That is not variance, it is one
item the scan does not see, and it is the same item that lies under the Fuji bag and the baguette
in IMG_0252. It is a single, concrete target rather than a diffuse consistency problem.

### What the two numbers mean together

Strict is low, six to eight of nine, because this trolley's products genuinely share words: two
bags of apples and two breads. Lenient is eight or nine every run. The truth is between them and
the gap is a property of the trolley, not of the pipeline. Reporting one number would have hidden
that; the earlier unit counts hid it completely.

## Twenty-sixth: why the scan misses the yellow bag, and it is none of the things assumed

The twenty-fifth isolated one repeatable miss: the yellow produce bag, absent in five of six runs
and the only product ever missing. Four things were checked, and the first three rule out the
usual explanations.

**It is not occluded.** Zooming into frame 016 at native resolution shows the purple bag printed
`NORTHWEST GROWN FUJI` holding red apples, and immediately to its left a **separate yellow produce
bag with its own gathered top**, unobstructed and distinctly coloured. It is a real, plainly
visible product.

**It is not a naming problem, and the model is not incapable of seeing it.** The word `yellow`
appears **0 times in 366 census entries across eighteen scan runs**. Not once, in any mark or any
unmarked description. The same model on the same trolley says `yellow produce bag` explicitly on
the photograph, in IMG_0254 pass 4. So it can name it; on the scan it never gets the chance.

**No badge ever lands on it.** At order 15, the frame where the trolley's middle fills the view,
the census is handed **three** regions: the Seedtastic loaf, the greens and the baguette. The
purple bag and the yellow bag both sit in the centre of the frame with no box on either. The
purple one still reaches the bag, because the census volunteers it unmarked, which its large white
FUJI label makes easy. The yellow one, smaller and plainer, is volunteered by nothing.

### The structural finding

The scan's census sees far less of the trolley than the capture path's does:

| | regions the census is given |
|---|---|
| scan, the four frames it fires on | 7, 4, 3, 3 — **17 in the whole session** |
| capture, IMG_0252, same trolley | **10 in one frame** |
| capture, IMG_0254 | 11 in one frame |
| scan, all 27 frames | median 5, max 8 |

A scan frame's marks come from the on-device tracker's confirmed tracks, not from a detector pass
on that frame, and confirmation takes several frames. A small item beside a larger one never
becomes its own track, so it is never badged, so the census only reaches it through the
discretionary unmarked channel, which the twenty-first measured as the sole source of variance and
the twenty-fourth found carries no joining SKU half the time.

That chain explains the scan's whole residual without any appeal to noise: **too few regions,
which forces the work onto the one channel that is both inconsistent and unjoinable.** It is also
why the larger model helped the photographs and hurt the scan: it pushes harder on exactly that
channel.

The obvious remedy is to give a scan keyframe the regions the capture path gets, by enumerating
server-side rather than trusting the tracker's marks. That is an architectural change with a real
latency cost per census call, and this corpus can measure its accuracy but not its cost, so it is
recorded here as the next measurable step rather than made.

## Twenty-seventh: the sharpness rule, doubted on good grounds and confirmed on better ones

The twenty-sixth found the yellow bag reaches the census through no region on either path. Probing
frame 016 with every prompt available says something sharper:

| prompt set | proposals | best coverage of the yellow bag | regions isolating it |
|---|---|---|---|
| grocery prompt | 12 | 100% | **0** (the box also holds the purple bag) |
| produce, single, which is what ships here | 0 | 0% | 0 |
| **produce, paired** | 25 | 97% | **1**, at 80% yellow and 23% purple |
| targeted colour wording | 7 | 98% | 0 |

The paired produce prompts find it. They are blocked on this frame by the shipped sharpness rule:
frame 016 measures 217 against `PAIRED_PRODUCE_SHARPNESS` of 700.

**That was worth doubting.** The rule was fitted on unit counts, and the twenty-fifth showed unit
counts rank scan runs backwards. A rule justified by a misleading metric deserves re-measuring on
a better one.

### Re-measured by contents, the rule holds

Detection re-run over the whole video with `--produce-pairs` gives 205 regions, 7.6 per frame
against the shipped 5.1, and the catalog column refreshed against the same index. Six scan runs:

| | products found, allowing shared words | consistently missing |
|---|---|---|
| shipped sharpness rule | 8, 8, 8, 9, 8, 8 of 9 | the yellow bag, in five of six |
| paired produce forced | 7, 6, 7, 6, 6, 7 of 9 | **cauliflower and Seedtastic bread, in all six** |

Worse on every run, and worse in a specific way: the extra regions cost the cauliflower and the
loaf **every single time**, while recovering the yellow bag in three runs of six. Two reliable
products for one unreliable one is a bad trade, and by units alone it would have looked almost
level, seven to ten against nine.

**So `PAIRED_PRODUCE_SHARPNESS` stays, now resting on a measurement that can tell a right bag from
a lucky one.** The suspicion about its original justification was sound; the rule survived it.

### What this closes

The yellow produce bag is reachable in principle, by exactly one proposal from a prompt set that
costs two other products to enable. Every other route was checked and none isolates it: the
grocery prompt draws one box over it and the purple bag together, targeted colour wording does the
same, server-side enumeration on the keyframe raises its coverage from 12% to 78% and still only
inside a box that wholly contains the purple bag, and the tracker never confirms it as its own
track. That is the whole search space for this item on this corpus, and it is exhausted.

## Twenty-eighth: the photographs, scored by contents at last

The scan got a contents scorer in the twenty-fifth and it immediately showed the unit counts were
ranking runs backwards. The photographs had never had one, so every photograph figure in this file
is a unit count. Applying the same check, on the four saved answer sets so no model was called:

| | products found, strict | allowing shared words | lines matching nothing | exact by units |
|---|---|---|---|---|
| gpt-5.4-mini, two rounds | 238 of 310 | 257 of 310 | 29 | 44 of 60 |
| **gpt-5.4**, two rounds | **260 of 310** | **282 of 310** | 36 | 49 of 60 |

Twenty-five more real products found for seven more spurious lines. The model split shipped in the
twenty-second holds on contents as well as on totals, which is worth stating because the first
version of this scorer said the opposite.

### The scorer was wrong first, and the fix changed the verdict

Scoring by line name alone, gpt-5.4 looked like +14 products for +18 spurious lines, a bad trade
that would have argued for reverting the model split. That scorer was broken: a bag line carries a
quantity, and IMG_0254 holds two egg cartons and two packs of Muenster, so one line reading
"eggs" with qty 2 is a correct answer rather than half of one. Counting by name marked the second
of every duplicated product missing on every pass and understated both models. Consuming quantity
turned a bad trade into a clearly good one. **A measurement that disagrees with a shipped decision
is a reason to check the measurement first.**

### What the photographs actually get wrong

The four sparse photographs find every product on every pass with no spurious lines at all. All the
error is the two loaded trolleys, and it is three specific things rather than a diffuse gap:

- **The Fuji bag is counted twice.** Nearly every gpt-5.4 pass on IMG_0252 and IMG_0254 carries a
  second line reading `red apples`, `tomatoes on the vine`, `roma tomatoes` or `beefsteak
  tomatoes` beside the line that already has the bag. The same double-count the scan has.
- **The yellow produce bag is missed**, on IMG_0252 in nearly every pass of both models. The same
  item the scan misses in five runs of six, now confirmed to fail on the still photograph too, so
  it is not a scan-specific problem.
- **The shopper's tote is sometimes a product**, arriving as `woven serving tray or placemat` or
  `woven placemat`. A known naming failure, now counted.

### One truth entry is not readable from the photograph

`counts.json` calls the fifteenth item in IMG_0254 broccoli. At native resolution that bag shows
green contents behind leaf-print graphics and a 1 LB weight, with no legible product name. Both
models miss "broccoli" on nearly every pass and gpt-5.4 twice answered "brussels sprouts", which
the strict tier scores as an invention. The entry now carries its uncertainty: strict still demands
the word the truth claims, the lenient tier accepts any bagged green the photograph could support,
and the count of 15 is unaffected either way since something is certainly in that bag. It is
recorded rather than rewritten, because unlike the Fuji bag and the IMG_0252 count, this one cannot
be settled by looking harder.

## Twenty-ninth: the Fuji double-count, and the third and last fold refused

The twenty-eighth named the Fuji bag counted twice as the highest-value target left, appearing on
both the scan and the photographs. Tracing it through the saved answers shows it is two different
faults wearing one face.

**On IMG_0254 it is an unmarked item.** `red apples` arrives with no box and no SKU, beside a
badge already holding the bag. Nothing spatial can reach it: an unmarked item has no geometry, only
an `approxLocation` phrase.

**On IMG_0252 it is three badges on one bag.** Rendering them settles what the numbers alone could
not:

| badge | box | what it is on | named | sku |
|---|---|---|---|---|
| 8 | x .157 w .323 | the purple half of the Fuji bag | `purple produce bag` | `kart_purple_produce_bag` |
| 9 | x .476 w .073 | the red apples, seen through the clear half | `red apples` / `Roma tomatoes` | **none** |
| 10 | x .379 w .180 | the same red apples, wider | same as 9 | **none** |

Badge 9 is 100% inside badge 10, so the existing containment fold already merges those two. Badge 8
against badge 10 is the pair that double-counts, at **IoU 0.204, containment 0.461**.

### Why no threshold separates it

Every labelled badge pair in this corpus that holds two genuinely different products:

| pair | IoU | containment |
|---|---|---|
| **IMG_0249 badges 2, 3** | **0.215** | 0.524 |
| IMG_0249 badges 1, 2 | 0.147 | 0.267 |
| IMG_0254 badges 6, 8 | 0.145 | 0.338 |
| IMG_0246 badges 1, 2 | 0.109 | 0.200 |

The most-overlapping pair of genuinely different products sits at 0.215. The Fuji pair that must be
merged sits at **0.204, below it**. A threshold low enough to fold the Fuji bag folds two real
products in IMG_0249, which is one of the four photographs currently perfect on every pass. The
classes are not separable by overlap, and this is not a close call to be settled with more data:
the wrong pair is already ranked above the right one.

The automated pairing found no same-product pairs at all, because `still-labels.json` carries 8
labels for IMG_0252's 10 boxes and badges 9 and 10 are unlabelled. The pair above was established
by rendering the boxes and reading the photograph, which is why it is quoted rather than counted.

### Where that leaves it

Three folds have now been tried against this one product, each refused with a number:

| fold | verdict |
|---|---|
| by name | `purple produce bag` and `red apples` share no word |
| by SKU | badge 8 has one, badges 9 and 10 have none; 53% of unmarked items carry none either |
| **by overlap** | **0.204 for the pair to merge, 0.215 for a pair that must not** |

The bag is one product wearing two appearances, a purple plastic half and a clear half full of red
apples, and the three channels that could join them are respectively silent, empty, and inverted.
