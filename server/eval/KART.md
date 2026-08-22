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

## Where this stands

This file grew by appending across forty-one investigations, so it reads chronologically and its
early figures are superseded. This section is the current state; everything below is how it was
arrived at.

**Scored by contents, not only by size.** A unit count cannot tell a right bag from a lucky one:
one scan run scored a perfect nine while holding one product twice and missing two others. Both
harnesses assign each bag line to at most one real product and report two numbers, because this
trolley holds two bags of apples and two breads, and resolving `apple` or `bread` inside the
scorer would be inventing the answer it exists to check.

### The app's scan, end to end

`scan-loop.ts` runs the real frame loop in Node: the real `processFrame`, the real tracker, the
real `RecognitionSession`, the shipped `runCensus`. Only the transport is stubbed, and the
enumerator, replaced by this video's cached region column.

| | units, nine real products | products found |
|---|---|---|
| as it was this morning | 19, 15, 15 (**16.3**) | five separate descriptions of the same greens |
| as it ships now | 13, 11, 11, **9** (**11.0**) | 8, 8, 8, **9** of 9 |

One run in four is a completely correct bag: nine units on nine lines, every product found, nothing
invented. The single repeatable miss is the yellow produce bag.

### The six photographs, one census call each

This is the per-call quality of any single capture, measured on the server's regions:

| | |
|---|---|
| exact on every pass, no spurious lines | **IMG_0244, IMG_0245, IMG_0246, IMG_0249** |
| IMG_0252, 9 products | 7 of 10 passes exact |
| IMG_0254, 15 products | 3 of 10 passes exact |
| products found | 260 of 310 strict, **282 of 310** allowing shared words |
| badge alignment | 218 of 250 |

### What ships

The EXIF fixes, without which `runIdentify` had never once run on a real phone photograph; the
plural fold in `productKey`; the SKU alias; the `sharedNames` fold that merges one product reached
under two catalog SKUs; the sharpness-conditioned produce pass; and **`scan.tsx` calling
`onCapture`**, so the census is badged from the service's regions rather than from a device
detector that returns one outline around the whole pile.

### What is left

| fault | every fix tried, and refused with a number |
|---|---|
| the yellow produce bag unseen | five prompt sets, three detector settings, server-side enumeration, paired produce twice on two different paths; pacing ruled out, since the census does see a frame it is visible in |
| the Fuji bag counted twice | folds by name, by SKU, and by overlap (0.204 for the pair to merge against 0.215 for a pair that must not) |
| the shopper's tote counted as a product | rule 8 extended to cover a shopper's belongings; cost seven exact passes |
| a census guess overwriting two that agreed | fix written, refused twice; the obvious implementation breaks the original counting-bug regression test |

**The recurring mechanism, and the most useful thing this corpus taught:** every attempt to give
the census more to see, say or weigh cost accuracy on what it was already doing. Produce prompts in
pairs, the frame catalog offered to the unmarked channel, the session's own answers fed back, a
larger model on a fused scan, a fuller non-product rule, a larger image. Six attempts, one shape.
What helped was the opposite: fixing an orientation bug, giving two descriptions a key to join on,
and pointing the app at regions it was already paying a service to compute.

### One correction to the figures below

Every "lines matching nothing real" count in this file was produced by a scorer that counted
**lines rather than units**, and that ignored a line's quantity when matching it against the truth.
A bag line carries a quantity, so `2 x long loaf of bread in clear plastic wrap` is two units on
one line, and the scorer credited it as one.

Fixed on 2026-08-22, after the same bug was found and fixed in the photograph scorer and the video
copy turned out to have been extracted before that fix. What it changes:

- **The replayed scan figures are unaffected.** Those bags are all quantity 1, so line counts and
  unit counts agree, and every replay number quoted below stands as written.
- **The shipped-path loop figures understated the spurious count**, because that path does produce
  quantity-2 lines. Re-run, it reports the leftover correctly, for example `partially visible x2`.
- Products found is unaffected on this trolley, which holds nine distinct products and no
  duplicates, so no truth entry ever needed a second unit from one line.

### What is not verified

Nothing since the rewiring has run against a live camera. The loop is verified in Node and the app
is verified to build, launch and render on a simulator, which has no camera device. Untested: the
camera driving the loop, outlines redrawing from a capture's tracks, and whether coverage, amber
and thumbnails read sensibly when tracks refresh on captures rather than every frame.

---

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
the six photographs, 9 for IMG_0252 and the scan, and 15 for IMG_0254.
**And any badge-alignment figure with a denominator of 23 is scored on an incomplete label set**:
IMG_0252 carried ten boxes and eight labels, so two badges went unscored until they were labelled,
and they are exactly the two the models most often get wrong. Alignment reads about three points
lower once they are included; see the thirtieth section. Those figures are left as
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

## Thirtieth: closing a measurement gap that was flattering the numbers

`query-labels.json` carried eight labels for IMG_0252 while the frame carries ten boxes, so badge
alignment silently skipped two badges on the second-hardest photograph in the corpus. Every "21 of
23" in this file was scored on a set that excluded them.

Both are the Fuji bag, established by cropping each box at native resolution: badge 10 reads
`WEST GROWN / FUJI / Sure to core!` over `Net Wt 48 oz (3 lb) Extra Fancy`, and badge 9 is the same
red apples through the clear half of that bag. They are labelled `purple_produce_bag`, the SKU the
index is built on, which `census-live.ts`'s SAME map already reads as the Fuji bag.

With those two scored, over the same four saved answer sets and no model called:

| | alignment, as reported before | with all ten badges scored |
|---|---|---|
| gpt-5.4-mini | 21 of 23, 91.3% | 221 of 250, **88.4%** |
| gpt-5.4 | 21 of 23, 91.3% | 218 of 250, **87.2%** |

Three points lower for both, and the two badges were not a random sample: they are exactly where
the models answer `Roma tomatoes` or `tomatoes on the vine` for red apples in a Fuji bag. The gap
excluded the hardest badges in the corpus from the badge score.

It also separates the two models where the old scorer could not. Both sat flat at 21 of 23 on
every pass; scored properly, gpt-5.4 ranges 21 to 23 across passes while mini ranges 21 to 23 too,
but their totals differ by three and one gpt-5.4 round sits four badges below the other. The old
number's perfect stability across forty passes was the gap holding it still, not the pipeline.

## Thirty-first: the tote, the last of the three faults, and the rule that did not fix it

Of the three named faults the tote was the only one whose fixes were not yet exhausted. The
earlier attempt at it was reverted as a misdiagnosis: it was treated as an `isProduct` failure when
the model was really misnaming the tan woven texture as bread. Measured again with the better
instruments, the diagnosis changes.

**The tote is counted as a product in 20 of 20 passes, both models.** Never once flagged. What the
models call it differs sharply: mini says `baguette` on all ten, while gpt-5.4 says `purple produce
bag`, `wafer crispbread crackers`, `wrapped cheese slices`, and **twice names it correctly** as
`woven placemat` and `woven placemat or household mat` while still setting `isProduct` true.

