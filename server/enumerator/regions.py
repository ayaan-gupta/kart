"""The parts of the enumerator that are not a deployment.

`app.py` cannot be imported without Modal credentials: it builds a `modal.Volume` at module
scope, which reaches the network. Everything in this file is pure, so the eval harness can hold
the detector to the same prompt, the same threshold and the same de-duplication the service
runs, instead of re-implementing them and measuring something adjacent to what ships.

Nothing here imports modal, torch, or anything that loads a model.
"""


# Chosen by measurement (server/eval/sweep_prompt.py), which it had never been. The previous
# phrase list was written by looking at overlays on five cart photographs, and it carried one
# real finding from that exercise: container words like "bag" and "package" made the model
# propose the trolley itself, a box over more than half the frame on four of five photographs,
# which reached the shopper's bag as one unit of an item that does not exist. Deleting those
# words fixed it, and nothing else about the list was ever tested.
#
# Scored on 200 shelf photographs holding 2,585 labelled instances. Recall is unbiased; precision
# is a floor, because the corpus is partially annotated and a correct box on an unlabelled
# product counts against it.
#
#     prompt                              recall   precision   1-12   13-25    26+
#     nine shape words (was here)          39.0%       42.6%  54.7%   46.7%  30.2%
#     three grocery nouns (here now)       54.1%       44.1%  57.8%   58.0%  51.1%
#
# Better on both axes, and the gain is largest exactly where this product is worst: a photograph
# holding twenty-six or more items goes from finding under a third of them to finding half.
#
# "a product." alone scores as well on a shelf, 61.5% against 45.4% on a 60-photograph run, and
# was rejected: on the cart corpus it proposes a box over the whole trolley twice, which is the
# failure the old list existed to prevent, and it proposes 8.0 boxes per photograph against 11.2
# for the phrasing below. A shelf corpus cannot show that, because there is no trolley in frame.
# On those same 24 cart and haul photographs this prompt proposes no box covering more than 40%
# of the frame at all.
GROCERY_PROMPT = "a grocery product. a packaged food item. a drink container."

# Loose produce is what this prompt cannot see, and adding words for it to the prompt above
# makes things worse rather than better. On 60 shelf photographs:
#
#     prompt                                        recall   precision   boxes/scene
#     shipped, three phrases                         61.2%       45.9%          14.8
#     + "a fruit or vegetable."                      52.2%       39.5%          14.7
#     + "a fresh fruit. a fresh vegetable."          50.8%       37.4%          15.1
#     + twenty-eight produce nouns                   53.2%       44.8%          13.2
#
# Extra phrases do not add proposals, they dilute the ones that work: the last row returns fewer
# boxes per scene than the shipped prompt, not more. The same effect explains why nine shape
# words lost fifteen points of recall to three grocery nouns.
#
# A second pass does not dilute the first, because it is a separate forward pass. Naming the
# specific vegetable is also what works: on the one photograph in the cart corpus where every
# item is separately visible, "a fruit or vegetable." lands on none of the six missed produce
# items at the shipped threshold while a list of produce nouns lands on four. Grounding DINO
# grounds concrete nouns and does badly on category words, which is what grounding means.
PRODUCE_PROMPT = (
    "bananas. apples. oranges. lemons. grapes. strawberries. avocados. tomatoes. "
    "potatoes. onions. carrots. lettuce. broccoli. celery. cucumbers. peppers. "
    "mushrooms. garlic. ginger. spinach. cabbage. cauliflower. herbs. leeks. "
    "a melon. a pineapple. pears. sweet potatoes."
)
# The second pass runs higher than the first. It has to: its proposals are kept only where the
# first pass found nothing, so nothing suppresses them, and on a dense produce pile at the first
# pass's threshold it returns 34 boxes on empty ground for six real items.
#
# Two corpora want different values here and 0.30 is the safe one rather than the best one.
#
# On the real trolley the second pass proposes nothing at all at 0.30, and at 0.12 it recovers
# both items a single still misses on the fullest countable photograph: the tomatoes wedged
# between the purple bag and the apples, and a yellow produce bag under the baguette. That takes
# it from 8 of 10 products found to 10 of 10, and adds nothing to the other five photographs.
#
# The same 0.12 wrecks the cart corpus, where mean absolute count error goes from 0.5 items to
# 2.7 and one dense produce haul goes from 12 proposals to 27. `merge_produce` cannot prevent it
# there: its containment test drops a fruit lying inside a box the first pass drew, and on that
# photograph the net bags of onions and potatoes are never proposed at all, so the individual
# onions have nothing to be inside of.
#
# Swept between the two: the trolley gains nothing until 0.12, so there is no intermediate value
# that helps one without the other's failure. 0.30 stays because the corpus it protects has more
# hand-counted evidence behind it, and because the video path already recovers the yellow bag at
# 0.30 by moving the camera, which is what the shipped product does.
PRODUCE_THRESHOLD = 0.30
# A second-pass box overlapping a first-pass box by this much is the same item seen twice, and
# the first pass wins. Everything the second pass contributes therefore lands where the first
# found nothing, which is why it cannot cost a packaged item: across the three cart photographs
# with known produce misses, every packaged item found by one pass survived two.
PRODUCE_OVERLAP = 0.3
# ...and this much *inside* a first-pass box makes it a part of an item already proposed.
#
# Containment rather than overlap, because the two disagree exactly where it matters. A single
# clementine inside a net of clementines has an IoU with the net of about 0.05, so an overlap
# test passes it through and the net arrives as seven fruits. It is one purchasable unit and the
# first pass already drew it. Measured on the produce haul: with an overlap test alone the second
# pass took 7 proposals to 19, splitting one clementine net into seven boxes and one onion net
# into four.
#
# This is the same judgement `degroup` makes in the other direction. There, a box holding several
# separately-proposed items is a group and loses to its members. Here, a box inside an item that
# was proposed as a whole is a part and loses to its container. What settles which way it goes is
# which pass drew it: the grocery prompt is the one that knows a bag of fruit is a thing you buy.
PRODUCE_INSIDE = 0.7

