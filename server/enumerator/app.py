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

# The prompt, the thresholds and the de-duplication live in `regions.py`, which imports nothing
# and therefore can be imported by the eval harness. Re-exported here so this file reads as it
# did and so `from app import dedupe` keeps working.
import regions  # noqa: E402
from regions import (  # noqa: E402
    BOX_THRESHOLD,
    GROCERY_PROMPT,
    MAX_INSTANCES,
    MAX_POLYGON_VERTICES,
    NESTED_CONTAINMENT,
    NESTED_MAX_RATIO,
    NMS_IOU,
    PRODUCE_PROMPT,
    PRODUCE_THRESHOLD,
    SIMPLIFY_EPSILON,
    dedupe,
    merge_produce,
)


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
    # Deploying uploads this file; a sibling module is not carried along with it. Without this
    # line the container would import `regions` and fail on its first request, in a deployment
    # that built cleanly.
    .add_local_file(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "regions.py"),
        remote_path="/root/regions.py",
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

        def ground(text, cut):
            inputs = self.proc(images=pil, text=text, return_tensors="pt").to(self.device)
            with self.torch.no_grad():
                outputs = self.dino(**inputs)
            res = self.proc.post_process_grounded_object_detection(
                outputs, inputs.input_ids, threshold=cut, text_threshold=cut,
                target_sizes=[pil.size[::-1]])[0]
            return (res["boxes"].cpu().numpy().tolist(),
                    [float(s) for s in res["scores"].cpu()])

        boxes, scores = ground(GROCERY_PROMPT, BOX_THRESHOLD)

        # Deduplicate before segmenting, not after: every proposal dropped here is one SAM
        # forward pass and one badge saved, and duplicates are a third of what DINO returns.
        if boxes:
            keep = dedupe(boxes, scores, size=pil.size)
            keep.sort(key=lambda i: -scores[i])
            keep = keep[:MAX_INSTANCES]
            boxes, scores = [boxes[i] for i in keep], [scores[i] for i in keep]

        # A second pass for loose produce, which the grocery prompt does not see and which no
        # wording of a single prompt recovers: every produce phrase added to the prompt above
        # cost between eight and ten points of shelf recall, because extra phrases dilute the
        # working ones rather than adding to them. A separate forward pass does not.
        #
        # Its boxes are kept only where the first pass found neither an item nor the container of
        # one, so it can add regions and never remove or replace one. Measured on 100 shelf
        # photographs it is a literal no-op, recall and precision identical to three decimal
        # places, because a packaged-goods shelf has no loose produce for it to find. Measured on
        # the six cart photographs where every item can be counted by hand, it takes items
        # counted correctly from 32 of 43 to 38 of 43 and mean absolute count error from 1.8
        # items to 0.5.
        #
        # The cost is a second DINO forward pass per keyframe. SAM still runs once, over the
        # merged set.
        produce_boxes, produce_scores = ground(PRODUCE_PROMPT, PRODUCE_THRESHOLD)
        for i in merge_produce(boxes, produce_boxes, produce_scores):
            if len(boxes) >= MAX_INSTANCES:
                break
            boxes.append(produce_boxes[i])
            scores.append(produce_scores[i])

        if not boxes:
            return {"instances": []}
        boxes = np.asarray(boxes, dtype=np.float32)

        self.sam.set_image(img)
        with self.torch.no_grad():
            masks, _, _ = self.sam.predict(box=boxes, multimask_output=False)
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
                # See `regions.objectness`: DINO's text-match score is not the objectness the
                # rest of the pipeline is specified in, and handing it over unmapped means no
                # track ever starts.
                "score": regions.objectness(score),
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