That last part is what makes it a rule-following gap rather than a naming failure. Rule 8's list of
non-products is "the cart frame or mesh, a bag handle, a hand, a person, the floor, a shelf behind
the cart, an empty region". Nothing in it covers the shopper's own belongings lying in with the
goods, which is a real category every trolley meets: a reusable tote, a handbag, a coat, keys.

### Extending the rule made things worse

Rule 8 was given that category explicitly, in general terms rather than describing this tote. Two
rounds of five passes each, on the capture model, against the two rounds already recorded:

| | before | after |
|---|---|---|
| tote counted as a product | 10 of 10 | 9 of 10 |
| products found, strict | 260 of 310 | **239 of 310** |
| products found, lenient | 282 of 310 | 275 of 310 |
| lines matching nothing real | 36 | **48** |
| photographs exact, by units | 49 of 60 | **42 of 60** |

It barely moved the thing it targeted and cost twenty-one strict identifications, twelve extra
spurious lines and seven exact passes. Reverted.

The mechanism is worth recording because it is the same one this file has hit before: **anything
that gives the census more to weigh costs it accuracy on what it was already doing.** A longer
non-product list is more to weigh. The produce pairs, the frame catalog offered to the unmarked,
the session's own answers fed back, and now a fuller rule 8 have all failed the same way.

One thing the measurement did clear up: a fear that naming "a reusable shopping bag" would make the
model reject real produce bags. It did reject IMG_0252's badge 8 once, but that badge was already
being rejected twice in a round taken before the change, so the rule did not cause it.

All three named faults are now closed, each with the fixes tried and refused by number: the Fuji
bag counted twice (name, SKU and overlap folds all refused), the yellow produce bag unseen (five
prompt sets, three detector settings, and server-side enumeration all refused), and the tote
counted as a product (rule 8 extended and reverted).

## Thirty-second: a real fusion bug, reproduced, fixed, and refused

Every fix this file has tried adds something, and each failed the same way. The harness itself
records the untried opposite: *"the trolley is static, each call re-describes it in fresh words,
and nothing joins the descriptions but the words themselves. If the fourth look costs more than it
finds, the cap is the fix and it is free."* Replay makes that free to test.

| census calls | units against 9 | products found, lenient |
|---|---|---|
| 1 | 6.2 | 6.2 of 9 |
| 2 | 7.8 | 7.5 of 9 |
| **3** | 7.3 | **6.7 of 9** |
| 4, as shipped | 9.8 | **8.2 of 9** |

**The cap is not the fix: the fourth look finds more than it costs.** But three is worse than two,
and a call that loses products is not something a bag builder should be able to do at all.

### What the third call does

Tracing `track_3` through one run:

| call | what the census says | |
|---|---|---|
| 0, t=1s | `brussels sprouts`, sku `kart_brussels_sprouts` | |
| 1, t=3s | `Brussels sprouts`, same sku | agrees |
| 2, t=5s | **`asparagus`**, sku `kart_asparagus` | **overwrites both** |

The brussels sprouts leave the bag, in **all six captured runs**. A single wide-shot guess replaces
two that agreed with it. `applyCensus` already forbids exactly this for a resolved barcode and for
an identify-verified identity, for the reason stated in both branches: one misread on a
glare-washed frame must leave no permanent trace. A plain census identity had no such protection,
and a scan asks several times, so the last call always won.

### The fix works, and is still refused

`Identity` gained an `agreed` counter, and an identity two censuses had confirmed required the
same `pendingAlias` corroboration the other two branches use. At three calls it does exactly what
it claims: brussels sprouts is recovered in **all six runs**, products found 40 to **44** of 54.

At four calls, which is what ships, it does not pay:

| | without | with |
|---|---|---|
| products found, lenient | 49 of 54 | 50 of 54 |
| lines matching nothing real | 10 | **13** |
| units against 9 | 9.8 | **10.7** |

One real product gained for three spurious lines. The fourth call already re-names that track
correctly, so the protection's benefit is mostly spent by the time the shipped configuration
finishes, while its cost is not. By the standard every other candidate in this file was held
to — a fix must not trade a reliable gain for an unreliable one — it is refused, and reverted.

**The bug is real and stays recorded.** It is reproduced deterministically, its mechanism is
understood, and the protection is written and known to work. What this corpus cannot show is the
case where it matters: `MAX_CENSUS_CALLS_PER_SESSION` is 8 and this nine-second video only ever
reaches 4, so a late misread never has a long-established identity to destroy here. A longer scan
would settle it, and that is a capture question rather than a code one.

## Thirty-third: resolution looked like the exception, and is not

Every refused fix in this file failed the same way: giving the census more to see, say or weigh
cost it accuracy on what it was already doing. Resolution seemed like it should be different. It
adds no content at all, only legibility, and the three remaining faults are a small bag, an
unreadable label, and two adjacent halves of one bag — exactly what more pixels should help.

`CENSUS_LONG_EDGE` is 1536. 2048 had been swept once before, but against the old rule 12, when
`unmarkedItems` came back empty at every resolution and the sweep could only report zeroes. The
rule has since been rewritten and that channel is now the main one, so the number was worth asking
again on a pipeline that can answer it. Two rounds of five passes on the six photographs, capture
model, contents-scored:

| | 1536, as shipped | 2048 |
|---|---|---|
| photographs exact, by units | **49 of 60** | 41 of 60 |
| products found, strict | 260 of 310 | 262 of 310 |
| products found, lenient | **282 of 310** | 276 of 310 |
| lines matching nothing real | **36** | 46 |
| badge alignment | **218 of 250** | 210 of 250 |

Worse on four measures of five, and the exception moves two counts, which is noise at that size.
Eight fewer exact passes and ten more spurious lines.

**The mechanism holds even here.** More pixels is more for the census to say, and what it finds
with them is net wrong: the spurious lines rise faster than the real products do. Resolution
looked like the one lever that adds legibility without adding load, and the corpus says there is
no such lever for this call. `KART_CENSUS_LONG_EDGE` stays as an eval-only override defaulting to
1536, carrying the measurement in its docstring.

That makes six independent attempts sharing one shape: produce prompts in pairs, the frame catalog
offered to the unmarked channel, the session's own answers fed back, a larger model on the scan, a
fuller non-product rule, and now a larger image. Whatever is limiting this census, it is not what
it can see.

## Thirty-fourth: what the app runs is not what this file measures

Thirty-three investigations tuned the census, the folds, the prompts and the models against a
region supply the shipped app does not have. That is the most important thing this corpus has
shown today and it was found by checking the app rather than the pipeline.

### The chain, read from the screen down

`FloatingNav` routes to `/scan`, so the live scan is the primary user action. `scan.tsx` runs a
native frame processor, `scanCart`, per frame. `KartVisionFrameProcessorPlugin` wires
`private let detector: KartDetector = AppleInstanceMaskDetector()`, which is
`VNGenerateForegroundInstanceMaskRequest`. Its instances become tracks, and `scan.tsx` calls
`session.onKeyframe(...)`, which does `marksFor(tracks)` and sends those marks to `/api/census`.