# One box per region, whatever phrase matched it.
NMS_IOU = 0.5
# A box this far inside another is a second proposal on one item, not a neighbour.
NESTED_CONTAINMENT = 0.85
# ...provided the container is not wildly bigger, which would be a whole shelf, not an item.
NESTED_MAX_RATIO = 4.0

# A box holding at least this many other proposals is a group box, not an item: one region drawn
# over a whole trolley, or over a row of cartons alongside boxes for the cartons themselves.
#
# The nesting pass used to catch these by accident, through a size guard that was inverted and
# therefore always fired. Fixing that guard was necessary, because it was also deleting every
# item that had anything standing in front of it, but it handed the group boxes back: a whole
# cart is far more than NESTED_MAX_RATIO times the size of a tin, so the repaired guard protects
# it. Counting members is what separates the two cases. An item being occluded has one thing in
# front of it; a group box has the whole shelf inside it.
# Swept on 150 shelf photographs, because the pass has to remove a trolley box without removing
# a large product that happens to have things in front of it, and those look alike from a
# distance:
#
#     members  containment   recall   precision floor   recall on sparse photographs
#     off               --    41.9%             45.9%                         66.7%
#     3               0.80    41.3%             46.2%                         60.0%
#     5               0.90    41.8%             46.3%                         65.9%
#     8               0.90    41.9%             46.0%                         66.7%
#
# Three members at 80% containment costs 6.7 points on the sparse photographs, which are the ones
# most like a cart, because a large product with a few small ones in front of it matches that
# description. Five at 90% costs 0.8 and still removes the trolley: a whole-cart proposal holds
# ten to twenty-five boxes, so it clears the bar by a wide margin. Eight is indistinguishable
# from switching the pass off, which is what says five is at the edge of what is worth having.
GROUP_MEMBERS = 5
GROUP_CONTAINMENT = 0.90

