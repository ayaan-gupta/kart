"""The parts of the enumerator that are not a deployment.

`app.py` cannot be imported without Modal credentials: it builds a `modal.Volume` at module
scope, which reaches the network. Everything in this file is pure, so the eval harness can hold
the detector to the same prompt, the same threshold and the same de-duplication the service
runs, instead of re-implementing them and measuring something adjacent to what ships.

Nothing here imports modal, torch, or anything that loads a model.
"""


# Container words are deliberately absent. A shopping trolley is a container, a bag and a
# package, and asking for those returned a box covering more than half the frame on 4 of 5
# measured photographs. Those proposals reached the shopper's bag as "shopping cart frame"
# before `isProduct` existed to reject them, and they still cost a badge and a prompt line.
# Removing the words is what stopped them being proposed at all: 5 whole-frame boxes to 0.
GROCERY_PROMPT = (
    "a product. a box. a bottle. a carton. a can. a jar. fruit. a vegetable. a tub."
)

# One box per region, whatever phrase matched it.
NMS_IOU = 0.5
# A box this far inside another is a second proposal on one item, not a neighbour.
NESTED_CONTAINMENT = 0.85
# ...provided the container is not wildly bigger, which would be a whole shelf, not an item.
NESTED_MAX_RATIO = 4.0

MAX_POLYGON_VERTICES = 64
SIMPLIFY_EPSILON = 0.004
MAX_INSTANCES = 64
# Measured on 465 labelled instances across 60 scenes (server/eval/sweep_detection.py), not
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


def dedupe(boxes, scores):
    """Collapse the several proposals Grounding DINO makes for one physical item.

    The model scores every query phrase against every region independently and never suppresses
    across phrases, so one cereal box matches "a product", "a box" and "a carton" and arrives as
    three boxes. Measured on five hand-labelled cart photographs, 36 of 94 proposals were a
    second proposal on an item already proposed.

    Two passes, in this order:

      NMS       one box per region, highest DINO score wins, the usual convention
      nesting   of two boxes where one sits inside the other, the smaller survives

    The smaller box winning is right in both cases this fires. Two proposals on one bottle: the
    tighter one is the better outline. One box drawn over a row of four cartons alongside boxes
    for the cartons themselves: keeping the group box would erase three items from the count.

    Returns indices into the input, so the caller keeps whatever it had alongside the boxes.
    """
    order = sorted(range(len(boxes)), key=lambda i: -scores[i])
    kept = []
    for i in order:
        if all(_iou(boxes[i], boxes[k]) < NMS_IOU for k in kept):
            kept.append(i)

    survivors = []
    for i in sorted(kept, key=lambda i: _area(boxes[i])):
        if not any(
            _containment(boxes[i], boxes[k]) >= NESTED_CONTAINMENT
            and _area(boxes[k]) <= NESTED_MAX_RATIO * _area(boxes[i])
            for k in survivors
        ):
            survivors.append(i)
    return survivors