So the census is badged from Apple's segmenter. Measured on these exact frames with
`npm run bench:detector`: **1 to 2 instances per frame, mean 1.1, across all 30 images.**

`docs/detector-decision.md` measured that same request as dead for enumeration a week ago, "1
instance every photo, 0 of roughly 100 items", and installed the remedy in the orchestrator:
`onCapture`, which deliberately sends **no** marks so the server enumerates. Searching the app for
callers finds `onCapture` in `orchestrator.test.ts` and **nowhere else**. The decision was
implemented and never routed to.

### What it costs

| | regions per frame | units against 9 real | products found |
|---|---|---|---|
| this file's scan measurements | 5.1 | 9.8 | 8 or 9 of 9 |
| **one region per frame, as shipped** | **1.1** | **15, 18, 18** | 7 or 8 of 9 |

Roughly the same products, roughly double the bag. With a single badge nearly every product
arrives through `unmarkedItems`, and the twenty-fourth section measured that channel as carrying
no joining SKU on 53% of its entries, so one product becomes several lines. Fifteen to eighteen
lines for nine products is what a shopper would see.

The simulation is optimistic in two ways and should be read as a bound rather than a figure: it
keeps the best-scoring Grounding DINO box rather than Apple's blob, and it still gives the tracker
every region for continuity.

### What follows

The four sparse photographs being exact on every pass, the model split, the SKU fold, the
sharpness rule: all of those were measured on the server's regions and all of them remain true of
that path. What is not established is that any of it describes what the app does today, because
the app does not use that path.

`MODELS.censusCapture`, shipped in the twenty-second section, is the sharpest illustration.
It selects on an empty marks array, `onKeyframe` returns early when the marks are empty, so no
screen can reach it. It is correct, tested, and routed to nothing.

**This is wiring rather than tuning.** Either a screen calls `onCapture`, or `onKeyframe` stops
trusting the device detector and lets the server enumerate its keyframes. Both change what the
shopper does with the camera, so both are product decisions and neither is mine to make. It is
reported here with the numbers instead.

## Thirty-fifth: the app built and ran, and what that does and does not settle

Rather than ask for a device, the app was built and launched here: `xcodebuild` Release against
`ios/Kart.xcworkspace`, 265 seconds, **build succeeded**, installed and launched on an iOS 26.3
simulator.

**What it settles.** The app compiles and runs with today's changes in it, the home screen renders,
and `/scan` opens, starts its session timer and shows the bag tray at zero items. Nothing in the
fusion work, the model split or the harness changes broke the build or the launch. That is real
verification that was missing all session, and the build loop now exists for the next change.

**What it does not settle.** The scan screen stops at "Requesting camera access…" because a
simulator has no camera. The frame loop never runs, so no frame reaches `scanCart`, no instance
reaches the tracker, and no keyframe reaches the census. The one path that matters for the
thirty-fourth section's finding is exactly the path a simulator cannot exercise.

### Why the rewiring is still not made

Switching `scan.tsx` from `onKeyframe` to `onCapture` means the frame loop must stop feeding the
tracker, because `processFrame` would otherwise overwrite each capture's server regions with the
next frame's single blob. Coverage, amber, thumbnails and the keyframe gate all read
`result.tracks`. Every one of those interactions lives in the frame loop, and the frame loop is
the part a simulator cannot run.

The recognition half of the question is already answered and does not need a device: badging the
census from the server's regions gives 9.8 units and 8 or 9 of 9 products, against 15 to 18 units
and 7 or 8 today. What is unverifiable here is whether the restructured loop behaves, and writing
both that code and its tests from one mental model is not verification of it.

So the position is unchanged but the reason is now precise: **the change is one I can write and
cannot test, on the screen the product depends on, while the current behaviour is poor but
working.** A device, or an instruction to proceed on tests and reasoning alone, resolves it.

## Thirty-sixth: the frame loop, measured in Node, and the rewiring made

The thirty-fifth said the restructure was unverifiable because a simulator has no camera. That was
half right. The camera and the rendering need a device; **the loop's logic does not.**
`processFrame`, the tracker and `RecognitionSession` are plain TypeScript, so the loop can be run
in Node against the real corpus. `scan-loop.ts` does that, with the real orchestrator, the real
tracker, and the shipped `runCensus`. Only the transport is stubbed, and the enumerator, which is
replaced by this video's cached region column.

Three runs each, nine real products:

| | units in the bag |
|---|---|
| `onKeyframe`, as shipped | 19, 15, 15 (**mean 16.3**) |
| `onCapture`, the decided path | 11, 11, 12 (**mean 11.3**) |

The error against nine falls from +7.3 to +2.3. The lines say why better than the totals do. The
shipped path returns eighteen of them, including `bag of leafy greens`, `bag of lettuce greens`,
`bag of shredded lettuce`, `leafy greens bag` and `green bag of salad greens` — five descriptions
of the same greens, because with one badge almost everything arrives through `unmarkedItems`,
which carries no joining SKU on half its entries. The capture path returns eleven, and they are
`Oreo`, `Brussels sprouts`, `Seedtastic bread`, `asparagus`, `Granny Smith apples`, `baguette`,
`red apples`, `Cauliflower`.

### The interaction I said could not be checked, checked

The stated blocker was that `processFrame` feeds the tracker every frame, so a capture's server
regions would be overwritten by the next frame's blob. `scan-loop.ts` runs exactly that: the
device's one region through `processFrame` on all 27 frames, with the capture's tracker taken back
between them. It holds. That was the risk, and it is measured rather than argued.

### So `scan.tsx` now calls `onCapture`

The change is the call and the tracker handover, written to mirror the harness line for line.
Verified: 386 app tests, 273 server tests, both typechecks, and the app rebuilt for the simulator
and relaunched, home screen and scan screen both rendering with no crash.

**What is still unverified, and it is not nothing.** A simulator has no camera device, so
`useCameraDevice` returns null, the `Camera` never mounts and the frame processor never runs. The
loop is verified in Node and the app is verified to build, launch and render; what no test here
covers is the live camera driving it, the outlines redrawing from a capture's tracks, and whether
coverage, amber and thumbnails read sensibly when tracks refresh on captures rather than on every
frame. Those want ten seconds with a real phone and a real trolley.

## Thirty-seventh: the rewiring made this morning's model split meaningless, so it is gone

`MODELS.censusCapture` selected gpt-5.4 when a request arrived with no marks, on the reasoning
that a captured still and a scan frame fail differently. The thirty-sixth commit pointed
`scan.tsx` at `onCapture`, which sends no marks. So every census the app makes now takes the
capture branch, and the split has nothing left to select on.

Worse, it was selecting the wrong way. Measured on the real frame loop, three runs each against
nine real products:

| census model, capture path | units |
|---|---|
| gpt-5.4, what the split chose | 12, 12, 11 (**mean 11.7**) |
| gpt-5.4-mini | 8, 11, 10 (**mean 9.7**) |

The original finding holds and is not contradicted: gpt-5.4 reads a single photograph better, 49
of 60 passes exact against 44 and 282 of 310 products found against 258. It sweeps harder for
products no badge landed on, which on one image is more of the trolley found and across four
fused calls is more descriptions that will not join.

**What changed is which of those two situations the app is in.** It has no screen that captures a
single still: `index.tsx` and `FloatingNav` route only to `/scan`, and every keyframe there is now
fused with the others. The photograph numbers describe a path the product does not offer. So the
split is removed rather than left choosing the wrong model, `MODELS.census` is mini, and the
measurement that argued for gpt-5.4 is recorded beside it so the case is not lost.

### Where the app's scan actually stands now

Same harness, same corpus, the real loop end to end:

| | units, nine real products |
|---|---|
| this morning: `onKeyframe` + device regions | 19, 15, 15 (**16.3**) |
| now: `onCapture` + server regions + mini | 8, 11, 9 (**9.3**) |

The bag the app builds for this trolley went from roughly seventeen lines to roughly nine, against
nine real products. That is the largest single improvement in this file and none of it came from
tuning the census: it came from checking what the app ran and finding it was not what the corpus
measured.

## Thirty-eighth: the app's own loop, scored by contents

`scan-loop.ts` now scores contents against the same truth table `video-census-live.ts` uses,
extracted to `video-truth.ts` so the two harnesses cannot drift. Four runs of the loop exactly as
it now ships, `onCapture` with mini:

| run | units | lines | products found | missing | lines matching nothing |
|---|---|---|---|---|---|
| 1 | 13 | 11 | 8 of 9 | yellow bag | 3 |
| 2 | 11 | 9 | 8 of 9 | yellow bag | 1 |
| 3 | 11 | 9 | 8 of 9 | yellow bag | 1 |
| 4 | **9** | **9** | **9 of 9** | **none** | **0** |

**Run 4 is a correct bag**: nine units on nine lines for nine products, every one found, nothing
invented. The app's scan can now produce the right answer for this trolley. It does so in one run
of four.

The residual is the one this file has already exhausted: the yellow produce bag, missing in three
of four, with every route to it checked in the twenty-sixth and twenty-seventh sections and each
one costing more than it buys. The spurious lines are the familiar unjoined descriptions,
`bag of green beans`, `bagged tomatoes`, `apples in plastic bag`.

For comparison, the same loop this morning returned 19, 15 and 15 units on 18, 15 and 15 lines,
with five separate descriptions of the same greens among them.

## Thirty-ninth: re-testing a refusal on the path that actually ships

Most of the refusals in this file were measured on `video-census-live.ts`, which badges the census
from the server's whole region set. The app does not do that, so those refusals deserved
re-checking on `scan-loop.ts`. The one worth re-checking first is the paired produce prompts,
because the twenty-seventh section showed they contain the only proposal that isolates the yellow
produce bag, which is the residual's one repeatable miss.

Four runs each through the app's real loop:

| | products found, lenient | units against 9 |
|---|---|---|
| shipped regions | 8, 8, 8, 9 (**8.25**) | 13, 11, 11, 9 (**11.0**) |
| paired produce | 7, 9, 7, 7 (**7.5**) | 13, 16, 12, 15 (**14.0**) |

Worse on both, and it does not even recover what it was tried for: the yellow bag is still missing
in three of four. It now loses the Granny Smith apple bag as well, in two runs, and the Fuji bag in
a third. `PAIRED_PRODUCE_SHARPNESS` is confirmed a second time, on a different path, against a
better metric.

That is the pattern for the whole file, restated once: **more regions, more prompts, more model,
more pixels, more rules — every one of them measured worse.** What helped was the opposite kind of
change: fixing an orientation bug, giving two descriptions a key to join on, and pointing the app
at the regions it was already paying a service to compute.

## Fortieth: the last refusal re-tested, and the suite caught what the numbers did not

The thirty-second section found a real fusion bug, wrote the fix and refused it because it did not
pay at four census calls. That was measured on the old path. On the capture path tracks are
re-derived from server regions at each capture, so the dynamics differ enough to re-ask.

Re-applied and run through the app's real loop, four runs:

| | products found, lenient | units against 9 |
|---|---|---|
| without the protection | 8, 8, 8, **9** (8.25) | 13, 11, 11, 9 (11.0) |
| with it | 8, 8, 8, 8 (8.0) | 11, 10, 11, 10 (10.5) |

Marginally tighter units, marginally fewer products, and it loses the one run in four that produced
a completely correct bag. On those numbers alone it would be a coin-toss refusal.

**The test suite settled it properly.** Three tests fail with the protection in place, and they are
not incidental:

- `does not undercount two cartons that a crop identify renames to the same new name` — the
  regression test for the original counting bug this whole engine exists to fix
- `I6: a later plain census does not clobber what a crop identify already found`
- `follows up on a low confidence item with a crop`

The cause is in the patch, not the idea. Its agreement branch `continue`s before writing the
identity, so `confidence` and `needsCloserLook` freeze at the values the first census gave them,
and an item that should have been referred to a crop identify never is. A protection against stale
answers that itself makes answers stale.

Reverted. The bug in the thirty-second section remains real and remains recorded; what is now also
recorded is that the obvious implementation of its fix breaks the counting guarantee, so anyone
returning to it needs a version that refreshes the identity while still refusing to re-key it.

**Two independent reasons to refuse, and the stronger one came from the tests rather than the
corpus.** That is worth saying at the end of forty investigations: the numbers here are noisy
enough that a marginal result should never be the only evidence, and this project's own regression
suite was the better instrument.

## Forty-first: the last tunable constant, and it is already at its best

One lever was never tested: how often a session captures. Nine seconds at the shipped
`minIntervalMs` of 2000 fires four censuses against a session budget of eight, so half the budget
is never spent, and products found had risen with every extra call up to four. Spending the rest
looked like free recall.

`scan-loop.ts --interval=<ms>` puts that through the app's real loop. Three runs each:

| pacing | products found, lenient | what goes missing |
|---|---|---|
| 1000 ms, eight captures | 7, 7, 7 (**7.0**) | the cauliflower, in all three |
| **2000 ms, as shipped** | 8, 8, 8, 9 (**8.25**) | the yellow bag |
| 3000 ms, three captures | 5, 4, 4 (**4.3**) | the Oreo, cauliflower, baguette and Granny Smith bag |

**The shipped value is a peak, not a default nobody checked.** The mechanism is geometric rather
than statistical: captures spread across a pan see different parts of the trolley, and captures
crowded together see the same part twice. Halving the interval does not buy more of the cart, it
buys the same view again while the camera has barely moved, and the products at the far end of the
pan are never reached. Tripling it spends too few looks to cover the trolley at all.

