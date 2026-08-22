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
real `RecognitionSession`, the shipped `runCensus` and the shipped `runIdentify`. Only the
transport is stubbed, and the enumerator, replaced by this video's cached region column.

| | units, nine real products | products found | lines matching nothing real |
|---|---|---|---|
| as it was this morning | 19, 15, 15 (**16.3**) | 6.67 of 9 | five descriptions of one lot of greens |
| **as it ships now** | 8, 8, 10, 9, 9, 8 (**8.67**) | **8.17 of 9** | **0.33** |

The bag went from about seventeen lines to about nine for a nine-product trolley, and almost
nothing in it is invented any more. The single repeatable miss is the yellow produce bag, explained
in the sixty-fifth section and priced in the sixty-sixth: its only isolating proposal is on frame
order 15, the loop censuses orders 6, 12, 18 and 24, and the gate rule that reaches it costs a third
of the pan.

**Current state, all four requirements, measured.** Everything below is re-measured on the code as
it stands. One command runs it:

    server/.venv/bin/python server/eval/verify.py            # local checks, no key, no cost
    server/.venv/bin/python server/eval/verify.py --model    # adds the two that call OpenAI

The `--model` form probes for credit with a single blank-image census first, so an empty account
costs one call and reports SKIPPED rather than a run of failures that then have to be told apart
from real zeros. As of the last run the account is empty, so the two model checks have not been
taken since the sixty-seventh section's figures were measured.

| `CLAUDE.md` requirement | where it stands |
|---|---|
| 1 every item reaches the bag | photographs **76 of 93** products over three passes, video **8 of 9**; detector reaches 19 of 20 readable products on the two loaded trolleys and isolates 13 (11 before the hundred-and-eighth corrected a misplaced label) |
| 2 quantities are right | 85 units against 93 real on the photographs; the scan bag holds 8.17 against 9 |
| 3 hidden items are flagged | first measured in the seventy-fifth, 5 of 6 by a local 7B; the shipped census's own field is still unrun for want of credit |
| 4 unsure items are flagged | first measured in the eightieth: a wrong answer is 7x likelier to be flagged than a right one, and 7 of 9 errors are still asserted unflagged |

**One change is ready and switched off.** `MIN_CATALOG_CONFIDENCE` in `server/src/enumerate.ts`
drops a proposal the catalog cannot place before it becomes a badge. Measured through a local census
it cuts invented lines from 13 to 10 and lifts exact photographs from 4 of 6 to 5, replicates on a
second census model, and is near-inert on the video, so the scan path carries little risk either way
(ninety-eighth). It stays at 0 until `gpt-5.4-mini` has been asked, which needs credit.

**Three alternatives were researched and refused with numbers**, so nobody spends the day again: a
better detector (MM Grounding DINO wins on boxes, loses on the bag), the best benchmark score
(LLMDet, worst here), and a different census (the shipped model beats the best local one 20 to 18,
and the larger `gpt-5.4` was already worse on a scan). **The shipped configuration sits between
measured alternatives on every axis tried.**

**The residual is explained, and it is two things rather than a diffuse gap.** Eight of the ten
photographs are already perfect and repeatable (eighty-seventh); the whole of it is IMG_0252,
IMG_0254 and the video.

- **The yellow produce bag**, missed in all three, is one root cause failing at five layers:
  rarely proposed, so never tracked, so fewer than `MIN_REFERENCES` crops exist, so it has no
  catalog SKU, so the shortlist offers `purple_produce_bag` instead, so a good crop is named
  wrongly. Five sections each found one layer and treated it as the fix. It was one thing
  (ninety-first). Not fixable on this corpus; in a deployment the store's catalog would carry it.
- **IMG_0254 is 40% catalogued** against IMG_0252's 89%, because the catalog is built from the
  video and the video films IMG_0252's trolley (ninety-second). That is why two loaded trolleys
  score so differently, and it is not the density problem that the seventieth through
  eighty-eighth spent their effort on.

**Two constants are inert**, `MIN_KEYFRAME_SHARPNESS` at 12 and `GREEN_CONFIDENCE` at 0.55. Both
were set against one distribution and deployed against another, both behave exactly as if absent,
and neither breaks a test. The first needs a reading from a real camera; the second is documented
as inert in the eighty-first, where raising it measured worse.

**What is still blocked and on whom.** Credit on any Responses-API endpoint, and a phone over a
real trolley. Neither is a code change, and the pending work is listed in order, with what each
outcome would mean, in **`WHEN-CREDIT-RETURNS.md`** beside this file — read that rather than
searching four thousand lines for the open threads.

### A photograph that is not a cart

Four of the ten photographs are the shelves this trolley was filled from, and nothing had censused
them until the fifty-fourth section. They produced 15, 15, 41 and 14 units of goods a shopper is
not buying. They now produce **0 units on 0 lines**, all four.

### The six photographs, one census call each

This is the per-call quality of any single capture, on the server's regions, and it is a bound on
the app rather than a description of it: the app composites a 1536-pixel JPEG re-encoded from a
motion-blurred video frame, which costs five to seven points on its own.

| | |
|---|---|
| exact on every pass | **IMG_0244, IMG_0245, IMG_0246, IMG_0249** |
| products found | 75.0 of 93 allowing words this trolley shares between two products |
| badge alignment | about 67 of 75 |

### What ships

The EXIF fixes, without which `runIdentify` had never once run on a real phone photograph; the
plural fold in `productKey`; the SKU alias; the `sharedNames` fold; the sharpness-conditioned
produce pass; **`scan.tsx` calling `onCapture`**, so the census is badged from the service's regions
rather than from a device detector that returns one outline around the whole pile; **the cart
question**, which stops a shelf filling a bag; and **`CensusRequest.counted`**, which tells each
census the names the session already has so it reuses a phrasing instead of inventing a third.

### What is left

| fault | every fix tried, and refused with a number |
|---|---|
| the yellow produce bag unseen | **explained rather than open** (sixty-fifth): its only isolating proposal is on order 15, and the loop censuses orders 6, 12, 18, 24. Five prompt sets, three detector settings, server-side enumeration and paired produce on three pipelines all failed because none of them changes which frames are censused; no pacing that keeps four captures reaches order 15. The sixty-sixth then reaches it with a different gate rule and measures the price: 3 of 6 recoveries for 1.17 products lost |
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

Identical, and discrimination stayed at ten of ten. **The cost is in asking the question, not in
how it is asked**, which is the same finding as every other prompt change in this file and this
time it was worth confirming rather than assuming, because a cheaper version of a fix worth
keeping would have been worth having.

### And the cost is larger than "about three points"

Three rounds against three is the evidence this file has refused to act on all day, so the
comparison was taken to six each, with the field actually removed for the baseline rather than
assumed absent:

| | products found, lenient, six rounds | mean |
|---|---|---|
| field removed | 79, 80, 77, 81, 81, 77 | **79.2** |
| the cart question | 72, 75, 79, 72, 77, 75 | **75.0** |

**4.2 points, about 3.3 standard errors.** Real, not noise, and larger than the earlier figure.
The decision is unchanged and not close: four points of recall against a bag that can be filled
with up to 41 items the shopper is not buying. But the price is now stated correctly.

A near miss worth recording. The first attempt at this baseline ran `git stash push` on three
files that were already committed, so nothing was stashed, the "baseline" rounds ran with the
field still in place, and they returned 72, 77 and 75 — which would have made the cost look like
zero and the fix look free. The stash pop failing with "No stash entries found" is the only reason
it was checked.

The tightened version stays anyway: the ordering is coherent, badge alignment is a shade better
across three rounds rather than worse, and a rule labelled 0 sitting between 7 and 8 was a thing
for a future reader to trip over.

## Fifty-seventh: the shelf gate is free on the path the app takes

The cart question costs 4.2 points of products found on single photographs, measured at six rounds
each. That number was worth correcting upward and is worth putting in its place: **the app is not a
photograph.** It is a scan that fuses four censuses, and a product one call misses another finds.

Same corpus, same harness, the only difference being the field:

| | products found, lenient | units against 9 |
|---|---|---|
| with the cart question | 8, 8, 9 (**8.33 of 9**) | 8, 12, 10 (10.0) |
| without it | 9, 8, 8 (**8.33 of 9**) | 11, 9, 10 (10.0) |

Identical on both measures. **Fusion absorbs the whole per-call loss.**

That is the reading to keep. Four points off a single census is real and was measured properly, and
it does not reach the bag, because the bag is built from four looks and the loss is not the same
four points each time. So the shelf gate prevents up to 41 invented items and costs the shopper
nothing.

It also puts every per-photograph figure in this file in perspective one last time. The photographs
measure one census call on a good image; the product is four calls on worse images, fused. Neither
number substitutes for the other, and where they disagree, as here, the scan is the one that
describes what a shopper gets.

## Fifty-eighth: what fusion absorbs and what it amplifies

Two results in this file look contradictory until they are put side by side.

The shelf gate costs 4.2 points of products found on a single photograph and **nothing at all** on
the scan. A larger census model, gpt-5.4, *gains* on a single photograph — 49 of 60 passes exact
against 44, and 282 of 310 products found against 258 — and loses badly on the scan, 11.7 units
against 9.7 on nine real products.

Same pipeline, opposite directions. The rule that resolves it:

> **Fusion absorbs a missed product and amplifies an extra description.**

A product one census misses, another finds: the bag is built from four looks and the loss is not
the same loss each time. But a product described in different words each time cannot be joined,
and every call adds another line. So a change that costs recall is cheap, and a change that
increases how much the census volunteers is expensive, however good it looks on one image.

That single rule accounts for most of this file:

| result | which side |
|---|---|
| the shelf gate, 4.2 points of recall per call, free on the scan | absorbed |
| gpt-5.4, better per photograph, worse fused | amplified |
| paired produce prompts, more regions, worse on both paths | amplified |
| the frame catalog offered to the unmarked channel | amplified |
| a second pass over the trolley: same products, more lines | amplified |
| the SKU fold and the `sharedNames` fold, which *undo* amplification | the only wins |

**The practical form, for whoever tunes this next.** Judge a change on `scan-loop.ts`, not on
`census-live.ts`, because the product is a scan. Treat a drop in per-call recall as probably free.
Treat any change that makes the census say *more* as expensive, even when a photograph improves.
And note what the two shipped wins have in common: neither adds anything, both give two existing
descriptions a way to become one.

## Fifty-ninth: the direction the fusion rule points at, and why it is not shipped

If fusion amplifies extra descriptions, and `unmarkedItems` is where the unjoinable ones come from,
then the prediction is specific: let the first census of a session sweep the trolley and let the
rest correct only their badges. `scan-loop.ts --sweep-once` does that. Six runs:

| | units against 9 | lines | products found | spurious lines |
|---|---|---|---|---|
| as it ships | 8, 12, 10, 11, 9, 10 (10.0) | 8 to 11 | 8.33 of 9 | about 1.7 |
| sweep once | 8, 8, 8, 8, 9, 8 (**8.17**) | **8, every run** | 8.0 of 9 | **0** |

The prediction holds, and the shape of the win is better than the totals suggest. The sweep-once
bag contains **nothing invented**: eight lines, eight real products, no phantoms, and the same bag
every run. The shipped path carries about two invented lines and varies by four units. It trades
a third of a product for the elimination of both the duplicates and the variance.

**It is not shipped, for a reason this corpus cannot test.** The nine-second video is a *static*
trolley. This project's own corpus notes say the six photographs are "one trolley being loaded item
by item", which is the real use: a shopper scans while shopping. Under `--sweep-once`, a product
put in the cart after the first census is never swept, because only the first call is allowed to
volunteer anything unbadged, and the device detector that would badge it returns one outline around
the whole pile. **A shopper adding items mid-scan would silently lose them**, and that is the same
class of failure as the shelf bug: the bag disagrees with the trolley and the shopper cannot see
why.

So the honest state is: measured better here, on the one trolley that never changes, and carrying a
named risk on the trolleys that do. What would settle it is a scan of a cart being loaded, which is
a capture, not a code change. Recorded and spawned rather than taken.

A narrower version suggested itself and does not work, which is worth writing down so nobody
spends a day on it. "Sweep what is not already there" — allow `unmarkedItems` on every call but
drop entries duplicating a line already in the bag — **cannot catch anything**, by construction
rather than by measurement. `bagLines` already folds two lines sharing a folded name unless that
name is in `sharedNames`. So every pair of lines that survives into a bag either has different
folded names, in which case an exact-name test does not match them, or has a shared name, in which
case they are two real objects and dropping one would be wrong.

Inspection agrees. A representative bag: `Cadbury Oreo`, `granny smith apples`, `Dave's Killer
Bread Seedtastic Bread`, `brussels sprouts`, `purple produce bag`, `asparagus`, `baguette`,
`Kart Cauliflower`, and one spurious `bag of green vegetables`. The spurious line is a paraphrase
of the greens, not a repeat of any name present. Every duplicate an exact test could find has
already been folded before the bag is built.

So the remaining duplicates are paraphrases, which is where this file has been three times: the
name fold, the SKU fold and the overlap fold were each refused on measurement, and a substring fold
was measured wrong twice as often as right because this trolley holds two bags of apples. The
suppression above works because it does not try to *recognise* a duplicate at all; it removes the
opportunity to create one. That is why the only untested question left is whether it can be done
without losing an item added mid-scan.

One variant of that was checked and does not work. The appealing idea is to allow a later sweep
only when the tracker has *gained* tracks, on the reasoning that an item put in the cart shows up
as a new object: that would degrade to sweep-once on a static trolley and to full sweeping on a
loading one, which is exactly the safety property needed. The signal does not carry that meaning.
Track counts going into the four captures of this static trolley are **1, 8, 5, 3** — they rise as
captures seed tracks and fall as the camera pans away and tracks age out. The count measures what
is currently *visible*, not what is newly *present*. A shopper adding an item while the camera
looks elsewhere would not raise it, and panning back over goods already counted would. Whatever
settles this needs a scan of a cart being loaded, not a cleverer reading of the signals in a scan
of one that is not.

## Sixtieth: corroboration, and why every lexical approach here fails

`--sweep-once` works and carries an untestable risk. The safe-looking alternative is the rule
`applyCensus` already applies to a barcode and to an identify-verified identity: admit an unmarked
description only once a second census repeats it. One misread leaves no permanent trace, a
paraphrase is a one-off by nature, and unlike suppression it does not stop later calls sweeping, so
an item added mid-scan is still found one census later. It should be the best of both.

| | units against 9 | products found | spurious lines |
|---|---|---|---|
| as it ships | 10.0 | 8.33 of 9 | about 1.7 |
| `--sweep-once` | 8.17 | **8.0 of 9** | 0 |
| `--corroborate-unmarked` | 7.67 | **7.67 of 9** | 0 |

It removes the spurious lines and takes real products with them. Run 3 lost the Granny Smith apple
bag, a product plainly in the trolley and named on an earlier call.

**The reason is the whole paraphrase problem in one sentence: a real product's description varies
as much as an invented one's.** The same bag arrives as `packaged apples`, then `red apples`, then
`bag of apples`. Requiring a repeat cannot tell that from `bag of green vegetables` appearing once,
because neither repeats. Every lexical test in this file has now failed on the same rock: the name
fold, the SKU fold, the overlap fold, the substring fold, exact-duplicate dropping, and now
corroboration. Six approaches, one cause.

Which is why the only thing that worked does not look at the descriptions at all. `--sweep-once`
never asks whether two descriptions mean one product; it stops the second one being produced.
That is a different kind of answer, and its cost is the risk it carries rather than a wrong merge.

## Sixty-first: telling the census what the session already counted

Six lexical approaches failed because a real product's description varies as much as an invented
one's. The only thing that worked, `--sweep-once`, works by never letting the second description be
produced, and carries a risk this corpus cannot test. That points at a third option: let every call
sweep, but tell it the words the session has already used.

This file lists "the census given its own session's answers" among seven things tried and refused.
That was before the `sharedNames` fold and before `scan.tsx` used the capture path, and it handed
the model its prior *answers*. This hands it the bag's *names*, with the prompt saying in as many
words that the list is not a limit on what to report.

Six runs each through the app's real loop:

| | units against 9 | products found | lines matching nothing real |
|---|---|---|---|
| without | 8, 12, 10, 11, 9, 10 (**10.0**) | 8.33 of 9 | about **1.7** |
| **with** | 8, 8, 10, 9, 9, 8 (**8.67**) | 8.17 of 9 | **0.33** |

Spurious lines fall five-fold, recall is unchanged inside its own spread, and the unit count moves
from one over to a third under. It is the best result on the scan in this file and the first that
does not trade recall for it.

**Why it works when the fusion rule predicts it should not.** Giving the census more to weigh has
cost accuracy eight times here, and this gives it more to read. But it does not add candidates or
ask for more work: it removes a degree of freedom. The model was choosing a phrasing freely on
every call, and free choice on a static trolley is exactly what produces three names for one bag.
Constraining the phrasing is not the same kind of "more" as another prompt, another pass or another
region, and the measurement is what separates them rather than the reasoning.

Shipped: `CensusRequest.counted`, sent by both of the orchestrator's census call sites from
`bagLines`, parsed server-side with the entries bounded and sanitised because the text reaches a
model prompt. An absent list behaves exactly as before, so an older client is unaffected.

### It also repairs the longer-scan result

The fifty-third section measured a second pass over the trolley finding the same products and
adding lines, and concluded the unspent half of the census budget was not withheld value. With the
names sent back, that is much less true:

| two passes, six censuses | lines | units against 9 | products found |
|---|---|---|---|
| without the names | 11, 12 | 11, 12 | 9, 8 of 9 |
| **with them** | **9, 9** | 10, 10 | 8, 8 of 9 |

A second pass used to grow the bag to eleven or twelve lines and now holds it at nine. The extra
looks stop being a liability, which matters because a real scan is longer than nine seconds and
will spend more of the budget than this corpus can.

## Sixty-second: the yellow bag, closed for the last time

Paired produce prompts contain the only detector proposal that isolates the yellow produce bag, and
they were refused twice: once on the tracker-marked path and once on the capture path, both times
because the extra regions produced more descriptions that would not join. The counted names cut
exactly that cost five-fold, which made a third test genuinely justified rather than stubborn.

| | products found, lenient | the yellow bag |
|---|---|---|
| **shipped regions, with counted names** | **8.17 of 9** | missing |
| paired produce, with counted names | 6, 8, 8 (**7.33 of 9**) | **still missing in two runs of three** |

Worse again, and it does not deliver the thing it was tried for. Run 1 lost both apple bags as
well. Three configurations, three refusals, and on the last one the joining problem it was blamed
on had been largely fixed.

That closes the yellow produce bag. The full list of what was tried, across the session: five
prompt sets on the still, three detector settings (shipped, `--tiles 2`, `--threshold 0.20`),
server-side enumeration on the keyframe, capture pacing ruled out by showing the census does see a
frame it is visible in, and paired produce on three pipelines. It is one small bag, side-on to a
larger one of the same kind, in a pile; the detector will not separate it and the census will not
volunteer it.

**What it would take is not on this corpus.** A second angle on that corner of the trolley would
do it, which is a capture rather than a change, and the fifty-third section's other limits point
the same way: no barcode decodes anywhere here, and the app's real sessions are longer than nine
seconds.

One line above is wrong and the sixty-fifth section corrects it. "Capture pacing ruled out by
showing the census does see a frame it is visible in" conflates two things: the census does see a
frame the bag is *visible* in, and it never sees the frame the bag is *proposable* in. Those are
different frames, and the difference is the whole explanation.

## Sixty-third: the two new things, tested against each other

Two changes shipped late in this session and they meet in one request. The cart question refuses a
photograph that is not a trolley. `CensusRequest.counted` sends the names the bag already holds. A
shopper who scans their cart and then pans onto a shelf sends both at once: a shelf image, and a
prompt that says eight grocery products have already been counted in this session.

