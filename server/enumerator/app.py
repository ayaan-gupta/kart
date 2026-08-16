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
    200   { "instances": [ { "box": {x,y,w,h}, "polygon": [x0,y0,x1,y1,...], "score": 0..1 } ] }

Boxes and polygons are normalized to the frame with origin top-left, which is the convention
every other coordinate in this codebase uses.
"""
import base64
import io
import os

import modal

MODEL_DIR = "/models"
GROCERY_PROMPT = (
    "a product. a box. a bottle. a carton. a bag. a can. a jar. a package. "
    "fruit. a vegetable. a container. a tub. a tray."
)

MAX_POLYGON_VERTICES = 64
SIMPLIFY_EPSILON = 0.004
MAX_INSTANCES = 64
BOX_THRESHOLD = 0.20

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.8.0", "torchvision", "transformers>=4.45", "timm",
        "opencv-python-headless", "pillow", "numpy",
        "git+https://github.com/facebookresearch/sam2.git",
    )
)

app = modal.App("kart-enumerator", image=image)


@app.cls(gpu="A10G", scaledown_window=300)
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

        order = np.argsort(scores)[::-1][:MAX_INSTANCES]
        boxes, scores = boxes[order], [scores[i] for i in order]

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

        return {"instances": instances}