So the census budget being half unspent is not waste. It is the pacing refusing to spend calls on
views it already has.

That closes the last constant this corpus can speak to. Every threshold in the recognition path
has now been either measured to a value or confirmed at the one it already had:
`PAIRED_PRODUCE_SHARPNESS` twice on two paths, `PRODUCE_INSIDE`, `NMS_IOU` and the group-box rules
through the IMG_0254 work, `CENSUS_LONG_EDGE`, the census model, and now `minIntervalMs`.

## Forty-second: what the device detector is still for, now that the census does not use it

Routing the census through `onCapture` changed what `AppleInstanceMaskDetector` is *for*. It no
longer badges anything: the service enumerates the regions the census sees. Its only remaining
jobs are triggering the keyframe gate, which counts confirmed tracks, and carrying tracks between
captures. That raises a question this file never had to ask before — whether its single blob
around the whole pile is now merely useless, or actively polluting the tracker.

`scan-loop.ts --device-regions=N` answers it. Two runs each through the app's real loop:

| device regions per frame | products found, lenient | strict |
|---|---|---|
| **1, which is what the device gives** | 8, 8 of 9 | 7, 7 |
| 3 | 8, 8 of 9 | 7, 8 |
| 5 | 8, 7 of 9 | **5, 5** |

Neutral at best, and strict identification degrades at five. The blob is not polluting anything,
and a better on-device detector would buy nothing.

**That is worth more than it looks.** `docs/detector-decision.md` spent a long investigation on
what could replace this detector: SAM2.1-tiny at 6x to 30x the frame budget, EdgeSAM behind a
non-commercial licence, FastSAM relicensed to AGPL, EdgeTAM cleared on licence and then measured
at 23x cost for 24 objects with a Core ML export that cannot track at all. Its closing section
names RF-DETR-Seg and single-class objectness fine-tuning on SKU-110K as "the long-term path, if
training is ever on the table".

Once the census is badged from the service, that path is no longer on the critical route to
recognition quality. The device needs to know only that something is in the cart, well enough to
fire a keyframe and hold a track for two seconds, and one blob does that. Whatever is spent next
on this product, it should not be an on-device segmenter.

## Forty-third: a component the harness was leaving out

`onCapture` ends in `resolveUncertain`, which crops each amber track and asks `runIdentify` for a
closer look. `scan-loop.ts` stubbed that call to fail, so **every scan figure measured through it,
including the ones this file used to justify pointing `scan.tsx` at the capture path, came from a
loop missing a real component.**

Wired to the shipped `runIdentify`, which does its own cropping when given a box exactly as the
service does. Four runs:

| | identify calls | products found, lenient |
|---|---|---|
| identify stubbed out, as measured before | 0 | 8, 8, 8, 9 (8.25) |
| identify running | 1, 3, 1, 1 | **9**, 8, 8, 8 (8.25) |

It fires one to three times a session and the aggregate does not move. So the conclusions drawn
from the earlier runs stand, and the instrument now exercises the path the app actually takes
rather than three quarters of it. Run 1 produced a complete bag, nine of nine.

Worth stating plainly because it is the second time today a harness proved to be measuring
something other than what it claimed: the first was every scan number being taken on a region
supply the app does not have. Both were found by reading code rather than by any result looking
wrong. A number that agrees with expectation is not evidence the thing producing it is connected.

## Forty-fourth: the corpus cannot exercise the system's best channel

`scan-loop.ts` stubs `lookupBarcode` to null and never hands the loop a barcode. That looked like
the same kind of fidelity gap as the stubbed identify, and a worse one, because a barcode identity
is ground truth: `applyCensus` protects it outright, a later census guess cannot overwrite it, and
it keys the count on the UPC rather than on words.

It is not a gap here, and the reason matters more than the stub.

Decoded twice, the second time with the app's own detector:

| decoder | images | decoded |
|---|---|---|
| OpenCV `BarcodeDetector`, video frames | 26 | **0** |
| OpenCV, photographs at 5712 by 4284 | 10 | **0** |
| OpenCV, the same downscaled toward keyframe size | 10 | **0** |
| **Apple `VNDetectBarcodesRequest`, everything** | **40** | **0** |

The last row settles it. That is the exact request `KartVisionFrameProcessorPlugin.readBarcodes`
makes, and `ENABLE_BARCODE_FAST_PATH` is true, so the app really does ask for barcodes on every
frame. Vision is markedly better at this than OpenCV and finds nothing either. Not one barcode,
anywhere, by either decoder. The barcodes are physically present, `#4079` is legible by eye on the
cauliflower wrapper, but none is flat, square-on and unoccluded enough to decode. A trolley is a
pile: labels face the sides, the bottom, and each other.

**So every number in this file measures the system with its most reliable channel switched off.**
That is not a flaw in the measurements, it is a fact about photographing a loaded trolley from
above, and the pipeline is built for exactly that: `unmarkedItems`, the catalog shortlist and the
census exist because the barcode usually is not readable. But it does bound what this corpus can
say. A shopper who holds an item up to the camera gets a UPC and a certain answer, and nothing
here measures that path, in either direction.

It also confirms the stub is faithful rather than convenient: wiring a real barcode decoder into
`scan-loop.ts` would return nothing on all 26 frames and change no figure in this file.

## Forty-fifth: a shipped blur gate calibrated against the wrong measurement

`MIN_KEYFRAME_SHARPNESS` is 12, and its docstring calls it load-bearing: with the motion ceiling
relaxed it is "the only blur test left". It decides which frames are worth one of the session's
eight censuses.

It is on the wrong scale, and on a phone it rejects nothing.

The docstring's own justification gives it away: "it rejects 1 frame of 26, where the frames it
keeps have a median sharpness of 90". Ninety is `score_video.py`'s number, the variance of the
Laplacian over the **whole frame**. `FrameMetrics.sharpness` does not compute that. It takes a
3 by 3 grid of 128-pixel tiles and returns the **largest** tile's variance, which is a different
measure of a different thing. Compiled and run over the same 26 corpus frames:

| | min | median | max |
|---|---|---|---|
| whole frame, what the 12 was set against | 10 | 90 | 392 |
| **max tile, what the device actually sends** | **25** | **295** | **854** |

Every frame's device reading is above the floor, including the one the eval rejects. The gate is
inert on the shipped path.

**Not corrected here, deliberately.** Those figures come from JPEG frames decoded to grey, while
the device measures the camera's own YUV luma plane, and raising the floor on an approximation
risks starving a session of its eight censuses, which is worse than passing a blurry frame. It
needs one reading from a real phone. Recorded at the constant and spawned as a task.

It is worth noting what did **not** go wrong. `PAIRED_PRODUCE_SHARPNESS`, the produce-pass rule
this file fitted at 700, is computed server-side by `regions.sharpness` on the received image with
the same whole-frame measure it was fitted on, so it is consistent and unaffected. Two sharpness
scales exist in this system and only one of the two thresholds is on the right one.