That is the failure worth checking, because it is the one where the gate matters most and where a
prior list of groceries is most likely to talk the model into calling a display a cart.

| shelf photograph, with a cart's worth of names already counted | `subjectIsCart` | bag |
|---|---|---|
| IMG_0247 | false | **0 units on 0 lines** |
| IMG_0248 | false | **0 units on 0 lines** |
| IMG_0250 | false | **0 units on 0 lines** |
| IMG_0251 | false | **0 units on 0 lines** |

It holds. The names do not soften the judgement, which fits what they are: a list of phrasings to
reuse, not evidence about what is in front of the camera.

The converse needs no separate test. `scan-loop.ts` sends counted names on every census after the
first and still builds bags of eight or nine products, so a trolley keeps registering as a trolley
with the list present. Both directions covered, and the interaction between the day's two shipped
features is measured rather than assumed.

## Sixty-fourth: what happens if the enumerator is down

Pointing `scan.tsx` at the capture path made the app depend on a service it did not depend on
before. With `ENUMERATOR_URL` unset, `enumerateRegions` returns no regions and
`degraded: "no enumerator configured"`, so the census is handed **no badges at all** and the bag
comes entirely through `unmarkedItems`. Before the move, the device still supplied its one blob.
That is a risk introduced by the change and it should not be left to reasoning.

Three runs each, the same corpus and loop:

| | units against 9 | products found |
|---|---|---|
| **as it ships, enumerator reachable** | **8.67** | **8.17 of 9** |
| as it ships, enumerator down | 11.0 | 6.67 of 9 |
| the path it replaced, device badges | 16.3 | 6.67 of 9 |

**Degraded, it matches the path it replaced on products found and produces five fewer lines.** So
the dependency is not a regression: an outage costs a session the improvement, not the baseline. A
deployment that never configures an enumerator is no worse off than it was this morning, and one
that does is better by a product and a half and seven lines.

That is the answer the earlier note in `docs/detector-decision.md` anticipated when it called
enumeration-less operation "a supported degraded mode, reported as `enumeration: degraded`, not a
failure", measured at 72% of hand-labelled units. It is supported here too, and now with a number
against the alternative rather than only against nothing.

## Sixty-fifth: the yellow bag is not unlucky, it is on a frame the scan never looks at

Three sections have now refused the paired produce prompts. The twenty-seventh refused them on
`video-census-live.ts`, the thirty-ninth on `scan-loop.ts`, and both closed by calling the search
space for the yellow produce bag exhausted. Exhausted is a claim about effort. This section
replaces it with a mechanism, and the mechanism turns out to explain all three results at once.

### The untried shape, and why it looked right

Both refusals tested the prompts as an all-or-nothing setting: every frame detected with them. The
fusion rule says that is the expensive way to buy a region. Fusion absorbs a missed product and
amplifies an extra description, so the cauliflower and the Seedtastic loaf that paired regions cost
on a flooded call come back from the calls that are not flooded, while a region that reaches a real
product leaves a line that persists. Flooding **one** call is the shape that asymmetry rewards, and
it is the shape `--sweep-once` already won with.

`scan-loop.ts --pairs=<set>` badges the census from a second region set, on every call or, with
`--pairs-first`, on the first only. Six runs each through the app's real loop, against six runs of
the shipped path measured the same afternoon rather than quoted from an earlier section:

| | units against 9 | products found, lenient | the yellow bag |
|---|---|---|---|
| **as it ships** | 8, 8, 8, 9, 8, 8 (**8.17**) | 8, 8, 8, 9, 7, 8 (**8.0**) | found in **1** of 6 |
| `--pairs --pairs-first` | 8, 10, 10, 11, 10, 9 (**9.67**) | 8, 8, 8, 8, 8, 7 (**7.83**) | found in **0** of 6 |

Worse on both, and worse in exactly the way the fusion rule predicts for the *cost* side: one
flooded call is enough to raise the bag from 8.17 units to 9.67, because the extra descriptions it
produces persist through every later call. The benefit side never arrived at all.

### Why it never arrived, which is the real finding

The loop censuses four frames: orders 6, 12, 18 and 24. The twenty-sixth section located the yellow
bag's best view at **order 15**, and the twenty-seventh found its one isolating proposal there, at
80% yellow. Order 15 is not in that list and never has been.

Measuring the colour of every proposal on the frames the loop actually captures says how far off it
is. The fraction of pixels that are yellow by hue, in the best box of each frame:

| frame | shipped set | with paired prompts |
|---|---|---|
| order 6 | 14% (8 boxes) | 14% (10 boxes) |
| order 12 | 14% (5 boxes) | 14% (10 boxes) |
| order 18 | **21%** (2 boxes) | **21%** (8 boxes) |
| order 24 | 4% (4 boxes) | 4% (4 boxes) |

The paired prompts add regions to the captured frames, nineteen to thirty-two, and do not change
the best yellow box on any of them. The 21% is the Seedtastic loaf, whose labels are yellow. Nothing
on any captured frame is a yellow bag; the 80% proposal is on a frame no census sees.

**That explains all three refusals as one fact.** On `video-census-live.ts`, which censuses every
frame, paired prompts recovered the bag in three runs of six because order 15 is among them. On
`scan-loop.ts`, which censuses four, they recovered it in one of four. Restricted to the first call,
order 6, they recover it never. The prompts were never the variable; which frames get censused was.

This also corrects the sixty-second section, which closed this item by ruling pacing out "by
showing the census does see a frame it is visible in". It does. Order 18 shows the bag. What no
censused frame has is a *proposal* on it, and the sixty-second read visibility as though it settled
proposability. It does not, and that conflation is why three sections looked at prompts.

### Pacing cannot reach it either

If the barrier is which frames are censused, the lever is `minIntervalMs`, and 2500 ms is the value
that would put a capture on order 15. The forty-first section measured 1000, 2000 and 3000 and
found the shipped 2000 a peak; 2500 was the gap in that table. Six runs:

| pacing | captures | products found, lenient |
|---|---|---|
| **2000 ms, as shipped** | 4 | **8.0** of 9 |
| 2500 ms | **2** | 4.83 of 9 |

Two captures, not the three the arithmetic suggests: the keyframe gate also tests motion, and
raising the interval pushes each candidate window into the pan's fast part. So the cliff in that
table is between 2000 and 2500, not between 2000 and 3000, and no pacing that keeps four captures
selects order 15.

That last clause is true of `minIntervalMs` and false in general, which the sixty-sixth section
shows by changing the gate instead of the interval and landing on order 15 with four captures
intact. The conclusion it was supporting survives anyway, for a reason measured there rather than
assumed here.

### What this closes, and what it hands to the phone

The yellow produce bag is not missing because of a threshold, a prompt set, a model or a naming
failure. Every one of those was measured and none of them is the cause. It is missing because its
only isolating proposal lives on a frame that nine seconds of video at 2000 ms pacing never
censuses, and every pacing that would reach it spends captures this clip cannot afford.

That is a prediction rather than a defeat, and it is falsifiable on a phone: a shopper scanning a
real trolley pans for longer than nine seconds, spends more of the eight-call budget, and censuses
frames this clip simply does not contain. `--loops` cannot stand in for that, because replaying the
same twenty-seven frames captures the same views again, which the fifty-third section measured as
the same products on more lines. **The one product this corpus cannot find is the one whose fix
needs a longer scan, not a better rule.**

## Sixty-sixth: the frame that was unreachable, reached, and it still does not pay

The sixty-fifth found the yellow produce bag's only isolating proposal on order 15, a frame the
loop never censuses, and said no pacing that keeps four captures reaches it. That was true of
`minIntervalMs`, the only pacing lever anyone had tried. It is not true of the gate itself.

`evaluateKeyframe` is first-past-the-post: once the interval has elapsed it fires on the next frame
that is sharp enough, still enough and has tracks. Every pacing experiment in this file changed how
*often* it fires. None changed *which frame in the window* it takes, and on this clip that choice is
made badly:

| | motion | sharpness |
|---|---|---|
| order 15, passed over | **0.0477** | **90** |
| order 18, captured instead | 0.108 | 60 |

The frame the loop takes is worse on both signals than one three frames earlier in the same window.
It is taken only for being later.

### The rule, which is causal and shippable

`--best-in-window=motion|sharp` keeps the best frame seen since the last capture and sends that
buffer when the interval elapses, instead of the live frame. No lookahead is involved: a phone can
hold the best keyframe it has already encoded. The cost is a picture up to `minIntervalMs` old, and
a tracker that is current alongside it.

It reaches the frame. `--best-in-window=motion` captures orders 3, 9, **15** and 19 where the
shipped gate captures 6, 12, 18 and 24.

### Six runs of everything, against the same-day baseline

| | products found, lenient | the yellow bag |
|---|---|---|
| **as it ships** | **8.0** of 9 | 1 of 6 |
| `--pairs --pairs-first` | 7.83 | **0** of 6 |
| `--best-in-window=sharp` | 7.67 | 1 of 6 |
| `--best-in-window=motion` | 6.5 | 2 of 6 |
| `--best-in-window=motion --pairs` | 6.83 | **3 of 6** |

The relationship is monotone and it is the answer to the whole question: **every step that finds the
yellow bag more often finds the trolley less well.** The configuration that reaches its frame *and*
gives that frame the prompts that isolate it recovers it in half the runs, three times the shipped
rate, and pays 1.17 products for it, mostly the cauliflower and the Granny Smith bag.

### Why the cost, which the frame lists show outright

| rule | frames captured |
|---|---|
| as it ships | 007, 013, 019, **025** |
| `--best-in-window=sharp` | 004, 009, 018, **025** |
| `--best-in-window=motion` | 004, 010, 016, **020** |

Choosing the stillest frame biases every capture earlier, because the camera is stillest just after
it settles and moves fastest at the end of each sweep. Four captures that all sit early in their
windows cover less of the pan, and the motion rule's last capture is order 19, so the final third of
the trolley is never censused at all. That is the forty-first section's geometric mechanism again,
arriving through a different door: the sharpness criterion keeps order 24 and loses only 0.33
products, the motion criterion drops it and loses 1.5.

### What is now closed

The yellow produce bag is reachable. This section builds the rule that reaches it and measures what
it costs, which is more than it returns, on every one of the four configurations tried. Combined
with the sixty-fifth, the item is no longer a mystery or an exhaustion:

- it is proposable on exactly one frame of twenty-seven, and only under paired produce prompts
- the shipped gate cannot select that frame, and the rule that can costs a third of the pan
- reaching it and prompting for it recovers it in 3 runs of 6, for 1.17 products lost

**The shipped configuration is a peak on this corpus, and this is the fourth lever confirmed to be
at its best rather than merely unexamined.** What would change the arithmetic is not a better rule
but more frames: a longer pan gives a gate that already works more chances to see the corner of the
trolley that this one shows for a single second.

## Sixty-seventh: the photographs re-measured on today's code, and a second census refused

Every photograph figure quoted in this file predates the shelf gate, the counted names and the
thumbnail fold. Re-running the whole corpus live, three passes, on the code as it stands:

| | |
|---|---|
| badge alignment | 66 of 75 (**88.0%**) |
| units in the bag | 85 against 93 |
| photographs exact | 13 of 18 passes |
| products found | 65 of 93 strict, **76 of 93** allowing shared words |
| lines matching nothing real | 8 |

Nothing regressed, and the shape is the one the thirty-first section described: the four sparse
photographs are exact on every pass and the two loaded trolleys carry the entire error.

### One call per photograph is not what the product does

This harness has always scored a single census. A session fires up to
`MAX_CENSUS_CALLS_PER_SESSION` and fuses them, so the photograph figures measure an answer the
product never actually gives. The thirty-first section makes the gap look like the whole residual:
badges are perfectly stable on both loaded trolleys, and *everything* that moves is `unmarkedItems`,
3, 0, 9, 4, 4 across five passes of one fixed photograph. On the draw that came up 9, IMG_0254
reached 15 of 15. A second draw from that channel, folded by the same fusion that absorbs a missed
product and told the names already counted, should be close to free.

`census-live.ts --rounds=N` does exactly that. Three passes of each:

| | products found, lenient | lines matching nothing | units |
|---|---|---|---|
| **one census, as measured** | **76 of 93** | **8** | 85 |
| three censuses, fused | 73 of 93 | **16** | 89 |

Worse on products and twice the spurious lines. The units column moves the right way and is the
column this file already knows to distrust: a right total is not a right bag.

### The split by trolley is the mechanism

| | one census | three censuses |
|---|---|---|
| IMG_0252, 9 products | 8, 8, 9 (**8.33**) | 8, 9, 9 (**8.67**) |
| IMG_0254, 15 products | 10, 11, 9 (**10.0**) | 9, 10, 7 (**8.67**) |

Extra rounds *help* the sparser trolley slightly and cost the fuller one 1.33 products. That is the
fusion rule with a dependence made visible: each round re-describes whatever no badge covers, in
fresh words that will not join, so the amount of unjoinable text a round produces scales with how
much of the frame is unbadged. IMG_0254 has 11 badges over 15 products and the most unbadged
trolley in the corpus, so it pays the most and gains the least.

**A second look is not free, and it gets more expensive the fuller the cart.** That is the same
result `--loops` gave on the video, same products on more lines, reached from the opposite
direction: there the second look was a second pan, here it is a second call on one frame, and both
lose to the single look. One census per view stands.

## Sixty-eighth: a plain-looking bug in the count keys, and fixing it measured worse

IMG_0254 holds two Muenster packs and the second is missing on nearly every pass. The cause looked
mechanical rather than perceptual. `runCensus` warns:

    inViewCounts productKey "::muenster cheese" does not match any mark or unmarked item

while the mark it obviously means is keyed `lucerne::muenster cheese`. `normalizeCensusResponse`
already repairs this, binding a brandless count to the single mark carrying that name, but the
repair is gated on `!entry.productKey.includes("::")`. A key is brandless two ways: `muenster
cheese` with no separator, and `::muenster cheese` with an empty brand. Only the first was covered,
so a count the model deliberately left unbranded was orphaned and its quantity never reached the
bag.

### It is a real inconsistency and the fix is a real regression

Widening the gate to "the brand segment is empty, however it is spelled" is four lines and passes a
unit test that demonstrates the exact IMG_0254 shape. Measured live on the corpus, six passes each,
with the change stashed and the revert verified in the file rather than assumed:

| | products found, lenient | lines matching nothing | badge alignment |
|---|---|---|---|
| **as it ships** | 76, 74 (**75 of 93**) | 8, 8 | 88.0%, 88.0% |
| brandless repair widened | 66, 71 (**68.5 of 93**) | 11, 13 | 86.7%, 85.3% |

Six and a half products worse, and more spurious lines rather than fewer, which is the opposite of
what binding an orphan should do.

### Why the obvious explanation is wrong, and the real one is not established

The first guess was that the orphaned entry used to become its own line and sometimes matched a
`(second)` truth entry by luck. It cannot: `applyCensus` states plainly that "only items the model
explicitly listed as unmarked count here. An inViewCounts entry alone" does not create a line.

The likelier mechanism is that `inViewCounts` is not a quantity field alone. A few lines into
`applyCensus` it is also the **clamp-release** signal: an explicit count for a key releases that
key's previously-merged tracks so they can re-count, deliberately, so a bad earlier clamp can be
revised upward. Binding a count to a mark therefore does not just set a number, it changes which
merged tracks are let go, and this corpus is full of nested boxes that the clamp exists to hold
down. That would explain more lines and worse alignment together.

**It is a hypothesis, and it is not measured.** Separating it needs several more six-pass rounds
than the one product at stake justifies today.

### What is shipped

Nothing. The revert stands, and `recognize.test.ts` now pins the current behaviour with a test
named for what it is, a refusal rather than an endorsement, carrying these numbers and a note not
to "fix" it without re-measuring. This is the third time in this file a change that was obviously
correct on inspection lost to the corpus, and the second where the tidy explanation for the loss
turned out to be impossible on reading the code. **A four-line fix with a passing unit test and a
clear rationale is still a guess until the corpus has seen it.**

## Sixty-ninth: requirement 3 instrumented, unmeasured, and why IMG_0254 is the case for it

`CLAUDE.md` names four separately measurable things and this file has numbers for three. Nothing
here has ever reported the third: **items hidden under other items are flagged as hidden, so the
shopper is asked to move them.**

That is not a gap in the pipeline, which carries the machinery: `occlusion` is a required field of
`censusJsonSchema`, `assessOcclusion` combines it with the geometric covered rule, and guided
capture opens above `OCCLUSION_HIDDEN`. It is a gap in the instrument. `census-live.ts` scored the
bag and the badges and threw the occlusion verdict away.

### Why it matters most on the photograph with the largest residual

IMG_0254 loses five to eight of fifteen products, more than the rest of the corpus put together,
and looking at the photograph says the losses are not scattered. A shopper's woven tote lies across
the middle of the trolley, and the Fuji apple bag and the yellow produce bag lie under it. The
corpus's own count note says so and calls two of the fifteen "judged rather than read".

For those two items a bag that silently omits them is a *worse* answer than one that says it cannot
see them. Requirement 3 is the designed response and this corpus is exactly the case it was written
for. Whether the census actually fires it here is unknown, which is the point of this section.

`census-live.ts` now prints each photograph's verdict and a per-photograph flagged count. It
typechecks and it has not been run: the OpenAI account reached `429 credit_balance_exhausted`
partway through the first pass, so no live figure exists and none is quoted here.

**What to run when the account has credit:**

    node --env-file=server/.env.local server/node_modules/.bin/tsx \
      server/eval/pipeline/census-live.ts --repeat=3

and read the `occlusion flagged N/3` lines. The result that would matter: IMG_0254 flagged on every
pass and the four sparse photographs flagged on none. If IMG_0254 is *not* flagged, then part of
what this file has been counting as a recognition failure is a reporting failure instead, and the
fix is in the prompt rather than the detector.

## Seventieth: box-level truth at last, and what the detector actually reaches on IMG_0254

Every recall claim in this file has been indirect: a product is "found" if a name reaches the bag.
That cannot separate a detector that never proposed an item from a census that saw it and called it
something else. IMG_0254 loses more products than the rest of the corpus together and deserved the
direct measurement, which needs box-level truth this corpus has never had.

`corpus/kart/boxes-IMG_0254.json` is that: fifteen hand-labelled boxes, three marked `judged`
because `counts.json` already records two of the fifteen as "judged rather than read" under the
shopper's tote and a third as "a bagged green, label not legible". `score_boxes.py` scores against
it and needs **no model and no API credit**, which is why it exists.

It reports two things deliberately, and the gap between them is the finding:

- **reached** — some proposal covers most of the item
- **isolated** — some proposal covers most of it *without* also swallowing another labelled item

| | with judged | readable only |
|---|---|---|
| reached | 13 of 15 | **11 of 12** |
| isolated | 6 of 15 | **5 of 12** |

**The detector reaches almost everything and isolates less than half of it.** Eleven of twelve
readable products have a proposal over them, so this photograph's residual is not a detector that
cannot see. Six of those eleven arrive only inside a box that also contains a different product,
and a badge drawn on such a box asks the census about the pair. That is the yellow bag's problem
from the sixty-fifth section, found again on a still, and it is the structural reason IMG_0254
underperforms.

The two genuine misses are the first Muenster pack, whose twin *is* isolated, and the yellow
produce bag, which no proposal reaches on this photograph either.

### It sharpens the sixty-eighth section rather than settling it