MAX_POLYGON_VERTICES = 64
SIMPLIFY_EPSILON = 0.004
MAX_INSTANCES = 64
# Measured on 465 labelled instances across 60 RPC scenes (server/eval/sweep_detection.py), not
# chosen by eye on overlays, which is how the previous 0.20 was picked.
#
#     0.18   70% recall   64% precision   1.4  items count error
#     0.20   79%          77%             0.53                    <- was here
#     0.23   86%          89%             0.37                    <- here now
#     0.25   87%          93%             0.63
#     0.30   69%          98%             2.27
#
# 0.25 maximises F1 and 0.23 is the better product. The difference is one point of recall and
# four of precision against 0.26 items per scene on the count, and the count is what a shopper
# actually sees: it is the number of things in their bag against the number in their trolley.
# On the crowded scenes, which is where this matters, the gap is wider still, 0.40 against 1.05.
# Optimising F1 alone would have taken the other one.
#
# The old value was not a cautious choice that gave up accuracy for safety. The plateau runs
# 0.23 to 0.27 and 0.20 sat one step outside it, with 0.18 collapsing to 70% recall and 64%
# precision. This is better than it on all three numbers at once.
#
# A cut expressed as a fraction of the best box in the same photograph was tried, on the theory
# it would survive the move from this corpus to a real cart better than an absolute number. It
# peaked lower, at F1 0.852 against 0.898, with a narrower plateau, so it lost on both counts.
#
# The whole table above was produced with the inverted size guard in `nested` below. With that
# guard fixed, the same threshold on the same 465 instances reads
#
#     0.23   92.9% recall   89.3% precision   0.72 items count error
#
# so the fix is worth 6.9 points of recall and a third of a point of precision, and costs 0.35
# items on the count. That last one is a real regression on this corpus and it is a corpus
# artefact: products laid out on a tray almost never genuinely nest, so the broken guard only
# ever fired on spurious group boxes, where deleting the larger box happens to be right. On
# shelves, where one item standing in front of another is ordinary, the same guard was deleting
# 9 points of real items (server/eval/SHELVES.md). The threshold stays at 0.23 rather than being
# re-tuned, because the corpus that would be doing the tuning is the one that cannot show the
# failure being fixed.
BOX_THRESHOLD = 0.23

def _iou(a, b):
    """Standard IoU on pixel xyxy. Scale free, so it does not matter that these are not
    normalized yet."""
    ox = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    oy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    overlap = ox * oy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - overlap
    return 0.0 if union <= 0 else overlap / union


def _containment(a, b):
    """Fraction of the smaller box covered by the overlap. Deliberately not IoU.

    Two proposals on one bottle score 0.93 to 1.00 here and only 0.23 to 0.63 by IoU, which is
    indistinguishable from two items merely touching. Two genuine neighbours score 0.00. This
    is the measurement that separates "one item proposed twice" from "two items side by side",
    and it is the same rule `fusion.applyCensus` applies to live tracks.
    """
    ox = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    oy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    smaller = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
    return 0.0 if smaller <= 0 else (ox * oy) / smaller


def _area(b):
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def dedupe(boxes, scores, nms_iou=None, containment=None, max_ratio=None, size=None):
    """Collapse the several proposals Grounding DINO makes for one physical item.

    The model scores every query phrase against every region independently and never suppresses
    across phrases, so one cereal box matches "a product", "a box" and "a carton" and arrives as
    three boxes. Measured on five hand-labelled cart photographs, 36 of 94 proposals were a
    second proposal on an item already proposed.

    Two passes, in this order:

      NMS       one box per region, highest DINO score wins, the usual convention
      nesting   of two boxes where one sits inside the other and they are of comparable size,
                the smaller survives
      degroup   a box with several other boxes inside it is a group, and is dropped
      deframe   a box that is nearly the whole frame, with anything inside it, is the container
                and not a thing in it. Needs `size`, and is skipped without it.

    The smaller box winning is right in both cases this fires. Two proposals on one bottle: the
    tighter one is the better outline. One box drawn over a row of four cartons alongside boxes
    for the cartons themselves: keeping the group box would erase three items from the count.

    `NESTED_MAX_RATIO` is what keeps the second pass from eating the scene. A small box inside a
    much larger one is usually two real items, one standing in front of the other, and dropping
    the larger one deletes the item that is being occluded, which is the case the product exists
    to notice. The guard was inverted for its whole life: it compared the smaller box's area
    against four times the larger's, and since the loop visits boxes smallest first that is
    always true, so it never once fired. Measured on 25 shelf photographs, the second pass with
    the broken guard cost 15.5 points of recall and bought 4 points of a precision floor.

    Returns indices into the input, so the caller keeps whatever it had alongside the boxes.
    """
    kept = degroup(nested(nms(boxes, scores, nms_iou), boxes, containment, max_ratio), boxes)
    # `size` is the frame the boxes were drawn on, and without it the fourth pass cannot run:
    # whether a box is the whole picture is not a fact about the box. Optional rather than
    # required so a caller measuring the first three passes in isolation still can.
    return kept if size is None else deframe(kept, boxes, size)


