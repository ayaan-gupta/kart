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
| **fine-tuned, one epoch** | **10/13** | **10/10** | **5/5** |

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

## What this corpus still cannot answer

**The census has never run.** Every identity above is the catalog matcher's own decision standing
in for the model that would choose among the candidates it offers. `isProduct` is the field that
would reject the plastic disc and the tote outright rather than leaving them amber.

**Sixteen items is the largest trolley here.** A full weekly shop is several times that, and the
misses already concentrate on items lying under other items.

**One video, nine seconds, one trolley.** Enough to find a gate that rejected everything. Not
enough to tune one.