The second Muenster is missing from the bag on nearly every pass, and only one of the two packs is
proposed. But the model reported `count: 2` under `::muenster cheese`, so it perceived both, and
the brandless-key gate orphaned that count. **The evidence was real and it was lost**, which means
the intent of that refused fix was right even though shipping it measured 6.5 products worse. The
refusal stands on its numbers; this makes it worth revisiting once the clamp-release interaction is
understood, rather than closed.

### A correction, and a trap worth naming

Every photograph in this corpus is stored 5712x4284 **landscape** with EXIF orientation 6, while
every box in `frames-named.json` is normalised against the **corrected 4284x5712 portrait**. A
reader that opens the JPEG without applying EXIF gets boxes a quarter turn from their objects.

This file made that mistake twice today. The first labelling pass placed all fifteen boxes in
landscape space and `score_boxes.py` duly reported the egg cartons, the baguette, the loaf and the
cauliflower as MISSED, items the census names correctly on every pass. A contradiction that plain
is a broken instrument, not a discovery. Earlier the same day a contact sheet of IMG_0252's badges
was rendered the same wrong way and read as evidence that no badge covers the yellow bag; that
reading is withdrawn, since the crops were a quarter turn out. **Crops of a dense trolley look like
groceries in any orientation, which is exactly why they were believed.** What settled it was
rendering the detector's own proposals and seeing them snap onto objects only after
`ImageOps.exif_transpose`. The label file records the space it is in, in its own `space` field, so
the next reader does not have to rediscover this.

The video work is unaffected: its frames are 1080x1920 with no EXIF tag, stored exactly as the
frame records claim, so the sixty-fifth and sixty-sixth sections stand as measured.

## Seventy-first: the detector threshold, swept on trolley boxes for the first time

The seventieth found IMG_0254's residual is not blindness but **grouping**: the detector reaches
almost every product and isolates less than half of them, and a badge on a box holding two products
asks the census about the pair. Grouping is what a detection threshold controls, and this corpus has
never had the box-level truth to sweep one. It has two now, IMG_0252 and IMG_0254, twenty-four
labelled items of which twenty are readable.

Every setting below was already cached from earlier work and needed no model, no GPU pass and no
API credit to score, which is the whole reason this was reachable with the OpenAI account empty.

| setting | proposals | reached, readable | isolated, readable |
|---|---|---|---|
| threshold 0.28 | 18 | 18 of 20 | 10 of 20 |
| **0.23, as shipped** | 21 | 19 of 20 | 11 of 20 |
| **0.20** | 22 | **20 of 20** | **12 of 20** |
| 0.18 | 24 | 20 of 20 | 12 of 20 |
| 0.15 | 29 | 19 of 20 | 12 of 20 |
| tiles x2 | 45 | 16 of 20 | 9 of 20 |

**0.20 dominates the shipped value on both measures for one extra proposal**, and it is the
efficient point: 0.18 buys nothing more for three more proposals, and by 0.15 recall has started
back down while the count climbs. Tiling is much the worst of the six, which is worth stating
plainly since it doubles the proposal count: tiles cut through objects, and a product split across
two tiles is reached by neither.

### Why this is a candidate and not a change

`BOX_THRESHOLD = 0.23` was not guessed. Its comment records an F1 sweep over **465 instances** of
the grocer corpus, and then says why it stayed: "The threshold stays at 0.23 rather than being
re-tuned, because the corpus that would be doing the tuning is the one that cannot show the failure
being fixed." Trolleys are that other corpus, and this is the first time the trolley side has had
boxes to answer with. Twenty readable products do not overturn 465 instances, but they do say that
on the surface the product actually ships against, 0.20 is free.

**The end-to-end effect is unmeasured and may well be negative.** The one lesson this file has
repeated more than any other is that more regions measures worse once the census sees them: the
paired produce prompts lost three times, `--tiles 2` lost, server-side enumeration on the keyframe
lost. Isolation is a better argument than raw count, because it is precisely the quantity those
experiments were failing on, but an argument is not a measurement and the account has no credit to
take one.

**What to run when it does:**

    # detection at the candidate threshold, then the bag it produces
    server/.venv/bin/python server/eval/score_kart.py --threshold 0.20
    node --env-file=server/.env.local server/node_modules/.bin/tsx \
      server/eval/pipeline/census-live.ts --repeat=3 --frames=frames-t0.20.json

against the 75 of 93 products and 8 spurious lines the sixty-seventh section measured on three
passes of the shipped set. Ship it only if products found rises **and** spurious lines do not.

## Seventy-second: the threshold that helps the photographs does nothing for the video

The seventy-first found threshold 0.20 dominates the shipped 0.23 on trolley photographs. The
obvious next question is whether it reaches the video's one repeatable miss, and it is answerable
locally: detection is a GPU pass over 27 cached frames, and the yellow bag's presence in a box can
be measured by hue without any hand label or any model call.

Detection re-run over the whole video at 0.20 and at 0.15, and the best yellow box on each frame
measured the way the sixty-fifth section measured it:

| frame | shipped 0.23 | 0.20 | 0.15 | paired prompts |
|---|---|---|---|---|
| order 6, censused | 14% (8 boxes) | 14% (8) | 14% (9) | 14% (10) |
| order 12, censused | 14% (5) | 14% (5) | 14% (8) | 14% (10) |
| order 18, censused | 21% (2) | 21% (4) | 21% (9) | 21% (8) |
| order 24, censused | 4% (4) | 7% (7) | 7% (7) | 4% (4) |
| **order 15, never censused** | 15% (3) | 15% (4) | **37% (6)** | **40% (6)** |

**On every frame the loop actually censuses, the best yellow box is identical at every threshold.**
Order 18 goes from two proposals to nine and its most-yellow box does not move off 21%, which is the
Seedtastic loaf's labels. The extra boxes a lower threshold buys are more of the same objects, not
the object that is missing.

The only frame that improves is order 15, which improves a lot, from 15% to 37%, and order 15 is
the frame the sixty-fifth section showed the loop never censuses and the sixty-sixth showed costs a
third of the pan to reach.

### What this closes

The yellow produce bag has now been refused at every layer that could be varied without a phone:

| layer | tried | result |
|---|---|---|
| prompts | grocery, produce single, produce paired, targeted colour | only paired isolates it, only on order 15 |
| detector threshold | 0.28, 0.23, 0.20, 0.18, 0.15 | no change on any censused frame |
| tiling | tiles x2 | worse everywhere |
| census pacing | 1000, 2000, 2500, 3000 ms | 2000 is a peak; nothing reaches order 15 with four captures |
| gate rule | first-eligible vs best-in-window, two criteria | reaches order 15, costs a third of the pan |
| fusion | sweep-once, corroborate, counted names, pairs-first | none of them can add what no census saw |

It is one object that is proposable on one frame in twenty-seven, and that frame is unreachable
without giving up more than the object is worth. **This is the same conclusion the sixty-fifth
reached from the census side, now confirmed from the detector side across four thresholds and two
prompt sets, which is as close to settled as this corpus can make it.**

One thing this does *not* settle: whether 0.20 helps the video's other eight products end to end.
More regions is exactly the change this file has measured as harmful five times, and the account has
no credit to find out. The seventy-first section's shipping rule applies unchanged.

## Seventy-third: four of the ten photographs were never scored at all

Every "photographs" figure in this file, including the sixty-seventh's 75 of 93 measured today,
covers **six of the ten photographs in the corpus**. `census-live.ts` iterates the region set and
skips any frame without a hand count:

    const entry = counted.get(frame.id);
    if (!entry) continue;

and `counts.json` held six entries. IMG_0247, IMG_0248, IMG_0250 and IMG_0251 have been present in
the region set the whole time and scored by nothing.

They are the four store photographs: two of a produce aisle, one of an open meat case, one close in
on packaged poultry. Their absence is not an oversight about labelling difficulty. **Their correct
answer is an empty bag**, because a shelf is not a cart and its hundreds of facings are in nobody's
trolley, and that is exactly what `subjectIsCart` was built to deliver.

### The hole this leaves is a silent one

The shelf gate was measured when it shipped, at 10 of 10 discrimination, in `shelf-census.ts`. But
the corpus's *main* instrument never saw these photographs, so **reverting `subjectIsCart` would
have left every photograph figure in this file unchanged.** A guard that only one purpose-built
harness exercises is a guard that a future change can remove without any number moving, which is
the same failure this file has recorded three times under a different name: measured is not
protected.

### What changed

`counts.json` now carries all ten, the four shelves at `products: 0` with `subject: "shelf"` and a
note saying the zero is a real count rather than a missing label. `census-live.ts` carries an empty
truth array for each, which is truthy, so the contents scorer runs and every line a shelf produces
is counted spurious.

Verified offline, since the OpenAI account has no credit: a synthetic replay of empty censuses over
all ten frames now scores ten photographs where it scored six, the four shelves reading `bag 0
against 0 real` and counting as exact. That exercises the whole scoring path without a model.

**Two figures change denominator and are not comparable across this line.** "Photographs exact" was
out of 6 per pass and is now out of 10, since a shelf answered with an empty bag is an exact answer.
Products found is unaffected at 31 per pass, because the shelves contribute no truth items; only
spurious lines can move. The sixty-seventh's 75 of 93 therefore still stands as the products figure,
and its 13 of 18 exact does not.

### Seventy-first, continued: where 0.20's extra regions actually land

The objection to lowering the threshold is this file's most-repeated result: more regions measures
worse once the census sees them. That objection is about *count*, and counting per photograph shows
the count moves somewhere the isolation table could not reveal.

| image | 0.23 | 0.20 | | |
|---|---|---|---|---|
| IMG_0244 | 2 | 3 | +1 | sparse trolley, exact on every pass |
| IMG_0245 | 1 | 3 | **+2** | sparse trolley, exact on every pass |
| IMG_0246 | 3 | 3 | 0 | sparse trolley |
| IMG_0249 | 3 | 3 | 0 | sparse trolley |
| IMG_0252 | 10 | 8 | **-2** | loaded trolley |
| IMG_0254 | 11 | 14 | +3 | loaded trolley |
| four shelves | 102 | 125 | +23 | gated by `subjectIsCart` |

**The risk is not where the benefit is.** Across the two loaded trolleys the change is +1 region
net, and IMG_0252 actually gets *fewer*, so the isolation gain there comes from better-separated
boxes rather than more of them. The shelves take +23 and it costs nothing, because the shelf gate
empties their bag whatever the badges say. What is left is the sparse trolleys, which take +3
between them and have nothing to gain: they hold one to three products, they are exact on every
pass today, and IMG_0245 triples its proposals on a trolley containing a single cauliflower.

Two extra badges on a nearly empty trolley is the precise shape of every invented-product failure in
this file. So the end-to-end test in the previous section needs a sharper pass condition than
"products found rises and spurious lines do not":

- on IMG_0252 and IMG_0254, products found must rise
- on IMG_0244, IMG_0245, IMG_0246 and IMG_0249, the bag must stay **exact on every pass**, because
  those four are the corpus's only clean cases and a threshold that dirties them is not worth the
  loaded trolleys it helps
- on the four shelves, the bag must stay empty, which now shows up in the main harness

If 0.20 fails only the second condition, the honest reading is that the threshold wants to depend on
how much is in the frame, not that 0.20 is wrong. That would be a new rule and this corpus has six
trolleys to fit it on, which is not enough. Recorded rather than attempted.

## Seventy-fourth: the threshold candidate, measured end to end without a key

The seventy-first held threshold 0.20 as a candidate because its end-to-end effect could not be
measured with the OpenAI account empty. That was wrong about the tools available. `census_local.py`
exists precisely for this: it assembles a census from a local Qwen2-VL asked one crop at a time, and
`local-census-bag.ts` runs the shipped fusion over the result. Neither needs a key.

Both files hardcoded one region set. Both now take `KART_FRAMES`, pairing with the `KART_VLM` and
`KART_CENSUS_OUT` overrides already there, so one region set can be swapped for another and the
same model asked the same questions about each.

| photograph | real | 0.23, as shipped | 0.20 |
|---|---|---|---|
| IMG_0244 | 1 | **1** | 2 |
| IMG_0245 | 1 | **1** | 2 |
| IMG_0246 | 2 | **2** | **2** |
| IMG_0249 | 3 | 4 | 4 |
| IMG_0252 | 9 | 10 | **9** |
| IMG_0254 | 15 | 16 | 18 |
| **units** | **31** | **34** | 37 |
| **exact** | | **3 of 6** | 2 of 6 |

**The prediction from the region counts holds exactly.** Both sparse trolleys that were exact break,
each gaining a unit, because the extra proposal on a nearly empty trolley is called a product: the
crop-level log shows IMG_0244 going from 2 of 2 regions called products to 3 of 3. IMG_0254 takes
the worst of it at +3. And IMG_0252 becomes **exact**, the one photograph where better-separated
boxes were the whole point.

So the three-part pass condition written one section ago is answered, and 0.20 fails part two. It is
refused, not held.

### What it is evidence for

The split is not noise, it is the density story the region counts already told: 0.20 helps the
trolley with ten products and hurts the trolleys with one. **A threshold that depended on how much
is in the frame would take both wins**, and this is now the second independent measurement pointing
at that rule. It is still not buildable here, because six trolleys is not a corpus to fit a
density curve on, and a rule fitted on the same six that judged it would be worth nothing.

### The caveat, which is real

This is a 2B local model, not the gpt-5.4-mini the product ships. Its absolute numbers are worse and
it may be more suggestible than the shipped model about calling an extra crop a product, which is
exactly the mechanism under test. What the comparison holds still is everything else: same model,
same three questions, same fusion, same truth, only the region set differs. **A clean A/B on a
smaller model is weaker evidence than a clean A/B on the shipped one and much stronger than no
measurement**, which is what this candidate had before.

When the account has credit, the seventy-first's command still deserves running, if only to see
whether the larger model resists the extra badge that the 2B one accepts. The prediction on record
is that it will not: this file has measured "more regions is worse" five times on the shipped model
and now a sixth time on a local one.

## Seventy-fifth: requirement 3 gets its first number, and it is not zero

`CLAUDE.md` names four separately measurable things. Three have had numbers in this file for weeks.
The third, **items hidden under other items are flagged as hidden, so the shopper is asked to move
them**, has never had one. The sixty-ninth instrumented it and could not run it. It can be run
locally after all, the same way the seventy-fourth ran the threshold candidate.

### The geometric half cannot answer it, structurally

`covered()` measures how much of a *detected* box is hidden by other *detected* boxes. It protects
an item the detector found that something else sits on top of. It is unable, by construction, to
report the case this corpus actually turns on: the Fuji and yellow produce bags under the shopper's
tote on IMG_0254 are never detected, so there is no subject box to score and nothing to flag. **For
an item that is hidden badly enough to defeat the detector, the census's `occlusion.itemsLikelyHidden`
is the only channel that exists.** That is worth stating plainly, because the geometric rule is the
half with a threshold and an audit, and it is the half that cannot help here.

### Asked of a local model, one question per photograph

`occlusion_local.py` asks each photograph whether any item is hidden underneath or behind another.
The expected answers come from the corpus, not from me: `counts.json` records the tote across
IMG_0254 and, for IMG_0252, that "the tomatoes and the yellow bag drew nothing; both sit behind and
under the purple bag".

| model | four sparse trolleys | IMG_0252 | IMG_0254 | four shelves | score |
|---|---|---|---|---|---|
| Qwen2.5-VL-3B | clear, clear, clear, clear | clear | clear | all clear | 4 of 6 |
| **Qwen2.5-VL-7B, 4-bit** | clear, clear, clear, clear | clear | **HIDDEN** | all clear | **5 of 6** |

**The 3B's 4 of 6 is a degenerate answer and must not be read as partial success.** It says no to
every photograph in the corpus, and scores four because two thirds of the scorable set are
negatives. A constant answer is what this file's scoring standard exists to catch.

The 7B is not degenerate. It flags the one photograph with something lying across the trolley, keeps
all four sparse trolleys clear, and keeps all four shelves clear, so the question does not simply
leak "yes" on a crowded picture. Its miss is IMG_0252, where the occlusion is one produce bag partly
behind another rather than a tote over the whole basket, which is the harder case and the one the
corpus itself hedges on.

### What this is worth

It does not report what the service answers: different model, different prompt, no severity and no
reason. What it establishes is the prior question, and the answer is the useful one. **The signal is
present in the photograph and a 7B model reads it**, so the shipped census, which is larger and has
a purpose-written occlusion field with severity and reason, is more likely working than not. Before
this the honest position was that requirement 3 might be silently dead on this corpus and nobody
could tell.

It also repeats a pattern this file already recorded on badge alignment, where a 2B model put all
three answers on the wrong badge: **on this task, capability is the variable, not prompting.** The
same question, unchanged, goes from useless to 5 of 6 between 3B and 7B.

The sixty-ninth's command still deserves running when the account has credit, and now with a
concrete expectation to check it against rather than an open question.

## Seventy-sixth: the grouping is in the detector, and no rule around it can undo that

The seventieth named grouping as the dominant failure on loaded trolleys: 11 of 20 readable
products isolated, the rest reached only inside a box that also holds another product. Three
candidate fixes existed. All three are now closed, two of them by construction rather than by
measurement, which is cheaper and more final.

### `degroup` cannot fire, at any setting

`degroup` drops a box that contains `GROUP_MEMBERS` other *proposals* at `GROUP_CONTAINMENT`. The
six boxes doing the swallowing contain, at 0.90 containment, **zero** other proposals. At 0.70 the
best of them contains one.

| | products it swallows | proposals inside, 0.90 | at 0.70 |
|---|---|---|---|
| IMG_0252 box 5 | baguette, yellow bag | 0 | 0 |
| IMG_0252 box 7 | Fuji bag, yellow bag | 0 | 0 |
| IMG_0254 box 2 | egg carton, beef pack | 0 | 0 |
| IMG_0254 box 6 | egg carton, Muenster | 0 | 1 |
| IMG_0254 box 7 | baguette, jar, Fuji bag | 0 | 1 |
| IMG_0254 box 8 | salmon, broccoli | 0 | 0 |

`GROUP_MEMBERS` is 5 and lowering it is pointless: **even at one, there is nothing inside these
boxes to count.** The rule exists to delete a proposal whose parts were separately found, and here
the parts were never found. Its own comment already refused 3 members for costing 6.7 points on
sparse photographs, "the ones most like a cart", which is the same sparse-trolley cost that refused
the threshold candidate two sections ago. It is the right rule for whole-trolley boxes and it has
nothing to say about pairs.

### Looking closer at the same region does not separate it either

That leaves the idea `--tiles 2` was reaching for and got wrong. Tiling cuts a fixed grid through
the frame, so a product straddling a tile edge is reached by neither, which is why it measured
worst of six. Re-detecting **inside each proposal** has no such edge, because the crop is drawn on
an object boundary the detector itself chose. The parts do appear: four of the six swallowing boxes
yield two or more children on re-detection, IMG_0254's baguette-jar-Fuji box yielding five.

| | proposals | reached, readable | isolated, readable |
|---|---|---|---|
| shipped | 21 | 19 of 20 | **11 of 20** |
| re-detect inside every proposal | **47** | 19 of 20 | **11 of 20** |

**More than double the proposals and not one product better separated.** The children are sub-parts,
a label or a corner of the thing already found, not the neighbouring product. Nothing about looking
closer at a region makes the detector see two objects where it saw one.

### What that leaves

The isolation ceiling on this corpus is a property of what Grounding DINO proposes on a loaded
trolley, not of the rules around it. Threshold moves the count without moving isolation and breaks
the sparse trolleys; tiling is worse; `degroup` cannot engage; per-proposal re-detection buys
nothing. Improving it means a different proposal source, which is a model change and not a
configuration one.

This is the same shape as the yellow bag's ending, reached on a different corpus and a different
layer. **Both residuals are the detector's, and both were being chased in the rules.**

## Seventy-seventh: the residual is not all the detector's, and the previous section overclaimed