def nms(boxes, scores, nms_iou=None):
    """One box per region, highest score first.

    Split out so the two passes can be measured apart; each was worth a very different amount
    and the pair was only ever measured together.

    The constants are arguments defaulting to the module's values so a sweep can vary them
    through this function rather than through a copy of it. `sweep_detection.py` did hold a
    copy, and the copy carried the same inverted size guard as the original, which is exactly
    why the sweep that chose the threshold could not see the bug in the code it was tuning.
    """
    nms_iou = NMS_IOU if nms_iou is None else nms_iou
    kept = []
    for i in sorted(range(len(boxes)), key=lambda i: -scores[i]):
        if all(_iou(boxes[i], boxes[k]) < nms_iou for k in kept):
            kept.append(i)
    return kept


def nested(kept, boxes, containment=None, max_ratio=None):
    """Of two boxes where one sits inside the other and they are of comparable size, keep the
    smaller. Comparable size is the whole safety of this pass: see `NESTED_MAX_RATIO`."""
    containment = NESTED_CONTAINMENT if containment is None else containment
    max_ratio = NESTED_MAX_RATIO if max_ratio is None else max_ratio
    survivors = []
    for i in sorted(kept, key=lambda i: _area(boxes[i])):
        if not any(
            _containment(boxes[i], boxes[k]) >= containment
            and _area(boxes[i]) <= max_ratio * _area(boxes[k])
            for k in survivors
        ):
            survivors.append(i)
    return survivors


# Grounding DINO reports how well a region matched a text phrase. The contract in `app.py` asks
# for something else: "confidence that this region is one distinct object, not a class score".
# ByteTrack seeds a track only at 0.5 and above, and raw DINO scores on cart photographs run 0.21
# to 0.46, so passing them through unmapped means no track ever starts and the bag comes back
# empty.
#
# This lived inline in `app.py` as a formula in a dict literal, which meant the eval harness had
# to know to reproduce it and did not: the first end-to-end run over 24 cart photographs turned
# 348 regions into 7 tracks, and the cause was this line being absent rather than anything about
# the photographs. It is a function here so that cannot happen again.
DETECTOR_SCORE_FLOOR = 0.55
DETECTOR_SCORE_CEILING = 0.99
DETECTOR_SCORE_SPAN = 0.80


def objectness(score, threshold=None):
    """DINO's text-match score in the units the rest of the pipeline expects."""
    threshold = BOX_THRESHOLD if threshold is None else threshold
    scaled = DETECTOR_SCORE_FLOOR + 0.44 * (score - threshold) / DETECTOR_SCORE_SPAN
    return round(min(DETECTOR_SCORE_CEILING, max(DETECTOR_SCORE_FLOOR, scaled)), 6)


def merge_produce(base, boxes, scores, overlap=None, inside=None):
    """Indices of second-pass boxes that land where the first pass found nothing.

    The first pass owns the frame. A produce proposal that overlaps a box the grocery prompt
    already drew is the same item seen twice and is dropped, so this can only add regions, never
    replace or remove one. That asymmetry is the whole reason a second pass is safe where a
    longer prompt was not: a longer prompt changes what the working phrases find, and every
    produce wording measured cost between eight and ten points of recall doing so.

    Two tests, not one. Overlap catches a second proposal on the same item; containment catches a
    proposal on a *part* of one. A clementine inside a net of clementines fails only the second,
    at an IoU of roughly 0.05 against the net that already holds it.

    Returned as indices rather than boxes so the caller can carry each box's score with it, the
    same contract `dedupe` uses.
    """
    overlap = PRODUCE_OVERLAP if overlap is None else overlap
    inside = PRODUCE_INSIDE if inside is None else inside
    fresh = [
        i for i, box in enumerate(boxes)
        if max((_iou(box, other) for other in base), default=0.0) < overlap
        and max((_inside_of(box, other) for other in base), default=0.0) < inside
    ]
    if not fresh:
        return []
    # De-duplicate the second pass against itself. Twenty-eight nouns describe one onion several
    # ways, and without this a bag of them arrives once per matching noun.
    picked = dedupe([boxes[i] for i in fresh], [scores[i] for i in fresh])
    return [fresh[i] for i in picked]