**The motion gate was checked for the same fault and does not have it.** `MAX_KEYFRAME_MOTION` is
0.15, and the two sides really do measure the same thing: `score_video.py` takes the mean absolute
difference over the full-resolution frame, `FrameMetrics` takes it over a 96-pixel nearest-
neighbour subsample. Subsampling picks pixels rather than averaging them, so the scale survives,
and on the same frame pairs the two agree to within half a percent:

| frame pair | device-style subsample | full resolution |
|---|---|---|
| 002 | 0.1524 | 0.1510 |
| 003 | 0.1513 | 0.1524 |
| 007 | 0.1827 | 0.1828 |
| 013 | 0.1647 | 0.1635 |

So the sharpness mismatch is specific, not a symptom of the eval and the device disagreeing
generally. It comes from one measure being a maximum over tiles and the other a mean over the
frame, which no amount of care with resolution would reconcile.

## Forty-sixth: the harness now sends what the device sends

Three ways `scan-loop.ts` differed from the app have been closed, and it is worth listing them
together because two of the three were invisible until someone read the code rather than the
numbers.

| difference | what it was | outcome |
|---|---|---|
| the crop identify | `requestIdentify` stubbed to fail, so `resolveUncertain` never ran | wired to the shipped `runIdentify`; it fires 1 to 3 times a session, aggregate unchanged |
| barcodes | `lookupBarcode` stubbed, no barcode ever handed to the loop | faithful: Apple's own `VNDetectBarcodesRequest` decodes 0 of 40 corpus images |
| the image itself | the frame read from disk at 1080 by 1920 | now encoded as `KartImageTools` does, 1536 long edge at JPEG quality 0.85 |

The last one mattered least and was worth checking anyway. The device downscales and re-encodes
before uploading, so the service composites a frame that has been through JPEG twice, and a second
compression is exactly what softens the small print a brand reading depends on. Measured:

| | products found, lenient |
|---|---|
| frames read raw, as measured before | 8, 8 of 9 (8.0) |
| encoded as the device sends them | 8, 8, **9** of 9 (8.3) |

No cost, slightly better if anything, comfortably inside the run-to-run spread. So every earlier
figure stands and the harness now differs from the app in nothing this corpus can detect.

`keyframeMaxEdge` is 1536 and `CENSUS_LONG_EDGE` is 1536, which is the one place two constants on
either side of the network turned out to already agree.

## Forty-seventh: re-validating the day's biggest change on the corrected instrument

`scan.tsx` was pointed at the capture path on the strength of `scan-loop.ts`, and three defects
have since been found in that harness: the crop identify stubbed to fail, the image passed raw
instead of encoded as the device sends it, and a contents scorer blind to quantity. A decision that
large deserves re-measuring on the instrument as it now stands rather than as it was.

It holds, by a wider margin than it was made on:

| | units against 9 real | products found, lenient |
|---|---|---|
| `onKeyframe`, badged from the device detector | 17, 17, 15 (**16.3**) | 7, 7, 6 (**6.67 of 9**) |
| `onCapture`, badged from the service's regions | 12, 9, 10 (**10.3**) | 8, 8, 9 (**8.33 of 9**) |

Six units closer to the truth and one and two thirds more products found, on a harness that now
runs the crop identify, sends the image the device would send, and counts units rather than lines.

Two things worth drawing out. The gap in *products found* is visible here in a way it was not
before, because the old harness never ran `resolveUncertain`: the closer look helps the capture
path, which has real per-item regions to crop, and cannot help the other, whose single blob has
nothing worth cropping. And the shipped path's bags are not merely larger but flatter, 17 lines for
9 products, because with one badge almost everything arrives as free text through `unmarkedItems`.

**The correction to make explicitly**: the figures in the thirty-sixth section, 19, 15, 15 against
11, 11, 12, were measured on the flawed harness. They pointed the right way and the decision they
supported was right, but the numbers themselves are superseded by the table above.

## Forty-eighth: how much of the photograph result survives to the app

The photographs are 5712 by 4284 and sharp. The app never has such an image. `KartImageTools`
takes a 1080 by 1920 video frame, resizes to 1536 and encodes at JPEG quality 0.85, so the service
composites something already compressed once, from a source with motion blur in it. That makes
every photograph figure in this file an upper bound rather than a description of the app, and
`census-live.ts --as-keyframe` measures how much of the gap the encoding alone accounts for.

Same model, same three passes, the only difference being the encode:

| | full-resolution source | encoded as the app sends |
|---|---|---|
| badge alignment | 65 of 75 (86.7%) | 65 of 75 (86.7%) |
| photographs exact | 15 of 18 | 13 of 18 |
| products found, strict | 70 of 93 | 68 of 93 |
| products found, lenient | **79 of 93** | **72 of 93** |
| lines matching nothing real | 10 | 6 |

**Eight points of recall, for the encode alone.** Badge alignment is untouched, which fits: a badge
is a large drawn numeral and survives compression, while the small print that separates one brand
from another does not. Note also that spurious lines fall from 10 to 6: the model is not confused
by the compressed image, it simply finds less in it, real and invented alike.

And this is only half the degradation. The app's source is a video frame with motion blur, not a
still, and that is on top of the encoding measured here. So the honest reading of the photograph
figures elsewhere in this file is: they bound what the census can do on a good image of this
trolley, and the app gets meaningfully less than that.

### A note on how this was found

The first run of `--as-keyframe` reported badge alignment collapsing from 86.7% to **20%**. That
was not the encoding: `sharp` does not apply EXIF orientation unless asked, so the re-encode left
an orientation-6 photograph unrotated while stripping the tag, and `compositeMarks` then drew
badges on an image a quarter turn from the one the marks described. The same EXIF fault this
corpus opened with, reintroduced by the tool built to measure it. A 20% result was too large to be
the thing under test, which is the only reason it was caught.

## Forty-ninth: the encoding loss is resolution, not compression

The previous section measured the app's keyframe encode costing recall, and the obvious lever is
the quality constant: `KartImageTools.encodeKeyframe` uses JPEG 0.85, and raising it costs only
bandwidth. Three passes each:

| keyframe JPEG quality | products found, lenient | photographs exact | lines matching nothing |
|---|---|---|---|
| **85, as shipped** | 74 of 93 | 12 of 18 | 10 |
| 95 | 77 of 93 | 14 of 18 | 9 |
| 100 | 76 of 93 | 12 of 18 | 8 |

A spread of three, and not monotonic. That was three passes, which is the sample size that
produced a false positive earlier in this file, so it was taken to nine before being believed:

| | products found, lenient, three rounds of three | photographs exact |
|---|---|---|
| **quality 85, as shipped** | 74, 79, 72 (**mean 75.0**) | 37 of 54 |
| quality 95 | 77, 72, 75 (**mean 74.7**) | 38 of 54 |

Indistinguishable. The apparent advantage at three passes was noise, and quality 85 stays.
**Compression is not what costs the recall.**