The seventy-sixth ended "both residuals are the detector's, and both were being chased in the
rules." Testing that against the shipped model's own answers says it is half right, and the half it
gets wrong is the tractable half.

If isolation were the binding constraint, every isolated product would reach the bag. Taking the
four products IMG_0254 missed on a measured pass and asking what the detector actually gave the
census for each:

| missing product | what the detector gave | what the census said | cause |
|---|---|---|---|
| yellow produce bag | nothing, no box reaches it | nothing | **detection** |
| broccoli | box 8, 61% of it but 98% of the salmon | "kroger alaskan sockeye salmon" | **grouping** |
| Muenster cheese (second) | box 9, **isolated**, 78% of it, 27% of another | "kirkland signature cheese slices" | **naming** |
| asparagus bag | box 10, **isolated**, 67% of it, 28% of another | "vegetables" | **naming** |

**Two of the four are isolated, badged, and simply misnamed.** The census was handed a clean crop of
each and answered with a category instead of a product. Badge 9 at full size reads `MUENSTER
deli-sliced cheese, HAPPY FARMS, ALDI` in large type, so this is not a legibility limit either: the
word is printed plainly on the pack and the answer invented a different brand.

That is a different problem from grouping, it lives in a different component, and the seventy-sixth
was wrong to fold it in.

### A corpus label was hiding one of them

`query-labels.json` called IMG_0254 badge 10 a `purple_produce_bag`. The crop is green stalks in
plastic filling the frame with a sliver of purple wrapper at one edge, which is what the original
reading caught. It is the asparagus bag, and the hand-labelled box in `boxes-IMG_0254.json` says so
independently, having been placed before the badge label was ever looked at.

The label is corrected, and **the correction is score-neutral on every pass observed**: the census
called this badge "vegetables", "bagged produce" or "vegetable tray", and none of those matches
either label's word set, so alignment reads the same before and after. That is worth stating because
a truth edit that improves a score is the one edit this file must never make. This one changes only
the attribution: with the wrong label the asparagus miss reads as a detector failure, and it is not
one.

### What it means for where the work is

The residual on the corpus's hardest photograph splits four ways and only one quarter is the
detector failing to see. Of the rest, one is grouping, which the seventy-sixth closed properly, and
**two are the census naming a clean crop wrongly**, which nothing in this file has attacked because
until there were boxes to check against, an isolated-but-misnamed product and a never-detected one
looked identical from the bag.

Both misnamed items are `out_of_catalog`, meaning the evaluation index has no SKU for them and the
badge carried no shortlist. `CLAUDE.md`'s closed-world assumption says the deployment does have one:
"the catalog is the complete set of things that can possibly be in the cart", and open-world numbers
"understate what the shipped product will do". So the honest reading of these two is that they are
measured in a world the product does not ship into. Testing that needs the two SKUs added to the
index and the pass re-run, which is a build plus a census pass, and the account has no credit.

## Seventy-eighth: the catalog is not the bottleneck, and the previous section got one of two wrong

The seventy-seventh said both of IMG_0254's misnamed products were `out_of_catalog`, so both were
artifacts of an evaluation catalog thinner than the one the product ships against. Checking the
shortlist each badge actually carried says that is true of one and false of the other.

| badge | what the shortlist offered | what the census said |
|---|---|---|
| 9, Muenster | `CheeseSlices`, Weikfield, `CheeseCubes`, Pulses, Cookies | "kirkland signature cheese slices" |
| 10, asparagus | kart_brussels_sprouts, **`kart_asparagus`**, kart_seedtastic_bread, … | "vegetables" |

Badge 9 behaves exactly as the closed-world argument predicts: the index has no Muenster, its
nearest entry is a generic `CheeseSlices`, and the census dutifully answered cheese slices. Give
that deployment the store's own catalog and the right name is on offer.

**Badge 10 is the opposite and the seventy-seventh was wrong about it.** Its label was
`purple_produce_bag`, not `out_of_catalog`, and `kart_asparagus` sat at rank 2 of the five
candidates the service attached. The right SKU was offered and the census said "vegetables".

### Measured across the corpus, the matcher is nearly perfect

`score_shortlist.py` scores the first clause of `CLAUDE.md`'s closed-world instruction, "is the
correct SKU in the top-k shortlist", which is a property of the matcher and the index and needs no
model:

| | |
|---|---|
| correct SKU in the top-5 shortlist | **21 of 22 (95%)** |
| correct SKU at rank 1 | 19 of 22 (86%) |

Its one miss is IMG_0252 badge 8, the close-up of a single red apple through plastic, which is the
badge the census called "truffle".

**So the catalog half of the closed world is working and the residual is not there.** That is worth
having as a number rather than an assumption, because five sections of this file have reasoned about
what the shipped deployment's catalog would do without ever checking what this one does.

### What it moves, and what it does not

The two clauses have to be reported apart, because from the bag they look identical: a product
missing because the matcher never offered its SKU and a product missing because the census was
offered it and said something else are the same empty line. Split here, 95% of the first and a
concrete failure of the second on badge 10.

It does not follow that the census should simply take rank 1. Badge 10's rank 1 is
`kart_brussels_sprouts`, which is wrong, so a resolver that trusted the top candidate would swap one
wrong name for another. The honest statement is narrower and still useful: **on this badge the
information needed was present in the request and did not reach the answer.** Whether that
generalises needs the second clause measured over a full pass, which needs credit. `score_shortlist.py`
is committed so the first clause can be re-run after any change to the index or the matcher.

## Seventy-ninth: does the shortlist help, and would readable names help more

The seventy-eighth left the second clause of the closed-world instruction open: the correct SKU is
in the shortlist 95% of the time, and on at least one badge the census was offered it and answered
with a category anyway. Whether the offer helps at all is an A/B, and it runs on a local model.

`shortlist_ab.py` asks the same crop three ways, on the same 7B, over the 22 labelled badges of the
six trolleys:

| | named correctly |
|---|---|
| no shortlist | 17 of 22 |
| **shortlist as raw SKUs, which is what ships** | **19 of 22** |
| shortlist as readable names | 20 of 22 |

**The shortlist earns its place.** Offering it recovers two badges of five that free naming gets
wrong, with nothing lost, and the recoveries are not marginal: one crop goes from "reduced fat
mayonnaise" to baguette and another from "cherry tomatoes" to the purple produce bag.

### The change I expected to matter mostly does not

`censusUserText` prints candidates as bare SKUs, `kart_asparagus`, `CheeseSlices`, `Tata_Agni`, and
that looked like the reason a model might disregard them. Measured, showing readable names instead
is worth **one badge in twenty-two**. That is not a change to make on this evidence, and the
hypothesis that the shipped format was the problem is wrong: the format captures most of the
available benefit already.

Two caveats keep this honest. The SKU arm is scored leniently, because an answer of
`kart_baguette` contains "baguette" and counts as correct, where the shipped pipeline would put the
SKU in `catalogSku` and a product name in `name`. And 22 badges cannot separate a one-badge
difference from noise.

### What it leaves

Even with the shortlist offered, two of twenty-two stay wrong on the local model, and the shipped
census misses badges whose correct SKU was on offer. So the second clause is not simply "the census
ignores the catalog": the catalog is consulted, it helps, and a residual survives it. That residual
is the census reading a crop, and nothing measured here so far moves it.

The prompt is not the lever it looked like one section ago. Recorded so the next person does not
spend the same afternoon on `censusUserText`.

## Eightieth: requirement 4 measured, and one command that runs all four

`CLAUDE.md` names four measurable things. Three had numbers. The fourth, **items the system is
unsure about are flagged as unsure, not asserted confidently**, had none, and it turned out to need
no new model call at all: `census-live.ts` already saves every census response it receives,
including each mark's `confidence` and `needsCloserLook`, beside the per-badge verdict of whether
that mark named its badge correctly. Calibration is the join of those two.

`score_confidence.py`, over the 18 photograph-passes of the last live run:

| | n | mean confidence | `needsCloserLook` |
|---|---|---|---|
| named its badge **right** | 66 | 0.96 | 2 of 66 (3%) |
| named its badge **wrong** | 9 | 0.89 | 2 of 9 (**22%**) |

**The signal is real and it is weak.** A wrong answer is seven times more likely to be flagged than
a right one, and confidence runs 0.06 lower when the census is wrong, so the amber path is not being
driven by noise. But 0.89 is a confident number in absolute terms, and **seven of nine wrong answers
were asserted with no flag at all.** For the shopper that is the difference between "check this one"
and a wrong line they have to notice themselves.

That is the first honest statement this file can make about requirement 4, and it is the one metric
here that a change could move without touching detection or naming at all: nothing about being
better calibrated requires being more accurate.

### One entry point

These measurements grew one per question and ended up scattered across a dozen files with different
flags, which is how the four shelf photographs went unscored for weeks. `verify.py` runs them in
order and prints a single report:

    server/.venv/bin/python server/eval/verify.py            # local checks only
    server/.venv/bin/python server/eval/verify.py --model    # add the ones that cost money

Two rules it follows. Anything it cannot run prints **SKIPPED with the reason**, never nothing,
because a check that quietly does not run reads exactly like a check that passed. And `ran` means
the check produced numbers, not that the numbers are good: this file is still where the numbers are
judged.

It also pins the occlusion check to the 7B. The 2B and 3B answer "no" to every photograph in the
corpus, which scores 4 of 6 on a set that is two thirds negative, and a default that reports a
degenerate answer as a passing grade is worse than no default.

With this, the local half of all four requirements runs in one command, and the two model checks
name their own price.

## Eighty-first: the calibration lever, opened and closed in one section

The eightieth called requirement 4 "the one metric a change could move without touching detection
or naming". Looking at what drives it says that is true of the requirement and false of the lever.

An item goes amber when `identity.needsCloserLook || identity.confidence < GREEN_CONFIDENCE`, and
`GREEN_CONFIDENCE` is **0.55**. The census's confidences on this corpus run from 0.56 to 0.99, and
**not one mark in 75 falls below 0.55**, right or wrong. So the threshold contributes nothing and
amber is decided entirely by `needsCloserLook`, which fires on 2 of 9 wrong answers.

**That is the second inert constant this file has found**, after `MIN_KEYFRAME_SHARPNESS` at 12
against a device that reports hundreds. Both were set against one distribution and are deployed
against another, and in both cases the inertness is invisible from the outcome: the pipeline behaves
exactly as if the rule were absent, and no test fails.

### Raising it does not work either, and the distributions say why

| threshold | wrong flagged | right flagged, the cost |
|---|---|---|
| **0.55, as shipped** | 2 of 9 (22%) | 2 of 66 (3%) |
| 0.90 | 2 of 9 (22%) | 4 of 66 (6%) |
| 0.95 | 3 of 9 (33%) | 14 of 66 (21%) |
| 0.96 | 5 of 9 (56%) | 19 of 66 (29%) |
| 0.98 | 8 of 9 (89%) | 34 of 66 (52%) |

Wrong answers sit at 0.56, 0.77, 0.92, 0.95, 0.95, 0.96, 0.96, 0.97, 0.98. Right answers sit
between 0.62 and 0.99 with 43 of 66 at 0.97 or above. **The two distributions overlap almost
completely in the region that matters**, so there is no threshold that catches most of the errors
without flagging a quarter to a half of the correct answers with them.

Everything up to 0.90 is free and buys nothing: the flags it adds land only on right answers. The
first threshold that catches a third of the errors costs a fifth of the correct ones.

### What that means for the requirement

Requirement 4's weakness is in the model's calibration, not in the constant reading it. A 0.06 mean
gap with this much overlap is a signal you can measure and cannot act on, and raising
`GREEN_CONFIDENCE` would trade a quiet failure for a noisy one: more amber items, more identify
calls, and this file has already recorded identify overwriting two censuses that agreed.

So the constant stays at 0.55, now documented as inert rather than assumed to be working, which is
the whole difference between the two states. Moving requirement 4 needs a confidence signal worth
thresholding, which is a model property, and the honest next test is whether the shipped model's
`needsCloserLook` separates better than its `confidence` does on a larger sample than nine errors.

## Eighty-second: the amber lever again, this time measured past the flag

The eighty-first closed the calibration lever by counting flags: raising `GREEN_CONFIDENCE` to 0.96
catches 5 of 9 wrong answers and costs 19 of 66 right ones. That is the cost of *flagging*, and a
flag is not the outcome. An amber item goes to `resolveUncertain`, which crops it and asks again,
and the seventy-ninth measured per-crop naming at 20 of 22. So the question the product faces is the
**net after the second look**, and counting flags cannot answer it. Reopening a conclusion I had
just written.

`amber_net.py` applies each threshold to the confidences of the shipped model, taken from the saved
responses of a live run, and re-asks every badge that goes amber. Only the second look is a
stand-in, a local 7B given the same crop and the same catalog shortlist the service attaches.

| threshold | badges right, before → after | repaired | broken | net |
|---|---|---|---|---|
| **0.55, as shipped** | 60 → **62** | 2 | **0** | **+2** |
| 0.92 | 60 → 60 | 2 | 2 | 0 |
| 0.95 | 60 → 61 | 3 | 2 | +1 |
| 0.96 | 60 → 59 | 3 | 4 | −1 |
| 0.98 | 60 → 57 | 3 | 6 | −3 |

**The shipped value is the peak, and the reason is better than the one the eighty-first gave.** It
is not that raising it costs too many flags. It is that every badge the higher thresholds add is one
where the second look breaks more than it fixes, so the curve turns negative before it catches even
half the errors.

### The useful finding is about which signal to trust

At 0.55 the threshold contributes nothing, so amber is decided entirely by `needsCloserLook`, and
that selection **repairs two badges and breaks none**. The census's own flag is a high-precision,
low-recall signal: it fires on only 2 of 9 errors, and when it fires the second look is right to
run. Its `confidence` number is the opposite, a value with a 0.06 mean gap and almost total overlap,
and every attempt to threshold it lands on badges the second look then gets wrong.

So requirement 4's two channels are not equally good and should not be improved together. **The flag
is worth acting on and the number is not.** That is a more useful statement than "the constant is
inert", and it is the one the eighty-first should have made: `GREEN_CONFIDENCE` at 0.55 is inert,
and the pipeline is better for it, because the signal it would activate is the untrustworthy one.

The stand-in is the caveat. The shipped `runIdentify` is a different model with its own prompt, so
the repaired and broken columns are estimates of a mechanism rather than counts of what the service
would do. What is not an estimate is the shape: three thresholds in a row make it worse, and the
best column is the one already in `config.ts`.

## Eighty-third: a better amber signal exists, and it changes nothing, which is the answer

The eighty-second found the second look repairs badges when correctly targeted and breaks them when
not, so the whole question is the selector. The census's `confidence` is a poor one, +0.06 mean gap
with almost total overlap. There is another already in the request and never tried: **the catalog
matcher's own score**, computed server-side for every badge and attached beside the candidates.

It separates twice as well:

| | mean, right | mean, wrong | gap |
|---|---|---|---|
| census `confidence` | 0.96 | 0.89 | +0.06 |
| **catalog matcher confidence** | **0.886** | **0.765** | **+0.122** |

And it has an operating point the census number never offers. At 0.60 it catches 3 of 9 wrong
occurrences and **0 of 66 right ones**: no correct badge on this corpus scores below 0.60, so those
flags are free.

### Run past the flag, it ties the shipped trigger exactly

| trigger | threshold | right, before → after | repaired | broken | net |
|---|---|---|---|---|---|
| census, as shipped | 0.55 | 60 → 62 | 2 | 0 | **+2** |
| census | 0.96 | 60 → 59 | 3 | 4 | −1 |
| **matcher** | 0.60 | 60 → 62 | 2 | **0** | **+2** |
| **matcher** | 0.70 | 60 → 62 | 2 | **0** | **+2** |
| **matcher** | 0.80 | 60 → 62 | 2 | **0** | **+2** |

The matcher trigger is strictly the safer signal: at 0.80 it flags 15 of 66 correct badges and
breaks **none**, where the census number at 0.96 flags 19 and breaks 4. But it repairs the same two
badges, and so does every setting. **Flagging more finds no more repairs.**

### What that settles about requirement 4

The second look repairs exactly two badges however it is triggered, because the errors it can fix
are the two it already gets. The rest are errors a second look makes too: the Muenster pack whose
SKU the index lacks, and the produce bag the model calls something different every time it is asked.
**The amber path is saturated on this corpus** — not starved, as the inert `GREEN_CONFIDENCE`
suggested three sections ago, but already extracting everything a re-ask can extract.

So there is no change to make, and the reason is worth more than the change would have been. A
better selector was available and measurably better as a selector, and it did not move the outcome,
which says the bottleneck was never selection. Recorded with the matcher signal named, because if
`runIdentify` ever improves, this is the trigger to pair it with: it is free at 0.60 and safe to
0.80, and the census's own confidence is neither.

## Eighty-fourth: the runner caught the instrument, not the pipeline

`verify.py --model` had never been run, and running it once with an empty account was worth doing on
its own: a handoff command that fails on a bad path rather than on credit wastes the first attempt
after a top-up. The census check failed exactly as it should, on the OpenAI error. The scan-loop
check reported **"ran"**.

It had not run. Every census failed, `RecognitionSession` treated each failure as a census that
found nothing, and `scan-loop.ts` printed

    bag holds 0 units on 0 lines, against 9 real products
    products found 0 of 9 ... missing: oreo, cauliflower, asparagus, ...

and **exited 0**. A complete failure of the pipeline is indistinguishable, in that output, from a
scan that genuinely found nothing, and the exit code says everything is fine.

That is the precise failure this file has now recorded three times under different names: the shelf
photographs that were skipped because they had no count, the two inert constants that behave as
though absent, and now a harness that reports catastrophe as a measurement. **It is also the failure
`verify.py` was written to prevent, and `verify.py` fell for it.**

### Both ends fixed

`scan-loop.ts` counts censuses that returned an answer against those that threw, and refuses to
print a bag when none succeeded:

    every census failed (4 of 4 attempted). This is not a result: the bag below would read
    0 of 9 and the process would exit 0, which is indistinguishable from a measured miss.

exiting 1. Treating a failed census as "found nothing" is right for one bad call mid-scan and wrong
as the description of a whole run, and only the run knows the difference.

`verify.py` no longer trusts a zero exit code alone. A check that exits cleanly with an all-zero
result is reported **SUSPECT** rather than "ran", because on this corpus an all-zero result is
almost always a broken run rather than a measured one.

With both, the model tier of the runner now reports two honest FAILEDs against an empty account
instead of one FAILED and one silent lie.

**The lesson is the one this file keeps relearning, applied to itself.** Every measurement here is
only as good as its ability to tell "nothing happened" from "nothing was found", and that
distinction has to be built deliberately, because both look like zero.

## Eighty-fifth: the same fault in the app, where it matters more

The eighty-fourth fixed a harness that reported total failure as a measured zero. The fault is a
class, not an instance, and the place worth checking is the product.

`RecognitionSession` had it, twice. Both census call sites do this on a failed request:

    if (!result.ok) {
      if (result.failure === 'unconfigured') this.permanentlyUnavailable = true;
      return null;                       // and nothing else
    }

A `server`, `offline` or timeout failure returned null and left **no trace at all**. `recordError`
exists and sets `lastError`, but it is only reached from the `catch`, so a call that comes back
`ok: false` rather than throwing never touched it. And `lastError` has **no consumers**: its own
comment says "files it on state so the UI can surface it", and nothing in `src/app` reads it.

So a shopper whose service is down, out of credit or unreachable scans a full trolley, watches it
find nothing, and is told nothing. **An empty bag and a broken scan are the same screen.** That is
the harness bug with a person on the other end of it.

### Fixed at the state layer, and honest about what is left

