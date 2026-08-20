"""
The grounded enumerator, as a deployable service.

This is the piece that cannot live anywhere else. Apple's segmenter returns one whole-cart blob
per photograph, the model's own boxes are placed too loosely to refine into outlines, and
cropping each box and segmenting it on device loses 16 points of coverage. Grounding DINO's
boxes are the only ones measured that refine cleanly (0.924 covered, 0.869 after refinement),
and it is a 700MB PyTorch model with a text encoder: not a phone, and not a serverless function.

Deployed here as a Modal app because Modal is one file and a decorator. Replicate and fal want
the same two functions wrapped their own way; the contract below is what matters, not the host.

Contract, matching server/src/enumerate.ts:

    POST  { "image": "<base64 jpeg>" }
    200   { "instances": [ {
              "box": {x,y,w,h},
              "polygon": [x0,y0,x1,y1,...],
              "score": 0..1,
              "catalog": {                        # only when a store catalog is mounted
                "sku": "..." | null,              # null below the matcher's floor
                "confidence": 0..1,
                "alternatives": [ {"sku": "...", "score": 0.0} ]
              }
            } ] }

Boxes and polygons are normalized to the frame with origin top-left, which is the convention
every other coordinate in this codebase uses.

The catalog field is what turns naming from open-world description into a choice among the
products this store actually sells. It is absent when no catalog has been uploaded, which is the
configuration that shipped: enumerate.ts parses it either way and the census falls back to naming
in the open world. A null sku with a populated alternatives list is not a failure, it is the
matcher declining to name something it is not sure of, and those alternatives are what the
shopper gets asked about.
"""
import base64
import io
import os

import modal

MODEL_DIR = "/models"
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


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.8.0", "torchvision", "transformers>=4.45", "timm",
        "opencv-python-headless", "pillow", "numpy",
        # The catalog matcher's encoder. Only needed when a catalog is mounted, but installed
        # unconditionally because a container that fails on first request rather than at build
        # time is far harder to diagnose.
        "open_clip_torch",
        "git+https://github.com/facebookresearch/sam2.git",
    )
    .add_local_dir(
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "catalog"),
        remote_path="/root/catalog",
    )
)

# Where a store's built index lives, if one has been uploaded. Absent is the configuration that
# shipped and stays supported: regions come back with no catalog field and the census names them
# in the open world, which is the same degraded mode enumerate.ts already handles for an
# unconfigured enumerator.
CATALOG_VOLUME = modal.Volume.from_name("kart-catalog", create_if_missing=True)
CATALOG_INDEX = "/catalog/index.npz"

app = modal.App("kart-enumerator", image=image)