def degroup(kept, boxes, members=None, containment=None):
    """Drop boxes that are really a region containing several items.

    Measured on 24 cart and haul photographs: without this, a proposal covering the whole trolley
    survives to the shopper's bag as one unit of an item that does not exist, and it is the
    single largest box in the frame so it is the first thing the census is asked about.

    Deliberately not a cap on box area. A close-up of one product legitimately fills the frame,
    and 1.5% of labelled instances in the shelf corpus exceed 40% of theirs. What identifies a
    group is not that it is large, it is that the things inside it were separately proposed.
    """
    members = GROUP_MEMBERS if members is None else members
    containment = GROUP_CONTAINMENT if containment is None else containment
    survivors = []
    for i in kept:
        inside = sum(
            1 for k in kept
            if k != i
            and _area(boxes[k]) < _area(boxes[i])
            and _inside_of(boxes[k], boxes[i]) >= containment
        )
        if inside < members:
            survivors.append(i)
    return survivors


FRAME_COVERAGE = 0.9
# A proposal covering at least this much of the frame, with at least this many other proposals
# inside it, is the container rather than a thing in it.
FRAME_MEMBERS = 1


def deframe(kept, boxes, size, coverage=None, members=None, containment=None):
    """Drop a proposal that is the frame itself: the trolley, not the shopping in it.

    `degroup` already removes a box drawn over several items, and on a loaded trolley that is
    enough. On a nearly empty one it is not, because it needs GROUP_MEMBERS separately-proposed
    items inside before it fires and an empty trolley does not contain five of anything.
    Photographed from inside the basket with one cauliflower in it, the detector proposes the
    cauliflower and the whole frame, and the frame survives to the shopper's bag as a phantom
    item. Measured on ten photographs of a real trolley being loaded: every one of the four
    sparse ones carried a box covering 95% to 98% of the frame, and no other photograph in the
    set carried a box above 16.3%.

    Area alone cannot be the test. A shopper holding one item up to the camera fills the frame
    with it deliberately, and that has to keep working: 29 of the 84,743 labelled instances in
    the shelf corpus cover more than 90% of their photograph, and every one of them is a
    close-up of a real product. What separates the two cases is not the size of the box, it is
    whether something else was proposed inside it. A trolley contains the shopping. A cauliflower
    held up to the lens contains nothing.

    One member is enough here, where `degroup` needs five, because the frame-coverage test has
    already done most of the work of identifying a container.
    """
    coverage = FRAME_COVERAGE if coverage is None else coverage
    members = FRAME_MEMBERS if members is None else members
    containment = NESTED_CONTAINMENT if containment is None else containment
    frame = max(float(size[0]) * float(size[1]), 1e-9)
    survivors = []
    for i in kept:
        if _area(boxes[i]) / frame < coverage:
            survivors.append(i)
            continue
        inside = sum(
            1 for k in kept
            if k != i and _inside_of(boxes[k], boxes[i]) >= containment
            and _area(boxes[k]) < _area(boxes[i])
        )
        if inside < members:
            survivors.append(i)
    return survivors


def _inside_of(inner, outer):
    """Fraction of `inner` that lies within `outer`. Directional, unlike IoU."""
    area = _area(inner)
    if area <= 0:
        return 0.0
    ox = max(0.0, min(inner[2], outer[2]) - max(inner[0], outer[0]))
    oy = max(0.0, min(inner[3], outer[3]) - max(inner[1], outer[1]))
    return (ox * oy) / area