Both sites now call `recordFailure`, which sets `lastError` to `recognition unavailable (<failure>)`
and increments a new `censusFailures` counter on session state. Three tests cover it: a failure from
`onKeyframe`, a failure from `onCapture`, which is the path the app actually uses, and a healthy
session that must leave the counter at zero.

**The UI half is not done and should not be guessed at.** Surfacing this needs a real decision about
what a shopper sees mid-scan and it needs verifying on a device, which the simulator cannot do
because it has no camera. What the state layer can now support, and could not before, is any of
those choices: the session knows how many censuses failed and why.

This is the fourth appearance in this file of one shape: **something that produces nothing and
something that finds nothing are indistinguishable unless the distinction is built on purpose.**
The shelf photographs were skipped for having no count. Two constants are inert and behave as though
absent. A harness printed zero and exited zero. And the app, where it costs a shopper their trust
rather than an afternoon, did the same and said nothing.

### The sweep, completed

Having found the shape twice, the rest of the harnesses were checked rather than assumed, by running
each against the empty account and reading the exit code:

| | on a census that cannot be answered | |
|---|---|---|
| `census-live.ts` | throws, exits 1 | already correct |
| `video-census-live.ts` | throws, **exits 1** | already correct |
| `shelf-census.ts` | throws, **exits 1** | already correct |
| `scan-loop.ts` | printed `0 of 9`, exited 0 | **fixed, eighty-fourth** |
| `RecognitionSession` | empty bag, no trace | **fixed, eighty-fifth** |
| `verify.py` | reported the above as "ran" | **fixed, eighty-fourth** |

The three that were already right are right by accident rather than by design: they call `runCensus`
directly, so an exception propagates and Node exits non-zero. The two that were wrong both sit
behind something that catches for good reasons — `RecognitionSession` treats a failed census as a
census that found nothing, which is correct for one bad call in a scan and wrong as the description
of a whole run, and `scan-loop.ts` inherits that because it runs the real session.

**That is where this bug lives in general: not in code that forgets to handle an error, but in code
that handles it correctly at one scale and inherits the handling at another.** The fix in both cases
was not to stop catching, it was to count.

### Verified on a simulator, without a camera

The eighty-fifth's notice shipped unverified, because the scan screen needs a camera the simulator
does not have. That was the wrong conclusion: `src/app/dev/frame-lab.tsx` runs the **real**
`RecognitionSession`, `processFrame`, fusion and `CoachNotice` against offline fixtures, and it is
reachable in a Debug build by long-pressing the logo.

It gains a third mode. `Run with recognition offline` answers every census the way a server that is
down, unreachable or out of credit does, and takes the captured detector instances that `replay`
uses, because without tracks nothing is confirmed, no keyframe fires, and the failure it exists to
show could never happen.

| mode | bag | notice |
|---|---|---|
| `Run with recognition offline` | **0 items** | **shown**: "Scanning isn't working right now. Check your connection and try again." |
| `Replay captured Vision output` | **5 items** | **none** |

Both were confirmed by screenshot on a Debug build against a live Metro bundle. The notice is
driven by real session state, not a hard-coded kind: five instances produce tracks, the tracks fire
a keyframe, every census fails, `censusFailures` reaches `censusCalls`, and the notice appears. The
replay run is the control, and it is the state that used to be indistinguishable from the offline
one: five items found and nothing said, against nothing found and nothing said.

One harness-only change came with it. `CoachNotice` now renders after the diagnostics sheet in the
Frame Lab, because that sheet is pinned to the same top offset the notice uses and covered it
exactly. `scan.tsx` has nothing above the notice, so its order is untouched.

## Eighty-sixth: what the pipeline delivers with no API at all

The local census path exists so the bag can be measured without a key, and it had only ever been
run on the 2B. With the account empty and a 7B already loaded for three other measurements, the
obvious question is what the whole pipeline delivers with no OpenAI call in it — which is also the
question "could this ship without the API".

Per photograph, units in the bag against real items:

| photograph | real | local 2B | **local 7B** | shipped gpt-5.4-mini |
|---|---|---|---|---|
| IMG_0244 | 1 | 1 | **1** | |
| IMG_0245 | 1 | 1 | **1** | |
| IMG_0246 | 2 | 2 | **2** | |
| IMG_0249 | 3 | 4 | **3** | |
| IMG_0252 | 9 | 10 | 11 | |
| IMG_0254 | 15 | 16 | 19 | |
| **units, all six** | **31** | 34 | 37 | **28.3** per pass |
| **exact** | | 3 of 6 | **4 of 6** | 4.3 of 6 |

**The 7B is the better local model and still the wrong answer.** It is exact on all four sparse
trolleys where the 2B was not, and it makes the `isProduct` judgement the 2B fails: on IMG_0244 it
calls 1 of 2 regions a product, correctly rejecting the plastic disc moulded into the trolley's
child seat. Then it inflates both loaded trolleys, +2 and +4, and ends further from the truth in
total than the smaller model.

The mechanism is one this file already has a name for. The 7B lists **11** products for IMG_0254's
whole frame where the 2B lists 9: a more capable model sweeps the unmarked channel harder, and on a
dense trolley that produces descriptions that will not join rather than products that were missed.
It is the same result as gpt-5.4 against gpt-5.4-mini in the twenty-second, arriving from two model
generations lower down.

### What it answers

Shipping without the API is not currently a trade between cost and a little accuracy. On the four
sparse trolleys a local 7B is exact and the shipped model is not always; on the two loaded ones,
which are the real use case, it is 6 units worse against a truth of 31. **The value of the shipped
model is concentrated exactly where the product's value is.**

The comparison is not model-for-model, and should not be read as one: the local path asks one crop
at a time and the shipped path asks one composite with numbered badges, so this compares two
pipelines. That is the honest framing, and it is also the useful one, because the per-crop pipeline
is the only one a local model can run at all — the twenty-first measured a 2B putting all three
answers on the wrong badge under set-of-mark.

## Eighty-seventh: where the gap actually is, stated per photograph

"75 of 93 products" is the number this file has quoted, and it hides the thing worth knowing. Per
photograph, three passes of the shipped code:

| photograph | | result |
|---|---|---|
| IMG_0244 | 1 product | **1 of 1, every pass, no spurious line** |
| IMG_0245 | 1 product | **1 of 1, every pass** |
| IMG_0246 | 2 products | **2 of 2, every pass** |
| IMG_0249 | 3 products | **3 of 3, every pass** |
| IMG_0247, 0248, 0250, 0251 | shelves, not carts | **0 units on 0 lines**, which is the right answer |
| IMG_0252 | 9 products | 8 of 9 twice, **9 of 9** once, one spurious line on two passes |
| IMG_0254 | 15 products | 10 or 11 of 15 |
| the video | 9 products | 8 of 9 |

**Eight of the ten photographs are already perfect and repeatable.** Not "close", not "on average":
the same right answer on every pass, with nothing invented. The whole residual is two photographs
and one video.

### And most of that residual is one object

The yellow produce bag is a single physical item that appears in IMG_0252, IMG_0254 and the video,
and is missed in all three. It is one object accounting for three of the corpus's misses, and the
sixty-fifth through sixty-sixth explain it completely: its only isolating detector proposal exists
on one video frame of twenty-seven, which the census never sees, and on the stills it sits behind
and under the purple bag where nothing proposes it at all.

Take that one bag out and the corpus reads: IMG_0252 **9 of 9**, the video **9 of 9**, and IMG_0254
still short by four, which is the density problem the seventieth measured as a detector that reaches
19 of 20 readable products and isolates 11.

**So the honest shape of "not perfect" is one small yellow bag and one very full trolley**, not a
pipeline that is broadly 80% right. The aggregate figure averages four solved photographs and four
correctly-refused shelves together with two open ones, which is exactly the criticism the
thirty-first section made of every "photographs" figure before it, and which this file then went on
to repeat for fifty sections.

### One of the two remaining photographs fails on a crop a 7B reads correctly

Cross-reading two measurements already in this file settles what kind of failure IMG_0254's
asparagus is, without a new run.

The seventy-ninth asked a local 4-bit Qwen2.5-VL-7B to name every labelled badge three ways. On
badge 10, the asparagus bag, it answered:

| | |
|---|---|
| no shortlist | `asparagus spears` |
| shortlist as SKUs, the shipped format | `asparagus` |
| shortlist as readable names | `asparagus` |

Correct in all three arms, including the one with no catalog help at all. The shipped
gpt-5.4-mini, on the same crop with the same shortlist, answered `vegetables`, `bagged produce` and
`vegetable tray` across three passes.

**So this miss is not the prompt, not the format, and not the catalog.** The seventy-eighth already
showed `kart_asparagus` sat at rank 2 of the offered candidates, and the seventy-ninth showed the
format carries most of the benefit it can. A smaller, quantised, locally-run model reads this
particular crop correctly and the shipped one does not.

That is the narrowest true statement about one of the two products separating IMG_0254 from a
perfect answer, and it is not actionable here: changing the census model is a measurement that
needs credit, and this file has already recorded that the larger gpt-5.4 does *worse* on the scan
by sweeping harder. What it does close is a direction — nobody should spend another afternoon on
`censusUserText` for this item.

## Eighty-eighth: the yellow bag is reachable on the stills, and still not worth reaching

The seventy-second closed the yellow produce bag on the video: no detector threshold changes the
best yellow box on any frame the loop censuses. That was measured on the video and quietly assumed
of the stills. It is false of the stills.

Scoring the labelled boxes at each cached threshold, the line that had been MISSED at every setting:

| threshold | IMG_0254, yellow produce bag |
|---|---|
| 0.23, as shipped | MISSED |
| 0.20 | MISSED |
| 0.18 | MISSED |
| **0.15** | **isolated — box 15, 95% of it, 10% of another** |

At 0.15 the detector draws a box that is almost entirely the yellow bag and almost nothing else.
The single most stubborn item in this corpus, missed on both loaded trolleys and the video, refused
at prompts, tiling, pacing, the gate rule and four fusion variants, **is proposable on a still after
all.**

### And the density rule that would exploit it

0.15 cannot ship globally: the seventy-fourth measured 0.20 breaking both sparse trolleys, and 0.15
is further in the same direction. But the seventy-first and seventy-fourth both ended by pointing at
the same unbuilt idea, a threshold that depends on how much is in the frame, and the corpus splits
cleanly: 1 to 3 proposals on the sparse trolleys at 0.23, 10 and 11 on the loaded ones.

So: 0.15 for a frame the shipped pass already found 8 or more regions in, 0.23 otherwise. Sparse
trolleys keep exactly what they have, which removes the failure that refused 0.20.

| | reached, readable | isolated, readable |
|---|---|---|
| shipped | 19 of 20 | 11 of 20 |
| **density-conditional** | 19 of 20 | **12 of 20** |

Better on the metric it was built for. Then, end to end through the local 7B:

| | units against 31 | exact | IMG_0254 alone |
|---|---|---|---|
| shipped regions | **37** | 4 of 6 | 19 against 15 |
| density-conditional | 42 | 4 of 6 | **24 against 15** |

**Five units worse, all of it on the photograph the rule exists to help.** The six extra proposals
IMG_0254 gains do include the one that isolates the yellow bag, and they also include five that
become lines for things already counted or not products at all.

### What this finally settles

Isolation is necessary and not sufficient, and this is the cleanest demonstration in the file.
Every proposal is a badge, every badge is a question, and every question can produce a line. Buying
one correct isolation with six proposals loses on any corpus where the census answers all six.

The yellow produce bag is therefore closed for a second time, on different evidence and with the
opposite finding underneath it: **not unreachable, but unaffordable.** On the video no setting
reaches it; on the stills 0.15 does, and the bag it arrives in is worse than the bag without it.

The density rule is refused with it. The caveat from the seventy-fourth stands unchanged: this is a
local 7B that sweeps hard, and the shipped model might convert those six proposals differently. It
is the sixth measurement in this file pointing the same way, which is the reason to believe it and
also the reason it deserves the credit-backed re-run when there is credit.

## Eighty-ninth: the first clean box on the yellow bag, and the question it opens

The eighty-eighth refused a density rule that swaps a dense frame's whole region set to threshold
0.15, because five of the six proposals it gains are ground the shipped pass already covers, and
each becomes a line. The rule was wrong; the observation under it was not. **Keep the shipped set
and add only what is genuinely new.**

`augment_regions.py` adds a 0.15 proposal to a dense frame only when it overlaps nothing already
there: no IoU above 0.30 with any shipped box, and not sitting inside one past 0.60. Sparse frames
are untouched, which is what the seventy-fourth's failure requires.

| | proposals, the two loaded trolleys | reached, readable | isolated, readable |
|---|---|---|---|
| shipped | 10, 11 | 19 of 20 | 11 of 20 |
| whole set at 0.15 | 12, 17 | 19 of 20 | 12 of 20 |
| **new ground only** | **12, 13** | **20 of 20** | **12 of 20** |

**Every labelled item on both loaded trolleys is now reached**, for two extra proposals each rather
than six, and IMG_0254's yellow produce bag is *isolated*: 95% of it, 10% of anything else. That is
the first clean box any detector setting has ever put on this item on a still.

### The census does not convert it, and that is the open question

End to end through the local 7B, IMG_0254 goes from 19 units to 21 against 15 real, and the two new
badges are named `eggs in carton`, a duplicate of a carton already counted, and **`purple cabbage`**
— which is the box on the yellow bag.

So the detector delivered and the naming failed. On this model, at least. And that matters more
than the unit count, because **the shipped model has never been asked this question**: the
twenty-sixth measured the word "yellow" appearing 0 times in 366 census entries across eighteen scan
runs, and the reason was always that no badge ever landed on it. Now one does.

**This is the one experiment in this file whose input did not exist before**, and it is cheap: one
census on IMG_0254 with `--frames=frames-augment15.json`. Every other refusal here re-ran a question
the corpus had already answered in some form. This one has not been asked.

    server/.venv/bin/python server/eval/augment_regions.py
    node --env-file=server/.env.local server/node_modules/.bin/tsx \
      server/eval/pipeline/census-live.ts --frames=frames-augment15.json --repeat=3

Two outcomes and both are worth having. If gpt-5.4-mini names that box anything matching "yellow"
or "produce bag", the corpus's most stubborn item is solved on the stills and the rule to ship is
narrow and measured. If it answers `purple cabbage` too, then the item is closed for the third and
final time on the strongest possible evidence: a clean, isolated, uncontaminated crop of the object,
handed to the shipped model, and still not named.

**I could not run it. The account has no credit** (`credit-probe.ts` confirms it), and this is the
measurement to spend the first credit on.

## Ninetieth: two corrections and one real finding about the yellow bag

The eighty-ninth called the augmented proposal "the first clean box any detector setting has ever
put on this item". Looking at the crop says that is overstated, and why it scored as clean is worth
more than the claim was.

### The box is not clean, and `score_boxes.py` could not tell

The crop holds the yellow bag, printed `ORGANIC` in white, **and a purple produce bag occupying
more of the frame than the yellow one**, plus part of the baguette and the shopper's tote.
`score_boxes.py` called it isolated because isolated means "covers most of this item without
covering another **labelled** item", and `corpus/kart/boxes-IMG_0254.json` has no purple produce bag
in it: that photograph's truth lists fifteen items and a purple bag is not among them, though one
is plainly visible.

**So the label set is incomplete for IMG_0254, and the isolation figure for any box overlapping that
purple bag is optimistic.** That is a limitation of labels I wrote earlier today, and it means the
seventieth's "isolated 11 of 20" and the eighty-ninth's "12 of 20" are both upper bounds rather than
measurements. The reached figures are unaffected: they ask only whether an item is covered.

### What the crop does establish, which is new and does not depend on the label gap

Asked about that same crop three ways, the local 7B answers:

| the question | the answer |
|---|---|
| no catalog help | **`Organic yellow onion`** |
| the shortlist as this corpus's catalog actually has it | `Purple produce bag` |
| the same shortlist with a yellow produce bag entry added | **`yellow produce bag`** |

Three things follow, and the middle one is the finding.

**The model reads yellow off this crop.** Unprompted it says `Organic yellow onion`: wrong product,
right colour, right that something yellow and bagged is the subject. The twenty-sixth measured the
word "yellow" appearing 0 times in 366 census entries and concluded the model never gets the chance;
given a crop centred on it, it takes the chance immediately.

**The catalog as built makes the answer worse, not better.** The index carries eight `kart_` SKUs
and **no yellow anything** — confirmed directly, nothing in the whole index matches "yellow". Offer
a shortlist whose nearest entry is `purple produce bag` and the model abandons a half-right free
answer for a confidently wrong catalogued one. The seventy-ninth measured the shortlist helping on
average, 17 of 22 to 19; this is the failure mode hiding inside that average, and it fires exactly
on the item the corpus cannot get.

**With the entry a real store would have, it is named correctly.** `CLAUDE.md` states the deployment
assumption plainly: "the catalog is the complete set of things that can possibly be in the cart",
and warns that open-world numbers "understate what the shipped product will do". This item is the
sharpest instance of that in the corpus: it is missing from the evaluation index, and adding the one
entry a real store's catalog would contain turns the answer right.

### So the yellow bag's story, corrected

It is not one failure. It is a hard-to-propose object **and** an out-of-catalog product, and the two
have been masking each other all along. The detector work here removes the first; the second is not
a pipeline defect at all, and the honest thing to say is that this corpus measures the yellow
produce bag in a world the product does not ship into.

That does not make the corpus figure wrong, and the figure is not being adjusted: the truth stands,
the catalog stands, and 8 of 9 on IMG_0252 stands. What changes is what the residual means.

## Ninety-first: the yellow bag, one root cause at five layers

The ninetieth showed that adding a `yellow produce bag` entry to the shortlist makes the model name
the item correctly, and that the index has no yellow anything. The obvious next move is to add the
SKU. It cannot be added, and the reason completes the story.

`build_kart_catalog.py` builds references **from the video** and queries **the stills**, deliberately:
"references from one capture and queries from another, or the number measures memorisation". So a
`kart_yellow_produce_bag` entry needs video crops of it. Searching every frame of every detection
pass for boxes that are substantially yellow, and looking at all fourteen candidates:

| | |
|---|---|
| clear views of the yellow bag | **5** (orders 13, 15 twice, 16, 17) |
| partial | 1 (order 19) |
| not the bag at all | 8 — the Seedtastic loaf's yellow labels, green produce |
| **`MIN_REFERENCES` in `catalog/head.py`** | **10** |

`Index.build` skips any folder with fewer than ten images, and says so as it goes. **The video does
not contain ten usable views of this object**, so the SKU cannot be built by the pipeline that built
the other eight. Confirmed directly: a nine-folder catalog with four yellow references indexes six
products, dropping `yellow_produce_bag` along with `granny_smith_apples` and `oreo`, which have nine
references each.

### The whole chain, from one cause

The yellow produce bag is small, plain, and sits against a larger bag of the same kind. That single
fact produces a failure at every layer of this system, and each layer's failure has been
investigated separately over the course of this file as though it were its own problem:

1. **Detection.** Rarely proposed, and never isolated at the shipped threshold (sixty-fifth).
2. **Tracking.** Never confirmed as its own track, because confirmation needs repeated proposals
   (twenty-sixth).
3. **Catalog.** No track and few clean crops means fewer than `MIN_REFERENCES` references, so no
   SKU exists (here).
4. **Shortlist.** With no SKU, the nearest entry offered is `purple_produce_bag` — the larger bag
   beside it (ninetieth).
5. **Naming.** Given a good crop the model says `Organic yellow onion` unprompted and
   `Purple produce bag` once the shortlist is attached, so the shortlist actively converts a
   half-right answer into a confidently wrong one (ninetieth).

Five sections of this file each found one of these and each reasonably treated it as the thing to
fix. **It was one thing all along.**