Which leaves the downscale. The photographs are 5712 across and the keyframe is 1536, a 3.7-times
linear reduction, and that is where the small print goes. The forty-eighth section's figure should
therefore be read as five to seven points rather than a firm eight, and attributed to resolution.

There is no lever there either, and this file already established why: `CENSUS_LONG_EDGE` was
swept at 1024, 1536 and 2048, and 2048 was **worse** on every measure but one. So the census does
not want the pixels back even when they are available. Sending a larger keyframe would cost
bandwidth to hand the census something it was measured to do worse with.

That is the same shape as every other refusal here, arrived at from a new direction: the loss is
real, its cause is understood, and the two ways to undo it both make things worse.

## Fiftieth: more closer looks make the bag worse

Wiring the crop identify into `scan-loop.ts` made one more constant testable. `resolveUncertain`
only crops tracks below `GREEN_CONFIDENCE`, which is 0.55, and this file already measured that the
census overstates its confidence: 9 wrong regions of 69 with only 4 flagged. So the closer look
should be under-firing on items that are wrong, and raising the bar should buy resolution.

`MAX_IDENTIFY_CALLS_PER_SESSION` is 6 and identify fires one to three times, so the budget is not
what limits it. The threshold is. Two runs at each:

| `GREEN_CONFIDENCE` | identify calls | products found, lenient |
|---|---|---|
| **0.55, as shipped** | 2, 3 | 9, 8 (**8.5 of 9**) |
| 0.75 | 5, 0 | 8, 8 (8.0) |
| 0.90 | 2, 6 | 7, 8 (7.5) |

Monotonically worse, and the mechanism is in the design rather than in the numbers. An identify
result is `verifiedByIdentify`, which `applyCensus` protects: a later census guess cannot overwrite
it outright. So every extra closer look is another chance to replace a correct census answer with
a worse one **and then defend it**. The protection that makes identify valuable when it is right
is what makes it costly when it is wrong.

That is the sixth constant confirmed at the value it already had, and the eighth measurement in
this file to find that giving the pipeline more to do costs accuracy. The under-firing is real, and
the fix for it is not "fire more"; it is confidence that means something, which is capability 4 and
still does not work.

## Fifty-first: a correction to the pattern this file keeps claiming

Eight measurements here end the same way, and the summary of them has been drifting toward "more
is worse, full stop". That generalisation is too broad, and the cheapest way to test it was to go
the other way on the one dimension where "less" had never been re-measured.

`CENSUS_LONG_EDGE` was swept at 1024, 1536 and 2048 long ago, but against the old rule 12, when
`unmarkedItems` came back empty at every resolution and the sweep could only report zeroes. 2048
was re-tested on the current pipeline and lost. 1024 never was. Two rounds of three:

| long edge | badge alignment | products found, lenient |
|---|---|---|
| 1024 | 64, 63 of 75 | 71, 66 (**68.5**) |
| **1536, as shipped** | 67, 66 of 75 | 80, 77 (**78.5**) |
| 2048 | 210 of 250 across two rounds | worse on four measures of five |

Ten points worse at 1024, and badge alignment falls too, which is the tell: at 1024 the drawn
numerals themselves start to suffer.

**So the pattern is not "less is better".** 1536 is a genuine optimum with both neighbours worse.
What the eight results actually share is narrower and worth stating precisely: **giving the census
more to weigh or say costs accuracy on what it was already doing.** More regions, more prompts, a
larger model on a fused scan, a fuller non-product rule, more captures, more closer looks. Every
one of those adds work or candidates. Resolution does not: it changes how well the census can see
one fixed thing, and there it has a peak rather than a slope.

The distinction matters for anyone tuning this next. Reaching for a bigger prompt or an extra pass
is reaching in the direction that has failed eight times. Reaching for a sharper image is not the
same move, and is already at its best value.

## Fifty-second: the motion ceiling, the last constant

`MAX_KEYFRAME_MOTION` is 0.15. The forty-fifth section confirmed the device and the eval compute
motion on the same scale, but not that 0.15 is the right number on it. Two runs each:

| ceiling | censuses fired, of a budget of 8 | products found, lenient |
|---|---|---|
| 0.10 | **2** | 5, 5 of 9 |
| **0.15, as shipped** | 4 | 8, 8 of 9 |
| 0.30 | 4 | 8, 9 of 9 |

Tightening to 0.10 blocks half the session's captures and costs three products. Loosening to 0.30
changes nothing at all, because `minIntervalMs` binds first: at two seconds apart only four
keyframes fit in nine seconds however still the camera is.

So 0.15 sits just past the edge of where it matters, with headroom above it that the pacing makes
unusable. That is a comfortable place for a threshold to be. It also confirms what its docstring
claims after being relaxed from a stricter value: motion is no longer the binding blur test, which
is precisely why `MIN_KEYFRAME_SHARPNESS` became load-bearing, and why that one being on the wrong
scale (forty-fifth section) matters.

### The sweep is complete

Every constant on the recognition path has now been measured on the current pipeline or confirmed
at the value it had:

| constant | outcome |
|---|---|
| `PAIRED_PRODUCE_SHARPNESS` | confirmed twice, on two different paths |
| `CENSUS_LONG_EDGE` | peak at 1536; 1024 and 2048 both worse |
| `MODELS.census` | mini; the split by path removed when it became degenerate |
| `minIntervalMs` | peak at 2000; 1000 and 3000 both worse |
| `MAX_KEYFRAME_MOTION` | confirmed at 0.15 |
| `GREEN_CONFIDENCE` | confirmed at 0.55; raising it makes the bag worse |
| `MAX_IDENTIFY_CALLS_PER_SESSION` | non-binding, identify fires 1 to 3 times of 6 |
| device regions per frame | 1 is as good as 3 or 5 |
| keyframe JPEG quality | no effect, settled at nine passes |
| `MIN_KEYFRAME_SHARPNESS` | **on the wrong scale**, inert on device, spawned as a task |

One of ten is wrong, and it is the one this corpus cannot fix, because setting it needs a reading
from a real camera rather than from JPEG frames decoded to grey.

## Fifty-third: what this corpus cannot answer, collected

Scattered through this file are limits found one at a time, several of them only today. Together
they bound every figure here, and they are worth reading before any of the numbers.

**No barcode decodes anywhere in it.** Not one, in 26 video frames or 10 photographs, by OpenCV or
by Apple's own `VNDetectBarcodesRequest`, which is the request the app makes. A barcode identity is
ground truth and `applyCensus` protects it outright. So every figure here measures the system with
its most reliable channel switched off, not by a bug but because a trolley is a pile and labels
face the sides, the bottom and each other. A shopper who lifts an item toward the camera gets a
certain answer, and nothing here measures that path in either direction.

**Nine seconds is half a session, and that turns out not to matter.**
`MAX_CENSUS_CALLS_PER_SESSION` is 8 and this video fires 4, because `minIntervalMs` spaces them two
seconds apart. This section first claimed a longer scan would probably do better and that the
corpus could not show by how much. That was a guess, and it was wrong. Replaying the sequence as
one continuous session (`--loops=2`) is a fair stand-in for a shopper panning over the trolley
twice, and it spends more of the budget with captures spread rather than crowded:

| | censuses fired | products found, lenient | units against 9 |
|---|---|---|---|
| one pass, nine seconds | 4 | 9, 8 of 9 | 13, 9 |
| two passes, eighteen seconds | 6 | 9, 8 of 9 | **15, 10** |

The same products, and more lines. The trolley is static: a second pass sees what the first saw
and describes it in new words, which do not join. So the unspent half of the budget is not
withheld value, and the pattern this file keeps finding holds here too.

**The photographs are an upper bound, not a description.** They are 5712 across and sharp; the app
composites a 1536-pixel JPEG re-encoded from a motion-blurred video frame. The encode alone costs
five to seven points of recall (forty-eighth), and the video source costs more on top.

**Nothing has faced a live camera.** The frame loop is verified in Node and the app is verified to
build, launch and render, on a simulator that has no camera device. Untested: the camera driving
the loop, outlines redrawing from a capture's tracks, and whether coverage, amber and thumbnails
read sensibly when tracks refresh on captures rather than every frame.

**One trolley, one shop, one phone, one lighting.** Sixteen items is the largest cart here and a
weekly shop is several times that. The misses already concentrate on items lying under other
items, which is the thing that gets worse with volume.

None of this makes the numbers wrong. It makes them narrow, and the direction of the narrowness is
knowable: the barcode channel and the longer session both point the same way, so the app in a shop
is more likely to be better than these figures than worse.

## Fifty-fourth: four photographs nothing had ever looked at

Ten photographs, and six of them have been measured to death in this file. The other four —
IMG_0247, IMG_0248, IMG_0250, IMG_0251 — are the supermarket shelves this trolley was filled from,
and **nothing had ever run the census on them.** `score_kart.py` measures only detection there,
because they carry no hand count, and `census-live.ts` skips any frame without one. They sat in
the corpus all along as the one thing it holds that is not a cart.

That makes them the negative case, and the pipeline fails it completely:

| | badges | called a product | refused | units it would put in the bag |
|---|---|---|---|---|
| IMG_0247 | 24 | **24** | **0** | 15 |
| IMG_0248 | 20 | **20** | **0** | 15 |
| IMG_0250 | 43 | **43** | **0** | 41 |
| IMG_0251 | 15 | **15** | **0** | 14 |

**Not one badge refused across 102, on four photographs containing no cart at all.** IMG_0250's
own occlusion note describes the refrigerated display as "the cart shelves", so the model is not
distinguishing the two and being lenient, it is not distinguishing them.

Rule 13 already asks for the opposite, in as many words: "Count only what is inside the cart:
shelves, displays, other shoppers' carts, the floor and anything held in a hand are not in this
cart and must not be counted, marked, or listed as unmarked." The instruction exists and is
ignored.

**Why this outranks the yellow produce bag.** Every residual this file has chased is a missing
item, and a shopper can see that something is absent. This is the opposite failure: it invents
purchases. A shopper who raises the phone above the trolley, or leaves the scan open walking down
an aisle, gets up to 41 items added that they are not buying, silently, with confident names.

Not fixed here, and the reason is on the record rather than convenient: the obvious repair is a
stronger rule 13, and this file contains eight measurements of what happens when the census is
given more to weigh, including one where extending rule 8 cost seven exact passes of sixty. A fix
needs to be a gate rather than a paragraph, and it needs re-measuring against the trolley corpus,
not just the shelves. `shelf-census.ts` reproduces it and there is a spawned task.

## Fifty-fifth: the shelf failure, fixed

The fifty-fourth found the census filling a bag from a supermarket shelf: 102 of 102 badges called
products across four photographs containing no cart, up to 41 invented items. It was reported and
not fixed, on the grounds that the obvious repair is a longer rule 13 and this file holds eight
measurements of what more prompt costs.

The repair that is not a longer rule works. The model is not unable to tell a cart from a shelf; it
is not being asked. Rule 13 asks it *per badge*, buried among the counting instructions. Asked
once, about the photograph, as a single boolean:

| | `subjectIsCart` |
|---|---|
| IMG_0247, 0248, 0250, 0251, the shelves | **false, all four** |
| IMG_0244, 0245, 0246, 0249, 0252, 0254, the trolleys | **true, all six** |

**Ten out of ten.** One field, five lines of prompt, no per-badge judgement changed.

### What it costs

Four rounds of three passes on the trolley corpus, against three baseline rounds:

| | products found, lenient | photographs exact | badge alignment |
|---|---|---|---|
| before | 79, 80, 77 (**78.7**) | 15, 13, 13 | 67, 66 of 75 |
| with the field | 74, 75, 76, 77 (**75.5**) | 13, 13, 15, 13 | 67, 65 of 75 |

About three points of products found, which is the size of this measure's own run-to-run spread,
and exact and alignment unchanged. Taken, and the reasoning is not close: every other residual in
this file is a *missing* item, which a shopper can see is absent, and this is the one failure that
*invents* purchases. Three points of recall against up to 41 phantom items is not a trade that
needs deliberating.

### Where the gate lives

In `normalizeCensusResponse`, which empties `marks`, `unmarkedItems` and `inViewCounts` when the
answer is false. Server-side and at one point, so a client too old to know the field exists is
covered too. `occlusion` survives, since it describes the photograph rather than the goods, and an
absent field reads as a cart, which is what every caller assumed before it existed. Four tests pin
the gate rather than the model.

Measured end to end afterwards: all four shelves now yield a bag of **0 units on 0 lines**, and the
scan is unchanged.

## Fifty-sixth: the cart question costs what it costs

The shelf gate cost about three points of products found, and the first version of it was five
lines dropped in as "0." between rules 7 and 8, so the numbered list ran 1 to 7, then 0, then 8.
Two plausible reasons for the cost had nothing to do with the question itself: the disordered
numbering, and the length. Both were worth removing before accepting the price.

Moved to the top, where its own "judge the photograph, not the badges" instruction actually comes
first, and cut from five lines to four:

| | products found, lenient | mean | badge alignment |
|---|---|---|---|
| no field at all | 79, 80, 77 | **78.7** | 67, 66 of 75 |
| five lines, between rules 7 and 8 | 74, 75, 76, 77 | 75.5 | 67, 65 of 75 |
| four lines, at the top | 72, 75, 79 | **75.3** | 67, 67, 68 of 75 |

Identical, and discrimination stayed at ten of ten. **The three points are the cost of asking the
question, not of how it is asked**, which is the same finding as every other prompt change in this
file and this time it was worth confirming rather than assuming, because a cheaper version of a
fix worth keeping would have been worth having.

The tightened version stays anyway: the ordering is coherent, badge alignment is a shade better
across three rounds rather than worse, and a rule labelled 0 sitting between 7 and 8 was a thing
for a future reader to trip over.