@app.cls(gpu="A10G", scaledown_window=300, volumes={"/catalog": CATALOG_VOLUME})
class Enumerator:
    @modal.enter()
    def load(self):
        import torch
        from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.proc = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-base")
        self.dino = AutoModelForZeroShotObjectDetection.from_pretrained(
            "IDEA-Research/grounding-dino-base").to(self.device)

        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
        self.sam = SAM2ImagePredictor(build_sam2(
            "configs/sam2.1/sam2.1_hiera_t.yaml",
            os.path.join(MODEL_DIR, "sam2.1_hiera_tiny.pt"),
            device=self.device, apply_postprocessing=False))

        # Loaded once per container, because an index is tens of megabytes of features and a
        # head, and reloading it per request would dominate the request.
        self.matcher = None
        if os.path.exists(CATALOG_INDEX):
            from catalog.matcher import Index, Matcher

            self.matcher = Matcher(Index.load(CATALOG_INDEX))
            print(f"catalog loaded: {len(self.matcher.index.skus)} SKUs")

    def _polygon(self, mask, w, h):
        """Largest external contour, simplified the way ios/Kart/MaskContour.swift simplifies."""
        import cv2
        import numpy as np

        contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if not contours:
            return None
        contour = max(contours, key=cv2.contourArea)
        eps = SIMPLIFY_EPSILON * max(w, h)
        approx = cv2.approxPolyDP(contour, eps, True)
        while len(approx) > MAX_POLYGON_VERTICES:
            eps *= 1.5
            approx = cv2.approxPolyDP(contour, eps, True)
        if len(approx) < 3:
            return None
        return [round(float(v), 6) for p in approx.reshape(-1, 2) for v in (p[0] / w, p[1] / h)]

    @modal.fastapi_endpoint(method="POST")
    def enumerate_regions(self, body: dict):
        import numpy as np
        from PIL import Image

        pil = Image.open(io.BytesIO(base64.b64decode(body["image"]))).convert("RGB")
        img = np.array(pil)
        h, w = img.shape[:2]

        inputs = self.proc(images=pil, text=GROCERY_PROMPT, return_tensors="pt").to(self.device)
        with self.torch.no_grad():
            outputs = self.dino(**inputs)
        res = self.proc.post_process_grounded_object_detection(
            outputs, inputs.input_ids, threshold=BOX_THRESHOLD, text_threshold=BOX_THRESHOLD,
            target_sizes=[pil.size[::-1]])[0]

        boxes = res["boxes"].cpu().numpy()
        scores = [float(s) for s in res["scores"].cpu()]
        if len(boxes) == 0:
            return {"instances": []}

        # Deduplicate before segmenting, not after: every proposal dropped here is one SAM
        # forward pass and one badge saved, and duplicates are a third of what DINO returns.
        keep = dedupe(boxes.tolist(), scores)
        keep.sort(key=lambda i: -scores[i])
        keep = keep[:MAX_INSTANCES]
        boxes, scores = boxes[keep], [scores[i] for i in keep]

        self.sam.set_image(img)
        with self.torch.no_grad():
            masks, _, _ = self.sam.predict(box=boxes.astype(np.float32), multimask_output=False)
        masks = np.asarray(masks)
        if masks.ndim == 4:
            masks = masks[:, 0]
        elif masks.ndim == 3 and len(boxes) == 1:
            masks = masks[None, 0]

        instances = []
        for mask, score in zip(masks, scores):
            binary = mask > 0.0
            if not binary.any():
                continue
            polygon = self._polygon(binary, w, h)
            if polygon is None:
                continue
            ys, xs = np.nonzero(binary)
            x0, x1 = xs.min() / w, (xs.max() + 1) / w
            y0, y1 = ys.min() / h, (ys.max() + 1) / h
            instances.append({
                "box": {"x": round(float(x0), 6), "y": round(float(y0), 6),
                        "w": round(float(x1 - x0), 6), "h": round(float(y1 - y0), 6)},
                "polygon": polygon,
                # DINO reports a text-match confidence. KartDetector asks for something else:
                # "confidence that this region is one distinct object, not a class score", and
                # ByteTrack only seeds a track at 0.5 or above. Raw, every proposal on every cart
                # photograph tried scored 0.21 to 0.46, so no track ever started and the bag came
                # back empty. This maps the surviving set into the contract's units while keeping
                # DINO's own ranking, so the tracker's low-score recovery pass still has spread.
                "score": round(min(0.99, max(0.55, 0.55 + 0.44 * (score - BOX_THRESHOLD) / 0.80)), 6),
            })

        # Matched after the instances are final, not before. Boxes whose mask yields no usable
        # polygon are dropped above, and matching the pre-filter list would offset every
        # shortlist by however many were dropped ahead of it.
        if self.matcher is not None and instances:
            for instance, match in zip(
                instances, self.matcher.match_regions(pil, [i["box"] for i in instances])
            ):
                if match is not None:
                    instance["catalog"] = {
                        "sku": match["sku"],
                        "confidence": round(float(match["confidence"]), 6),
                        "alternatives": [
                            {"sku": a["sku"], "score": round(float(a["score"]), 6)}
                            for a in match["alternatives"]
                        ],
                    }

        return {"instances": instances}