### What that means for the corpus figure, and what it does not

It is not fixable here. There is no tenth reference to find, the truth is not being adjusted, and
IMG_0252 stands at 8 of 9. In a deployment the store's catalog carries a product photograph of every
item it sells, which is exactly the assumption `CLAUDE.md` states and exactly what this corpus
cannot supply for this one product.

So the honest final statement about the yellow produce bag is narrow and complete: **on this corpus
it is unreachable at five layers for one reason, and in the world the product ships into, the layer
that matters most — the catalog — would not fail.**

## Ninety-second: the corpus's two hard photographs differ mostly in catalog coverage

The ninety-first found the yellow produce bag has no SKU because the video cannot supply ten
references for it. Asking the same question of every product says the gap is not one item.

The catalog is built from the video, and the video films **IMG_0252's trolley**. IMG_0254 is a
different, fuller trolley from a different capture:

| | products | with a catalog SKU | without |
|---|---|---|---|
| IMG_0252 | 9 | 8 | **1** — the yellow bag |
| IMG_0254 | 15 | 6 | **9** — both egg cartons, both Muenster packs, the beef, the jar, the salmon, the yellow bag, the broccoli |

**Sixty per cent of IMG_0254's products cannot have a catalog entry**, because the items are not in
the video the catalog is built from. Those badges are labelled `out_of_catalog` in
`still-labels.json`, which records the fact without drawing the conclusion: the photograph carrying
almost all of this corpus's residual is also the photograph the closed-world assumption least
applies to.

`CLAUDE.md` is explicit that this matters: "Open-world numbers understate what the shipped product
will do and send tuning in the wrong direction."

### The effect is real and partial, and the numbers say which

It would be easy to over-read this. Lacking a SKU is not fatal, and the measurements say so:

- of IMG_0254's **9 uncatalogued** products, the census still finds **6** — both egg cartons, the
  beef, the jar, the salmon and one of the two Muenster packs
- of the **4 it misses** on a representative pass, **3 are uncatalogued** (the second Muenster, the
  yellow bag, the broccoli) and one, the asparagus, is catalogued and was offered its own SKU at
  rank 2

So the shortlist is an assist rather than a requirement, and its absence explains part of the gap
rather than all of it. What it does explain is why the two loaded trolleys behave so differently
despite both being loaded: **IMG_0252 is 89% catalogued and scores 8 or 9 of 9; IMG_0254 is 40%
catalogued and scores 10 or 11 of 15.**

### What this does not license

The corpus figure is not being restated as a better one. The truth stands, the catalog stands, and
75 of 93 is what this pipeline scores against this corpus. The correct reading is narrower: **this
corpus measures one trolley in nearly-closed-world conditions and the other in nearly-open-world
ones**, and the difference between their scores should not be read as the pipeline handling density
badly, which is what the seventieth through eighty-eighth spent their effort assuming.

## Ninety-third: the ninety-first was wrong, and the yellow bag has a catalog entry after all

The ninety-first concluded the yellow produce bag cannot be catalogued because the video does not
contain ten usable views of it and `MIN_REFERENCES` is 10. **That was true of `video-frames.json`
and false of the video.**

`score_video.py` samples at **3fps**. The bag is plainly visible for about 2.6 seconds, which at
that rate is five frames, and five is what the ninety-first counted. The file is **262 frames at
30fps**. Sampling that same window densely and detecting at 0.15 gives **eighteen to twenty boxes at
or above 28% yellow, every one a clean view of the bag** — twice what `Index.build` requires.

The mistake is worth naming: I measured a *derived artifact* and reported it as a property of the
*source*. The 3fps sample exists because detection is expensive on 262 frames, which is a good
reason for the eval loop and no reason at all for building a catalog offline.

### With the entry, the matcher puts it first

`build_yellow_reference.py` extracts the references. Querying the augmented IMG_0254 box, the one
the eighty-ninth put on this item, against a catalog with and without them:

| catalog | shortlist for that box |
|---|---|
| the corpus's 8 SKUs | `purple_produce_bag`, brussels_sprouts, asparagus, baguette, … |
| **+ yellow_produce_bag** | **`yellow_produce_bag`**, purple_produce_bag, baguette, asparagus, … |

**Rank 1, ahead of the purple bag it has been confused with all along.** The matcher recognises this
object perfectly well from video references on a still; it had simply never been given any.

### The chain that failed at five layers now works at four of them

1. **Detection** — the eighty-ninth's new-ground augmentation puts a box on it.
2. **Catalog** — dense sampling supplies 18 references against a floor of 10.
3. **Shortlist** — the matcher ranks `yellow_produce_bag` first for that box.
4. **Naming** — the ninetieth measured that with `yellow produce bag` in the shortlist, the model
   answers `yellow produce bag`.

Each link is measured, and none of the four needed API credit. **The fifth, whether gpt-5.4-mini
converts it the way the local 7B does, is the only one still blocked.**

### What is not yet claimed

The index used here holds seven products, not the shipped 310, because `Index.build` also drops
`granny_smith_apples` and `oreo` for having nine references each. Rank 1 against six competitors is
not rank 1 against three hundred, and the honest next step is a full index rebuild followed by
`score_shortlist.py`, which would show whether the other twenty-one badges keep their SKUs.

And the eighty-eighth refused the augmented regions on an end-to-end unit count taken **with the
catalog that had no yellow entry**, where the box became a spurious `purple cabbage` line. With the
entry present that line may become a correct one, so **that refusal now rests on a measurement made
under the wrong catalog and deserves re-running.**

## Ninety-fourth: two overclaims in two sections, and what actually survives

The ninety-third said four of the yellow bag's five layers now work and only the shipped model was
untested. Pushing one step further says that was wrong, twice over.

### The rank-1 result was an artifact of a seven-product index

`Index.build` on the nine kart folders indexes seven products, because `granny_smith_apples` and
`oreo` fall below `MIN_REFERENCES`. Ranking first against six competitors is not the shipped
question. Against the real index — 310 SKUs, the same fine-tuned encoders, nearest prototype:

| | 1 | 2 | 3 |
|---|---|---|---|
| as shipped | kart_purple_produce_bag **0.773** | kart_baguette 0.771 | kart_seedtastic_bread 0.641 |
| **+ yellow** | kart_purple_produce_bag **0.773** | kart_baguette 0.771 | **kart_yellow_produce_bag 0.715** |

Rank **3**, not rank 1. Still inside the top-5 the census is shown, so the first clause of the
closed-world instruction is satisfied — and that is all it is.

### At its real rank, the naming does not follow, and it is not the ordering

| shortlist put to the model | answer |
|---|---|
| no yellow entry, as today | `Purple produce bag` |
| **yellow present at its real rank 3** | **`Purple produce bag`** |
| yellow first, the seven-product ordering | `yellow produce bag` |

The obvious reading is rank anchoring, and it is wrong. Told the list is unordered: `Purple produce
bag`. Sorted alphabetically, which puts purple fourth and yellow fifth: `Purple produce bag`. Asked
to name the dominant colour before choosing: `Baguette`.

**The model is not being misled by the order. It is looking at a crop with a prominent purple bag in
it and saying so.** The ninetieth already established that box is not clean — "a purple produce bag
occupying more of the frame than the yellow one" — and the ninety-third read past its own correction
because a rank-1 result was exciting.

### What survives

- **The ninety-first's conclusion is still wrong and its correction stands.** The video does contain
  ten or more usable views of the bag; the 3fps sample does not. `build_yellow_reference.py` is
  committed and reproduces 18 at 28% yellow or better.
- **A `kart_yellow_produce_bag` SKU is buildable and lands in the top-5** for this box against the
  full 310. That is real, and it is the first time this item has been representable in the catalog
  at all.
- **It does not fix the naming**, because the box the detector can produce still holds two bags, and
  no catalog entry disambiguates a crop that genuinely contains both.

So the layer that fails is the one the sixty-fifth named at the beginning: **nothing proposes the
yellow produce bag alone.** Everything downstream is fine, and everything downstream has now been
demonstrated to be fine, which is worth more than another refusal.

**Two overclaims in two sections is the pattern to notice.** Both came from a real result read one
step past what it showed, and both were caught by asking the next question rather than by rereading
the last answer.

### Correcting one sentence: it is proposed alone, on frames nothing looks at

The ninety-fourth closed with "nothing proposes the yellow produce bag alone". That is false as
written, and the reference crops in `build_yellow_reference.py` are the proof: fourteen of them,
each a clean view of the bag, each cut from a detector box.

Precisely, at 30fps and threshold 0.15, a box at or above 28% yellow exists on **twenty frames**:

    108 114 123 126 129 132 135 138 141 144 147 150 153 156 159 162 168 171 174 177
    t = 3.6s ................................................................ 5.9s

Against what the pipeline actually looks at:

| | frames censused | inside the clean window |
|---|---|---|
| shipped, captures at t=2,4,6,8s | 60, **120**, 180, 240 | one, frame 120 |
| `--best-in-window=motion` (sixty-sixth) | 30, 90, **150**, 190 | one, frame 150 |

**Frame 120 is inside the window and is not one of the twenty.** Its neighbours 114 and 123 both
carry a clean box and it does not: the shipped capture misses by a single sampled frame. Frame 150,
which the best-in-window gate takes, *is* one of the twenty.

So the accurate statement is narrower and more useful than the one it replaces: **the yellow produce
bag is proposed alone, on about eight per cent of the video's frames, at a detection threshold and a
frame rate the pipeline does not run.** Reaching it needs 30fps detection at 0.15, roughly ten times
the detection the design is built around and the reason `score_video.py` samples at 3fps at all.

The three changes that would line up — the gate rule from the sixty-sixth, threshold 0.15, and the
catalog entry from the ninety-third — have each been measured harmful alone, at 6.5 of 9, five units,
and rank 3 respectively. Stacking three measured-harmful changes to recover one product is not a
trade this file has ever seen pay, and it is the same arithmetic the eighty-eighth ran and lost.

What has changed is that every one of those layers is now understood and none of them is a mystery.
The item is reachable in principle at ten times the detection budget, and that is a product decision
about cost, not an open question about recognition.

### A note on `OPENAI_BASE_URL`, which does not reach a local model

The override added earlier this session was documented as covering "a locally served model". It does
not, and the comment is corrected in `server/src/openai.ts` and `.env.example`.

Everything on the recognition path goes through `openai.responses.create` — the **Responses API** —
with `json_schema` and `strict: true`. The local servers anyone would reach for, llama.cpp, vLLM,
Ollama and mlx-vlm, implement `/v1/chat/completions`. Pointing a base URL at one produces a 404 on
the first request rather than a working pipeline.

So the override is worth having, and its reach is narrower than claimed: another OpenAI organisation
or key, a gateway or proxy, or Azure OpenAI where the deployment exposes the Responses API. **Running
the shipped pipeline end to end against a local model is not available**, which is why
`census_local.py` asks one crop at a time instead: it is a different pipeline precisely because the
shipped one cannot be pointed at a local model.

## Ninety-fifth: it builds for a real phone, and what is missing is not code

"Works on the phone" had been an open worry all along and was never checked. It builds:

    xcodebuild -workspace ios/Kart.xcworkspace -scheme Kart -configuration Debug \
      -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO

succeeds with no errors, and the product is a genuine device binary — `Debug-iphoneos`, `arm64`,
SDK `iphoneos26.2`, `MinimumOSVersion` 17.0. **Nothing in this app is simulator-only**, which was
the risk worth testing: the Vision frame processor plugin, VisionCamera and the worklets all compile
for arm64 against the device SDK.

What is missing is not code:

| | |
|---|---|
| `DEVELOPMENT_TEAM` | **now set** to `9H4C3NF3SZ`, with `CODE_SIGN_STYLE = Automatic` |
| a connected iPhone | none attached; only the Mac appears under devices |
| `NSCameraUsageDescription` | **present** |
| `NSMotionUsageDescription` | **present** |

Signing is now configured rather than left as a task. The Mac already carries a valid identity,
`Apple Development: ayaangupta2009@icloud.com`, whose certificate OU gives team `9H4C3NF3SZ`, and
both the Debug and Release configurations of the app target now set that team with automatic signing.

Building for a device with `-allowProvisioningUpdates` gets all the way to the one thing left:

    error: Communication with Apple failed: Your team has no devices from which to generate a
    provisioning profile. Connect a device to use ...

That is the signing chain working and asking for hardware. Attaching an iPhone and pressing Run
registers the device and generates the profile automatically; nothing else needs configuring, and
the permission prompts are already correct on first launch. The simulator build is unaffected and
still succeeds.

Worth noting for anyone else who picks this up: the team id is a personal one, checked in because
this is a single-developer repository. It should come out, into an `.xcconfig` or CI secret, before
the project is shared.

### The native layer, reviewed for device-only risk

Compiling for arm64 says the code builds, not that it works on a camera. The frame processor plugin
is the piece that cannot be exercised in a simulator — the Frame Lab reports `apple-instance-mask`
errors there — so it was read for the faults that only appear on a device. There are none:

| risk | state |
|---|---|
| `VNGenerateForegroundInstanceMaskRequest` needs iOS 17 | deployment target **is** 17.0; consistent, no guard needed |
| camera pixel format | handles both 420YpCbCr8BiPlanar ranges, both Planar ranges, and OneComponent8, which covers what VisionCamera delivers |
| an unhandled format | returns an explicit error rather than zeroes, and that error now reaches the shopper |
| **frame orientation** | converted properly, and the code says why it must be |

The last is the one worth naming. `Frame.orientation` is a `UIImage.Orientation` and Vision wants a
`CGImagePropertyOrientation`, and the plugin carries a comment that the two enums are "NOT raw-value
compatible (their cases are ...)" with an explicit conversion, plus a `swapsDimensions` check that
transposes width and height when the rotation demands it.

**That is exactly the fault that broke this file's own renders today** — boxes drawn a quarter turn
from their objects because EXIF orientation was not applied — caught in the native code long before,
by someone who wrote down why. A sideways frame would have made the detector useless on a phone
while looking fine in every simulator test.

### "Download it to my phone" is narrower than it sounds

The Mac holds **one Apple Development certificate and no distribution certificate**. That decides
what is possible, and it is worth stating plainly rather than leaving as an assumption:

| route | possible now |
|---|---|
| Xcode, phone attached, Run | **yes** — this is what the signing config above enables |
| TestFlight | **no** — needs a paid Apple Developer Program membership and a distribution certificate |
| Ad-hoc `.ipa` sent to the phone | **no** — same requirement |
| App Store | no |

So there is no link to tap and no file to download. Installing it means attaching the phone once and
pressing Run, and on a free personal team the installed app stops launching after seven days and has
to be re-run from Xcode. A paid membership removes the expiry and unlocks TestFlight, which is the
only route that matches "download it to my phone" literally.

That is an account decision rather than an engineering one, and nothing in the code changes either
way.

**Once installed, it does run on its own.** Worth checking separately, because a Debug build fetches
its JavaScript from Metro on the Mac and would stop working the moment the phone left the desk. The
Release build does not:

    xcodebuild -workspace ios/Kart.xcworkspace -scheme Kart -configuration Release \
      -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO

succeeds and produces `Release-iphoneos/Kart.app`: arm64, **56 MB**, carrying a **4.1 MB
`main.jsbundle`** inside it. No Metro, no cable, no laptop. So the honest split is that *installing*
needs Xcode and a cable, and *running* needs nothing at all.

Choose the Release configuration in Xcode's scheme editor before pressing Run if the phone is going
to leave the desk; the Debug default will look fine on the desk and fail in a shop.

**The one thing to do while it is running there** is read the `[kart] device sharpness` line the
scan prints every thirty frames in a Debug build. `MIN_KEYFRAME_SHARPNESS` is 12, set against
`score_video.py`'s whole-frame variance, while `FrameMetrics.sharpness` reports the largest of a 3x3
grid of tiles and runs several times higher, so on a phone the blur gate rejects nothing. That
readout is the single measurement the constant needs and the only one this corpus cannot produce.

## Ninety-sixth: a better detector, researched, measured, and refused

The seventy-sixth closed every rule-level fix for grouping by construction and ended: "Improving it
means a different proposal source, which is a model change and not a configuration one." That was a
research question, and it now has an answer.

**MM Grounding DINO** (`openmmlab-community/*`) and **LLMDet** (`iSEE-Laboratory/*`) are open-weights
successors that run through the same `AutoModelForZeroShotObjectDetection` class this project already
calls, so they are a one-line swap. Their published gains sit where this corpus hurts: MM Grounding
DINO reports **+11.8 to +12.6 AP on LVIS**, the long-tailed, many-small-objects benchmark, against
+2.2 on COCO. Small objects in cluttered scenes is exactly the yellow bag's problem.

`KART_DETECTOR` swaps the model, `compare_detectors.py` scores one against the hand-labelled boxes,
and `detect_carts.py` writes a region set the bag harnesses consume.

### At the box level it is clearly better

| | proposals | reached, readable | isolated, readable |
|---|---|---|---|
| Grounding DINO, as shipped, 0.23 | 19 | 19 of 20 | 11 of 20 |
| MM Grounding DINO base_all, 0.23 | 15 | 16 of 20 | 11 of 20 |
| **MM Grounding DINO base_all, 0.15** | 24 | **20 of 20** | **13 of 20** |
| MM Grounding DINO base_all, 0.10 | 30 | 18 of 20 | 14 of 20 |

At 0.15 it reaches everything and isolates two more products than the shipped detector. **It also
isolates the first Muenster pack, which the shipped detector misses entirely** — one of the four
products separating IMG_0254 from a perfect answer. The threshold has to move because the two models
score differently; comparing them at 0.23 compares calibrations, not detectors.

### End to end it is worse, on contents and not only on units

`local-census-bag.ts` reported units alone, which cannot tell a detector that finds one more real
product while inventing one more line from one that invents two. The still truth and its scorer are
now lifted into `still-truth.ts` and shared, so both harnesses score contents. Same census model,
same fusion, same truth, only the detector differs:

| | units / 31 | exact | products found | lines matching nothing |
|---|---|---|---|---|
| **Grounding DINO, shipped** | **37** | **4 of 6** | 22 strict, **24** lenient of 31 | **13** |
| MM Grounding DINO, 0.15 | 38 | 3 of 6 | 20 strict, 23 lenient of 31 | 15 |

**One fewer product found and two more invented lines, from the detector that proposes strictly
better boxes.** This is the seventh time in this file that a proposal improvement has failed to
survive the census, and the mechanism is the one the eighty-eighth named: every proposal is a badge,
every badge is a question, and every question can produce a line.

The sparse trolleys show it plainly. At 0.15 MM Grounding DINO proposes 4, 4, 5 and 6 regions on
trolleys holding 1, 1, 2 and 3 products, where the shipped detector proposes 2, 1, 3 and 3. That is
the same failure that refused threshold 0.20 in the seventy-fourth, arriving through a different
model.

### What is worth keeping

The refusal is of the swap, not of the finding. `KART_DETECTOR`, `compare_detectors.py` and
`detect_carts.py` are committed, so the next candidate is an afternoon rather than a rebuild, and
LLMDet — whose LVIS numbers are higher again — has not been tried.

The caveat is the standing one: this is scored through a local 7B census, not gpt-5.4-mini, and a
larger model may convert extra badges differently. It is the seventh measurement pointing one way,
which is why it is believed and why it still deserves a credit-backed re-run.

### LLMDet, the strongest benchmark number, is the weakest here

The ninety-sixth closed by naming LLMDet as untried and its LVIS numbers as higher again — 47.8
Val1.0 AP against MM Grounding DINO tiny's 31.9. Tried, at three thresholds:

| detector | threshold | proposals | reached, readable | isolated, readable |
|---|---|---|---|---|
| Grounding DINO, **as shipped** | 0.23 | 19 | 19 of 20 | 11 of 20 |
| MM Grounding DINO base_all | 0.15 | 24 | **20 of 20** | **13 of 20** |
| LLMDet base | 0.23 | 15 | 14 of 20 | 9 of 20 |
| LLMDet base | 0.15 | 21 | 17 of 20 | 11 of 20 |
| LLMDet base | 0.10 | 25 | 16 of 20 | 9 of 20 |

**The model with the best published LVIS score is the worst on this corpus at every threshold
tried**, and it is worse per proposal as well as in total: at 0.15 it spends 21 proposals to reach
17 of 20 where the shipped detector spends 19 to reach 19.

A plausible reason, offered as a hypothesis rather than a measurement: LLMDet's advantage comes from
training on grounding captions, which sharpens referring expressions — "the bag behind the bread" —
while this pipeline asks one generic phrase, `a grocery product. a packaged food item. a drink
container.`, of every frame. A model tuned to resolve descriptions may be a poor fit for a prompt
that describes nothing in particular.

**The transferable point is about benchmarks, not about LLMDet.** Three detectors, three orderings:
MM Grounding DINO wins on boxes and loses on the bag; LLMDet wins on LVIS and loses on boxes; the
shipped model wins where it counts. A leaderboard rank is a hypothesis about your task, and on this
corpus it was wrong twice in a row. What makes that cheap to discover is `compare_detectors.py`
against the hand-labelled boxes: a new candidate is one command and about four minutes.

## Ninety-seventh: the visual output, and the shelves measured rather than cited

The report the ninety-sixth published covered six trolleys and four video captures. Four of the ten
photographs — the store shelves — showed nothing, because no live census sits behind them and a page
that draws a result it did not produce is worse than a page with a gap.

`is_cart_local.py` closes that by asking a local 7B rule 0's own question, "is the main subject of
this photograph the inside of one shopping cart", of all ten:

| | said cart | said not a cart |
|---|---|---|
| six trolleys | 4 | **2** — IMG_0244 and IMG_0245 |
| **four shelves** | 0 | **4** |

**Every shelf is refused and no shelf is accepted**, which is the direction that matters: a shelf let
through produced up to 41 invented items before the gate existed. The two it gets wrong are the
trolleys holding a single cauliflower in an otherwise empty basket, which is a fair thing to hesitate
over and the opposite of the dangerous error.

This is a local 7B, not the shipped model, and it is weaker: `shelf-census.ts` measured the shipped
census at 10 of 10. Reported as its own number rather than as evidence about the service.

### What the shelves look like drawn

The renderer now draws them with every proposal muted and no labels at all, because nothing was
asked about any of them. IMG_0250, the meat case, carries **43 proposals** — forty-three questions
the gate declines to ask. That picture makes the fifty-fourth section's argument in one frame better
than its numbers did: the detector is working exactly as designed and the entire value of
`subjectIsCart` is refusing to hand its output to the census.

The report now covers all ten photographs and the four video captures, fourteen cards, and the
shelf figure in the summary strip is a result this page produced rather than one it quotes.

## Ninety-eighth: filtering proposals before badging, the first change that pays

Seven times in this file a better detector has produced a worse bag, always by the same mechanism:
every proposal is a badge, every badge is a question, and every question can produce a line. The
seventy-sixth called that structural. It is not — it is an argument for a filter between proposing
and labelling, which is also what the hallucination-mitigation literature does about the same
problem.

The signal was already measured here. The eighty-third found the catalog matcher's own confidence
separates right badges from wrong ones at a **+0.122** mean gap, twice the census's own, with a free
operating point: at **0.60** it catches 3 of 9 wrong badges and **0 of 66 right ones**, because no
correct badge on this corpus scores below it.

`filter_proposals.py` scores every proposal against the index and drops the ones the catalog does
not recognise at all, before any of them becomes a badge. Same census model, same fusion, same
truth:

| | proposals | units against 31 | exact | products found, lenient | lines matching nothing |
|---|---|---|---|---|---|
| shipped detector | 34 | 37 | 4 of 6 | **24** of 31 | 13 |
| **shipped + filter** | 24 | **33** | **5 of 6** | 23 of 31 | **10** |
| MM Grounding DINO | 43 | 38 | 3 of 6 | 23 of 31 | 15 |
| **MM Grounding DINO + filter** | 34 | 34 | 4 of 6 | **24** of 31 | **10** |

**Both filtered rows beat their own unfiltered row on every column that matters**, and the filter
turns the detector swap from a regression into a small win: MM Grounding DINO plus the filter keeps
every product the shipped detector finds and invents **three fewer lines** than it.

The shipped detector plus the filter is the other end of the same trade — best exactness at 5 of 6
and closest unit count at 33, for one product given up.

### What it costs, and why that cost is a corpus artifact

The filter drops what the catalog does not recognise, and on this corpus that includes real products
the index has no SKU for. IMG_0254 falls from 11 proposals to 7 under the shipped detector, and the
one product lost is an out-of-catalog item. The ninety-second measured that photograph at **40%
catalogued** against IMG_0252's 89%, because the catalog is built from the video and the video films
a different trolley.

So the cost side of this trade is largest exactly where the corpus is least like the deployment.
`CLAUDE.md` assumes the store's full catalog; with one, a proposal the catalog cannot recognise is
far more likely to be genuinely not a product, which is what the filter is for.

### Before this ships

Two things. It is measured through a local 7B census, not gpt-5.4-mini, and the second clause of the
closed-world instruction — whether the shipped model converts the surviving badges the same way —
needs credit. And 0.60 comes from 75 badges on six photographs; it is the right operating point on
the only evidence there is, which is not the same as the right one.

But this is the first change in this file that improves the bag rather than explaining why nothing
can. It is worth the credit-backed run ahead of everything else queued.

### The filter's threshold, swept on the metric it will be judged by

0.60 came from badge-level correctness in the eighty-third, not from the bag. Swept on the bag,
shipped detector throughout:

| matcher confidence | proposals kept | units against 31 | exact | products found | lines matching nothing |
|---|---|---|---|---|---|
| 0.50 | 132 of 132 | — | — | — | — |
| off | 132 | 37 | 4 of 6 | 24 | 13 |
| **0.60** | 95 | **33** | **5 of 6** | **23** | **10** |
| 0.70 | 60 | 33 | 5 of 6 | 22 | 11 |

**0.50 is inert** — no proposal on this corpus scores below it — and 0.70 drops more than half of them
to find one fewer product and one more spurious line. 0.60 is the peak of the three.

That is worth more than the number itself: the threshold was chosen on one measurement, whether a
badge is named correctly, and holds on a different one, what reaches the bag. A constant fitted on
the metric it is then judged by proves nothing; this one was not.

### A refinement refused before it cost anything

The filter's one measured cost is dropping real products the index has no SKU for. The detector's
own score is an independent signal that something is an object at all, so keeping a
matcher-rejected proposal when its detector score is high looks like it should recover exactly those
without readmitting junk.

Checking the two distributions first, on the two loaded trolleys:

| | detector scores |
|---|---|
| kept by the matcher at 0.60 | 0.582 … 0.683 |
| dropped by it | 0.572 … 0.646 |

**They overlap almost entirely.** The dropped proposals are not lower-scoring objects, they are
objects the catalog does not know, and the detector is equally sure about both groups. Any threshold
that rescued the real product would readmit the junk with it.

`--keep-score` exists on `filter_proposals.py` and is documented as measured not to help here,
because a corpus with a fuller catalog might separate differently. The refusal cost one distribution
print rather than two census runs and a bag comparison, which is the whole reason to look at the
signal before building on it.

### The filter, implemented in the service and left off

A measurement in the eval harness is not a change to the product. `MIN_CATALOG_CONFIDENCE` now
exists in `server/src/enumerate.ts` and `usable()` applies it, so the ninety-eighth's result is one
constant away from shipping rather than a rewrite.

**It is set to 0, which is off**, and the reason is the same standard this file has applied to
everything else: every number behind it comes from a local Qwen2.5-VL standing in for the census,
not from `gpt-5.4-mini`, and this project does not ship a change on evidence from a different model.
A test asserts the constant is zero and that an unrecognised region survives, so raising it without
measuring fails the suite first.

Two details worth having in the code rather than only here. A region with **no** catalog information
is kept whatever the threshold, because a degraded or unconfigured matcher saying nothing is not the
catalog saying no. And the docstring carries the three-row comparison and the note that 0.6 was
derived from badge naming and then held on bag contents, so the next reader does not have to trust
that it was not fitted to its own metric.

To validate: set it to 0.6 and run `server/eval/verify.py --model`.

### The filter replicated on a second census model

The ninety-eighth's caveat was that every number came from one local model standing in for the
census. The ideal answer needs credit. The available one is a second model, and it is worth more
than nothing: an effect that survives two different censuses is a property of the filter rather than
of one model's habits.

Same regions, same fusion, same truth, only the census model differs:

| census | | units against 31 | products found, lenient | lines matching nothing |
|---|---|---|---|---|
| Qwen2.5-VL **7B** | unfiltered | 37 | 24 | 13 |
| Qwen2.5-VL **7B** | filtered at 0.6 | **33** | 23 | **10** |
| Qwen2-VL **2B** | unfiltered | 34 | 25 | 9 |
| Qwen2-VL **2B** | filtered at 0.6 | **31** | 24 | **7** |

**Both models move the same way and by about the same amount**: four units closer to the truth and
three fewer invented lines on the 7B, three and two on the 2B, each costing one product. The 2B
filtered lands on **31 units against 31 real**, exactly right in total.

The two models disagree about plenty else — the 2B finds one more product unfiltered and is worse at
`isProduct` — so their agreement here is about the filter and not about a shared quirk. The cost is
the same on both, and it is the same product: an out-of-catalog item the matcher cannot recognise by
construction, which the ninety-second showed is a corpus artifact rather than a pipeline one.

That is two of three. `gpt-5.4-mini` is a third model and the one that ships, and
`MIN_CATALOG_CONFIDENCE` stays at zero until it has been asked.

### The filter on the video, where it barely fires

The filter has been measured on the stills. The video is the other half of the corpus and the path
the app actually runs, so its behaviour there decides the shipping risk. The video's region column
already carries catalog confidence, so this needs no re-matching:

| | proposals | kept at 0.60 | dropped |
|---|---|---|---|
| order 6, censused | 8 | 8 | 0 |
| order 12, censused | 5 | 5 | 0 |
| order 18, censused | 2 | 2 | 0 |
| order 24, censused | 4 | 3 | **1** |
| **all 27 frames** | 137 | 125 | 12 |

**One proposal across four censuses.** The video's catalog confidence runs 0.52 to 1.00 with a
median of **0.94**, because the video films IMG_0252's trolley and the catalog is built from that
same video: nearly everything in frame has a SKU.

Two things follow, and they point in opposite directions.

**The shipping risk is low.** On the scan path — the one the product actually runs — this change is
close to a no-op. It cannot degrade a scan much because it hardly fires in one.

**The benefit is low there too.** The filter earns its numbers on IMG_0254, the photograph the
ninety-second measured at 40% catalogued. Its value is concentrated exactly where the catalog is
thin, and `CLAUDE.md` assumes a deployment where it is not.

So the honest description is narrower than "a change that improves the bag": **it is a guard against
proposals the catalog cannot account for, worth most on frames full of goods the index does not
know, and almost silent everywhere else.** That is still worth having — an unrecognised proposal is
a question with no good answer — but it is not the recognition improvement the corpus figure makes
it look like.

### It is not a second line of defence behind the shelf gate

A tempting secondary claim for the filter: a shelf's hundreds of facings are not in this shopper's
cart, so a catalog filter should thin them heavily and limit the damage if `subjectIsCart` ever let
one through. Measured, it does not:

| | proposals dropped at 0.60 |
|---|---|
| four shelves | 30 of 102 (**29%**) |
| six trolleys | 7 of 30 (**23%**) |

**Near enough the same rate.** The filter is not discriminating between a shelf and a cart at all;
it removes proposals the index cannot place, and a shelf in the same store is about as placeable as
a trolley from it. The catalog holds 310 general grocery products, not only this trolley's eight.

So the claim is withdrawn before it was made anywhere but here. `subjectIsCart` remains the only
thing standing between a shelf photograph and a bag full of goods nobody is buying, and the filter
would reduce that failure by roughly a third rather than prevent it.

Worth the ten seconds it took: the hypothesis was plausible, cheap to check, and wrong.

### The runner, completed

`verify.py` gained the cart-or-shelf gate, which is the only local coverage of four of the ten
photographs and had been sitting outside the one entry point it was written to be. Seven checks now,
five of which run without a key:

| requirement | check | needs a model |
|---|---|---|
| 1 every item reaches the bag | detector recall and isolation against hand-labelled boxes | no |
| 1 | catalog shortlist recall, the closed world's first clause | no |
| 1 | **cart or shelf, the `subjectIsCart` gate over all ten** | no |
| 1 | the bag, six trolleys, live census | **yes** |
| 2 quantities are right | the scan loop over the video, contents-scored | **yes** |
| 3 hidden items are flagged | occlusion discrimination over all ten | no |
| 4 unsure items are flagged | census confidence calibration, from the last saved run | no |

The two that need a model probe for credit with a single blank-image census first and report SKIPPED
with the reason rather than failing their own way after doing work.

## Ninety-ninth: resolution decides legibility, and a closer look still does not repair the errors

Both models misname the Muenster pack, and the pack reads `MUENSTER deli-sliced cheese` in large
type. That looked like a legibility limit rather than a recognition one, and it is:

| source long edge | crop | the 7B's answer |
|---|---|---|
| 1024 | 116x154 | `Instant Powdered Milk` |
| **1333** | 152x200 | **`Muenster Cheese`** |
| 2000 | 227x300 | `Muenster cheese` |
| 3000 | 341x450 | `Muenster cheese` |

**A printed product name becomes unreadable somewhere below 150 pixels on the short side**, and the
failure is not a hedge, it is a confident wrong answer about a different product.

### The obvious lever, and why it is not one

If small badges are illegible, trigger the closer look on size. As a trigger it is worse than what
the eighty-third already found:

| trigger | wrong badges caught | right badges caught |
|---|---|---|
| matcher confidence below 0.60 | 3 of 9 | **0 of 66** |
| box short side below 0.15 | 3 of 9 | 6 of 66 |
| box short side below 0.20 | 9 of 9 | 27 of 66 |

Same recall for six false flags instead of none. And catching more does not help, because the
eighty-second measured the second look repairing exactly two badges however it is triggered.

Asking the harder question — does a **full-resolution** second look repair the badges the census
gets wrong — the answer is no:

| badge | census said | at full resolution |
|---|---|---|
| IMG_0252 #8, the Fuji bag | `fresh grown brussels` | `Smoked Turkey Breast`, still wrong |
| IMG_0254 #4, the shopper's tote | `baguette` | `Jo Malone London`, and no name is right: it is not a product |
| IMG_0254 #10, asparagus | `asparagus` | `Asparagus Spears`, already correct since the ninetieth's label fix |

**One of the three is unanswerable by naming at all** and the right response is `isProduct: false`.
Another reads as a different product at every resolution tried. Resolution is not what is wrong with
them.

### Why the Muenster is not in that table

Its badge is labelled `out_of_catalog`, so alignment scores it `null` and it never appears as a
wrong badge. **The one case where resolution demonstrably is the cause sits outside the metric that
would have found it** — which is worth knowing about the metric, not only about the pack.

So the finding stands and is narrow: resolution decides whether printed packaging can be read, the
threshold is near 150 pixels, and on this corpus it explains one out-of-catalog miss rather than the
errors the alignment metric counts.

### Correcting the ninety-ninth: resolution explains almost nothing in the shipped configuration

The ninety-ninth found printed names become unreadable below about 150 pixels and reached for the
Muenster pack as the case. Measuring what the shipped census actually sees says that attribution is
wrong.

`CENSUS_LONG_EDGE` is **1536**, and these photographs are portrait, so a badge's short side in the
composite is its normalised width times 1152 or its height times 1536. Across the six trolleys, the
badges below the floor are:

| badge | short side | what it is |
|---|---|---|
| IMG_0244 #1 | 109px | `skip` — the plastic disc in the child seat |
| IMG_0246 #2 | 112px | `skip` |
| IMG_0252 #8 | **84px** | the Fuji bag close-up, one of the three wrong badges |
| IMG_0254 #3 | 121px | the jar, `out_of_catalog` |

**Four badges of thirty, and two of them are regions labelled `skip`.** More to the point:

    IMG_0254 badge 9, the Muenster pack:  175px  — above the floor

So the pack the whole thread was built on is *legible* at the resolution the census sees it, and the
shipped model misnames it anyway. The local 7B reads it correctly at a smaller crop than that. **That
is a difference between models, not a difference in pixels**, and the ninety-ninth's framing pointed
at the wrong cause.

What survives: the 150-pixel floor is a real property, measured on a real crop, and it is worth
knowing when sizing a composite. What does not: any claim that it explains this corpus's naming
errors. The one badge below the floor that is also wrong, IMG_0252 #8 at 84px, was already tested at
full resolution in the ninety-ninth and read as `Smoked Turkey Breast` there too.

Raising `CENSUS_LONG_EDGE` would move four badges, two of which are not products, one of which is
wrong at any resolution, and one of which is a jar the index has no SKU for. That is not a lever.

## Hundredth: the shipped model is the better of the two, and two anecdotes said otherwise

Two cases in this file had the local 7B naming a crop the shipped census got wrong: the Muenster
pack in the ninety-ninth, and the asparagus in the seventy-seventh. Two is an impression, not a
measurement. Put to all the scorable badges on the six trolleys, same crops, same question:

| | named its badge correctly |
|---|---|
| **gpt-5.4-mini, as shipped** | **20 of 22** |
| local Qwen2.5-VL 7B, 4-bit | 18 of 22 |

They disagree on four, and the shipped model wins three of them:

| badge | shipped | local |
|---|---|---|
| IMG_0249 #2 asparagus | `asparagus` | `brussels sprouts` |
| IMG_0252 #6 asparagus | `asparagus` | `green leafy vegetables` |
| IMG_0254 #7 baguette | `baguette` | `reduced fat milk` |
| IMG_0252 #8 the Fuji close-up | `truffle` | `apple cheddar cheese` |

**So the "a smaller local model reads this better" thread is closed, and it was wrong.** The two
cases that suggested it are both out-of-catalog badges, which the alignment metric does not score,
so they were exactly the population least likely to represent the whole. Sampling from the
unscorable set and generalising to the scorable one is the error, and it is an easy one to make when
the unscorable cases are the interesting ones.

This also settles a question the ninety-sixth left open from the other direction. That section
refused a detector swap; this refuses a census swap, on the only comparison available without
credit. `gpt-5.4-mini` is better than the best local model here, and the twenty-second already
measured the larger `gpt-5.4` doing worse on a scan by sweeping harder. **The shipped census sits
between two measured alternatives, both worse.**

## Hundred-and-first: a keyless bag for the video, and what it can and cannot measure

Since the account emptied, the still path has had `census_local.py` and the video path has had
nothing: its regions could be measured but its **bag** could not. `video_census_local.py` closes
that, asking the same per-crop questions of the frames `video-census-live.ts` censuses and writing
them in the shape its `--replay` reads.

The replay guard earned its keep immediately. The first attempt generated answers for orders 6, 12,
18 and 24 — the capture path's frames — and the run refused them:

    replay entry 0 is for t=2s frame 6, but this run reached t=1s frame 3; the replay file does
    not match this frame set

That is a check written in an earlier section catching a mistake made in this one, which is what
those checks are for. The old path censuses orders 3, 9, 15 and 21.

### The harness works, and the stand-in is only good for one kind of question

| | products found, lenient | units against 9 | lines matching nothing |
|---|---|---|---|
| shipped path, `gpt-5.4-mini` | **8 of 9** | **8.17** | **0.33** |
| local 7B stand-in | **8 of 9** | 19 | 11 |

**Recall matches and precision does not, by a factor of thirty.** The local model finds the same
products and buries them in `lime juice`, `rogue ales ipa`, `guettner cheese` and eight more.

The reason is visible in the inputs. On the stills it works from 5712x4284 photographs; the video is
1080x1920 with motion blur, so a padded crop of one badge is small and smeared, and the model answers
confidently anyway — the same failure mode the ninety-ninth measured at 116 pixels, arriving through
blur instead of size.

So the harness measures **recall** changes on the video usefully and **precision** changes not at
all: its noise floor is eleven spurious lines where the service's is a third of one. That is worth
stating precisely, because a harness whose limits are unknown is worse than no harness — it invites
exactly the kind of conclusion this file has had to withdraw four times today.

## Hundred-and-second: the detector swap refused on the video too, completing the corpus

The ninety-sixth refused MM Grounding DINO on the stills: better boxes, worse bag. The video is the
other half of the verification set and that half was untestable until the hundred-and-first built a
keyless bag for it. Testing it now, and only on the quantity that harness supports — **recall**,
where it matches the service, rather than precision, where its noise floor is thirty times higher:

| detector on the video | products found, lenient | strict | units |
|---|---|---|---|
| **Grounding DINO, as shipped** | **8 of 9** | **6** | 19 |
| MM Grounding DINO, 0.15 | 7 of 9 | 5 | 22 |

**One fewer product on the video, one fewer on the stills.** The swap is now refused on both halves
of the corpus, by two different harnesses, on the metric each can actually support.

Two details from the run are worth keeping.

The replay guard fired a second time, and again correctly. Changing the regions changes the tracks,
which changes which frames the keyframe gate fires on: the fourth capture moved from order 21 to
order 18. The run refused a replay file built for the old pacing rather than scoring a frame against
another frame's answers. **A different detector does not just change what is proposed, it changes
where the loop looks**, which is a thing worth knowing before reading any comparison of two region
sets through a scan.

And the shape of the loss is the familiar one. On order 18 MM Grounding DINO offers nine regions
where the shipped detector offers two, and the census calls three of the nine products. Six extra
questions, one extra product found, three extra units. Every proposal is a badge.

## Hundred-and-third: the strongest local test of the yellow bag, and it fails

Everything the sixty-fifth through sixty-sixth established pointed at one configuration that ought
to find the yellow produce bag on the video: threshold **0.15**, which is the only setting whose
proposals isolate it, on frame order **15**, the only frame it is isolated in — and
`video-census-live.ts` censuses order 15. The capture path never does, which is why this was never
testable there.

With the video's bag now measurable without credit, it is testable here. Run:

| video regions | products found, lenient | strict | units against 9 |
|---|---|---|---|
| **shipped, 0.23** | **8 of 9** | **6** | **19** |
| 0.15, order 15 among the four censused | 7 of 9 | 5 | 22 |

**One fewer product, three more units, and the yellow produce bag still not named.** It appears in
the not-found list of the very run designed to find it.

That is the third detector configuration refused on the video in this session, alongside MM Grounding
DINO and the shipped baseline's own alternatives, and it is the one that mattered: every earlier
refusal left "but the isolating proposal is never censused" as an unexamined excuse. It has now been
censused, and the answer did not change.

The caveat is the harness's own, stated in the hundred-and-first: this is a local 7B whose precision
on video frames is thirty times worse than the service's, so the unit counts here carry little and
only the recall column is worth reading. **On recall — the thing this test exists to measure — 0.15
loses a product and does not gain the one it was for.**

What that leaves is narrow and, at last, complete: the yellow produce bag has been pursued through
prompts, five detector thresholds, tiling, two proposal models, pacing, the keyframe gate rule, four
fusion variants, a catalog entry built from dense frames, and now the single frame-and-threshold
combination the whole investigation pointed at. It is not found by any of them.

## Hundred-and-fourth: drawing the filter changes the recommendation

`MIN_CATALOG_CONFIDENCE` was measured at 13 spurious lines down to 10, replicated on two census
models, and written up as the one pending change that improves the bag. `render_filter.py` draws
what it removes, and the picture is not what the number implied.

On IMG_0254 the filter drops four proposals:

| dropped | matcher confidence | what it is |
|---|---|---|
| top of the frame | 0.55 | the second **egg carton** with a Muenster pack |
| centre right | 0.59 | the **jar** |
| centre | 0.59 | the **Alaskan sockeye salmon** |
| lower left | 0.55 | the **asparagus bag** |

**All four are real products.** Not junk, not the trolley frame, not the shopper's tote: four things
a shopper is buying, removed before the census is asked about them.

The end-to-end figure said the filter costs one product, and that is true of the *outcome* — the
unmarked sweep volunteers most of them back, so only one is finally lost. But the mechanism is not
"drops what is not a product". It is **"drops four real products and is rescued by a channel this
file has spent twenty sections calling unreliable"**, which is a materially worse thing to ship.

Three of the four are `out_of_catalog`, so the matcher cannot place them by construction; the
ninety-second showed IMG_0254 is 40% catalogued because the catalog is built from a different
trolley. The asparagus is the exception and it *is* catalogued — its box holds asparagus and other
goods together, so the matcher is unsure of a region that genuinely contains the product.

### What this does to the recommendation

It does not reverse it, and it sharpens the condition. `WHEN-CREDIT-RETURNS.md` already says not to
ship the filter if the four sparse trolleys stop being exact. It should also say: **check what it
drops, not only what the totals do.** A change whose benefit comes from removing real products and
relying on a fallback to restore them is one bad fallback away from being a regression, and this
file has measured that fallback failing before.

The honest summary is now: on a corpus where 40% of a photograph's products have no catalog entry,
this filter removes them and the sweep mostly covers for it. **In the closed world `CLAUDE.md`
assumes, those four would have SKUs and none of this would happen** — which is an argument for the
filter being safe in deployment and unsafe as a conclusion drawn here.

**Numbers hid this and a picture showed it in one look.** That is the case for the visual output
being part of the work rather than a report on it.

## Hundred-and-fifth: the filter removes only real products, and that reframes it entirely

The hundred-and-fourth drew what `MIN_CATALOG_CONFIDENCE` removes and found four real products among
them. Scoring it against the hand-labelled boxes instead of by eye — a measurement needing no model
at all — gives the complete answer:

| dropped proposal | what it covers |
|---|---|
| IMG_0252 box 6 | asparagus bag |
| IMG_0254 box 3 | jar |
| IMG_0254 box 6 | second egg carton, second Muenster pack |
| IMG_0254 box 8 | Alaskan sockeye salmon, broccoli |
| IMG_0254 box 10 | asparagus bag |

**Five proposals dropped. Five cover a labelled product. None covers nothing.**

So the filter does not remove junk. On this corpus it removes *only* real products, and the
13-to-10 fall in spurious lines has to come from somewhere else.

### Where it comes from, and whether that is a good trade

It comes from the census misnaming those products. A real product that is badged and misnamed costs
the bag **twice**: the product is missing *and* the wrong name is a spurious line. Remove the
proposal and the product is still missing, but the spurious line goes with it.

That is why the totals improve, and it is a narrower benefit than "filters junk":

- **spurious lines fall**, because misnames cannot happen for a badge that is never asked about
- **products found barely move**, because the unmarked sweep still volunteers most of them
- **and the possibility of ever naming them correctly is foreclosed**

Three of the five are `out_of_catalog`, which the matcher cannot place by construction, and the
ninety-second measured IMG_0254 at 40% catalogued because the catalog is built from another trolley.
Against a real store's catalog these five would carry SKUs, score above 0.60, and never be dropped —
so **the filter would do nothing at all in the deployment `CLAUDE.md` assumes.**

### What this does to the recommendation

It inverts it. This was written up as the one pending change that improves the bag. It is better
described as **a change that hides a naming failure by removing its subject**, whose measured benefit
exists only because this corpus's catalog is thin, and which would be inert on a catalog that is not.

`MIN_CATALOG_CONFIDENCE` stays at 0, and `WHEN-CREDIT-RETURNS.md` should stop calling it the first
thing to validate. The census pass is better spent on requirement 3, which has never been measured
at all.

**Three passes over the same change — totals, then a picture, then the labels — and each one made it
look worse.** The first was not wrong, it was incomplete, and the incompleteness all pointed the
same way.

## Hundred-and-sixth: my own labels were wrong, and they had been flattering two measurements

Scoring the augmentation's added boxes against the hand labels returned "clean" for the one on the
yellow produce bag. The picture of that same box, two sections earlier, plainly shows a purple bag
in it. A verdict and a photograph disagreeing means the instrument is wrong, so I looked at what the
labels actually point at:

| label | what is in the box |
|---|---|
| `yellow produce bag` | the yellow `ORGANIC` bag **and the purple bag above it** |
| `Fuji apple bag` | a *Reduced Waste* bag of tomatoes and greens — **not Fuji apples** |

Both are mine, written in the seventieth, and both have been in every isolation figure since.

**Why the "clean" verdict was possible.** `score_boxes.py` calls a box isolated when it covers its
item without covering *another labelled item*. IMG_0254's truth lists fifteen products and a purple
produce bag is not among them, though one is plainly in the photograph. So a box full of purple
dirties nothing, and reads as clean. The ninetieth already recorded that the label set is incomplete;
this is that incompleteness producing a specific wrong answer rather than a general caveat.

### What is fixed and what is flagged

The yellow bag's box is **tightened** to the yellow portion, which is defensible from the crop alone.
The Fuji label is **left in place and marked `uncertain`** with a note saying why: on IMG_0252 the
Fuji apple bag is the purple bag carrying a FUJI label, and IMG_0254 has a purple bag too, so the
Fuji is most likely that — but moving a truth box on an inference from another photograph is exactly
how a corpus stops being trustworthy. It needs someone to read the photograph at full size.

`boxes-IMG_0254.json` now carries a `known_faults` list saying both things outright, so the next
reader of any figure derived from it knows what it rests on.

### What this costs

Every "isolated" figure in this file that involves the yellow produce bag or the Fuji apple bag on
IMG_0254 is optimistic, and that includes the seventieth's headline (11 of 20), the eighty-ninth's
(12 of 20) and the ninety-sixth's detector comparison. The **reached** figures are unaffected: they
ask only whether an item is covered, which does not depend on the other labels being complete.

**A hand-made truth set is a measuring instrument and it was never calibrated.** It took a
disagreement between a number and a picture to notice, which is the fourth time today that looking at
something beat computing it.

### Correcting the hundred-and-sixth: it overstated the damage

That section said "every isolated figure in this file that involves the yellow produce bag or the
Fuji apple bag on IMG_0254 is optimistic, and that includes the seventieth's headline (11 of 20)".
Checking which items the headline actually counts says otherwise:

| | items | marked `judged`, excluded from the readable figures |
|---|---|---|
| IMG_0252 | 9 | `yellow produce bag` |
| IMG_0254 | 15 | `Fuji apple bag`, `yellow produce bag`, `broccoli` |

**Every box I found mislabelled is already excluded from the readable figures**, because all three
were marked `judged` when they were written — for the same reason they turned out to be hard to box.
So 19 of 20 reached and 11 of 20 isolated stand.

What remains true, and is a different fault: IMG_0254's truth has no purple produce bag though one is
plainly in the photograph, so a box containing purple is not penalised for it. That flatters the
isolation verdict of **other** items near the trolley's middle, and it is why the yellow bag's box
read "clean". `known_faults` in the label file says so.

### And an audit of the other label set

Rendering all nine IMG_0252 boxes as crops: eight are right, including `Fuji apple bag`, which is
correctly on the purple bag carrying the FUJI label — the same object that is *not* what the IMG_0254
Fuji box points at. The ninth is `yellow produce bag` again, dominated by purple and baguette with a
sliver of yellow.

**One item is bad in both label sets and it is the same item**, which is not a coincidence: it is
small, partly behind a larger bag of the same kind, and hard to box for exactly the reasons the
detector cannot isolate it. It is `judged` in both, so it costs the headline nothing.

Two corrections in two sections, one of a claim that was too generous and one of a claim that was too
harsh. **Neither direction is the safe one to guess in.**

---

## The hundred-and-eighth: correcting a label moved the headline up, which is the direction to distrust

The hundred-and-seventh closed by saying one item is bad in both label sets and it is the same item.
Leaving it bad was the wrong call. `yellow produce bag` is the item this whole investigation is
about; every figure quoted for it came from a box that was mostly purple bag and baguette.

So I re-placed it on IMG_0252 from a magnified view with the frame coordinates drawn on: the yellow
`ORGANIC` bag runs about x 0.095 to 0.20, y 0.525 to 0.61, and the purple bag begins around x 0.19.
The new box stops short of the purple. The crop is now mostly yellow with one purple corner.

Re-scoring against the corrected label:

| | before | after |
|---|---|---|
| reached, excluding judged | 19 of 20 | 19 of 20 |
| **isolated, excluding judged** | **11 of 20** | **13 of 20** |

**The headline moved up two after I edited a label, which is exactly the shape of a self-serving
result, so it needs the mechanism stated.** The two rows that changed are `baguette` and
`Fuji apple bag` on IMG_0252, and neither detector proposal changed at all. Isolation asks whether a
proposal covers one labelled item without covering much of another; both proposals overlapped the
*mislabelled* yellow box, which claimed baguette and purple-bag territory that the yellow bag does
not occupy. They were being penalised for overlapping an item that was not there. IMG_0252 is now
8 of 8 isolated excluding judged.

The other half of the change is the one that argues against me: with a correct box, the yellow bag
now reads **MISSED on both photographs** rather than found on one. The old label had it detected on
IMG_0252, and that was a false credit — the detector was finding the purple bag underneath the
mislabelled box.

That second half is the reason to believe the first. A label edit that only ever moved numbers
upward would be the thing to distrust; this one moved the item under audit down to zero found and
moved two unrelated items up, which is what a genuine correction of a misplaced box looks like.
It also makes the record internally consistent: every other section says the yellow bag is never
proposed, and the truth file now agrees.

`known_faults` in `boxes-IMG_0252.json` records that figures for this item taken before the
re-placement are not comparable with ones after.

**The refusals below do not need re-running.** Every detector comparison in this file scored each
variant against the same label set, so the misplaced box penalised all of them equally: Grounding
DINO at 0.23, MM Grounding DINO, LLMDet, threshold 0.20 and 0.15, and per-proposal re-detection all
sat at "isolated 11 of 20" *together*. A constant offset applied to every row does not change which
row wins, and no refusal in this file turned on a margin of two.

### And IMG_0254's box did not need fixing

Having corrected one, I checked the other rather than assuming the hundred-and-seventh was right
about it. Magnifying IMG_0254 with the frame coordinates drawn on: the yellow `ORGANIC` bag runs
about x 0.135 to 0.245, y 0.478 to 0.548, and the label already reads x 0.128 to 0.241, y 0.481 to
0.541. The crop is mostly yellow bag. **That box is fine**, and the hundred-and-seventh's "bad in
both label sets" was too harsh for this one — it was tightened earlier in the same session, which is
why. Its remaining purple is at the top, where the purple bag genuinely rests on the yellow one, so
the box is honest about the occlusion rather than misplaced.

So the yellow bag's truth is now: correct on both photographs, MISSED by the detector on both. The
item is genuinely never proposed, and no label artefact is propping that conclusion up any more.

The magnified view also confirms the `known_faults` entry with the naked eye: there is a **purple
produce bag** sitting directly above the yellow one on IMG_0254, occupying roughly y 0.45 to 0.485,
and the truth file has no entry for it. That one is still outstanding.

---

## The hundred-and-ninth: the phone was never blocked on a cable

Every number in this file was produced by the eval harness, which hands the pipeline a cached
region set and calls the recognition handlers as functions. Nothing in that path is a phone, a
network, or a running server. Asked what the app would actually do installed on a phone, this file
had no answer, and the answer turns out not to be about recognition at all.

**A build made today names nothing, for three separate reasons, and only the third is the model.**

| | missing | what the app does | how it was verified |
|---|---|---|---|
| 1 | `EXPO_PUBLIC_KART_API_URL` | every request returns `unconfigured` | the shipped bundle holds no recognition endpoint |
| 2 | `ENUMERATOR_URL` | degraded: no outlines, no shortlist, 72% of units | the server logged `enumeration degraded` |
| 3 | OpenAI credit | nothing recognized | `429 credit_balance_exhausted` |

The first was found by building the app for real hardware and reading the JavaScript bundle it
produced: the only URLs in it are library strings, Expo documentation, Metro's development port,
and Open Food Facts. There is no `.env` anywhere in the repository, so `apiBaseUrl()` compiles to
the empty string and `post()` returns `unconfigured` before it ever reaches the network.

That last detail is worth keeping: **the barcode fast path still works on a phone with no server
at all**, because Open Food Facts is called directly from the device. It is the only part of
recognition that survives a total server outage.

### The build itself is fine

`xcodebuild -configuration Release -destination 'generic/platform=iOS'` returns
`** BUILD SUCCEEDED **`, and the binary is `arm64`, `platform IOS`, `minos 17.0`. That is the
device slice and not the simulator's, and it had never been checked. **Installing it still needs a
cable or a paid membership, so the app has still never run on a physical phone.** Everything up to
the install is now verified; the install is not, and no amount of work here changes that.

### The second gap was the interesting one

`ENUMERATOR_URL` being unset does not fail loudly. `enumerateRegions` returns an empty list with
`degraded: "no enumerator configured"`, the census receives no marks, and it answers an open-world
question with no set-of-mark badges and no catalog shortlist. The README calls this a supported
mode and scores it at 72% of units with no outlines, which is true and is also **not the pipeline
this file measured**. Every refusal and every improvement recorded above assumes the regions are
there.

So the enumerator now has a second host, `server/enumerator/local.py`, which runs the same
detector on whatever accelerator a Mac has. It imports the prompts, the threshold, the
de-duplication and the produce merge from `regions.py` rather than restating them, which is what
makes the next claim checkable rather than hopeful:

| | cached regions | local host | matched at IoU 0.7 |
|---|---|---|---|
| IMG_0252 | 10 | 10 | **10 of 10** |
| IMG_0254 | 11 | 11 | **11 of 11** |

Most of those match between 0.98 and 1.00. It is the same region set, so the measured pipeline is
now runnable from this machine and reachable by a phone on the same wifi.

Two honest differences from the deployment, both reported by `GET /` so a degraded run cannot hide:
SAM2 is not installed locally, so polygons are bounding boxes and outlines are rectangles rather
than silhouettes (0.902 coverage against 0.924); and no catalog index is built, so regions carry no
SKU shortlist.

### What it costs on a Mac

| input | forward passes | time |
|---|---|---|
| a scan keyframe | 2 | **3.9s** |
| a sharp photograph | 15 | ~20s |

`PAIRED_PRODUCE_SHARPNESS` is what splits them, and the split lands the right way round for this:
the expensive fourteen-pass path is the one photographs take, and a live scan takes the cheap one.
A scan session is capped at eight census calls, so four seconds a call is usable. Twenty would not
have been.

### The whole chain, end to end

A real corpus photograph posted through both servers reached the model and failed at
`429 credit_balance_exhausted`, with the enumerator reporting 9 regions and no degraded mode. That
is request parsing, image decode, enumeration, mark composition and the model call all working,
stopping exactly where everything else in this file stops.

The redaction discipline held under a live test rather than a unit test: the wire response was the
fixed string `{"error":"Recognition failed"}` and the log contained no fragment of the key.

`docs/running-on-a-phone.md` is the runbook.
