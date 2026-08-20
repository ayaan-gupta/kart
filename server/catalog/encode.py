"""
Image encoders, and the one descriptor no encoder provides.

Which encoder to use was an open question worth measuring rather than inheriting. MobileCLIP-S2
is what the published comparison recommended, on the grounds that it is small enough to run on
a phone. That reasoning does not apply to this pipeline: the crops are already on a GPU service
beside the detector, so a larger encoder costs latency and nothing else.

The colour entry is not a network. Keypoint matching (geometry.py) runs on greyscale, and every
encoder here pools colour into a global average, so nothing else in the pipeline can see that
two packets share a layout and differ in the colour of one panel. That is the flavour-variant
case, and it is the most common way a shortlist puts the wrong product first.

Everything returns L2-normalized rows, so cosine similarity is a dot product downstream.
"""
import numpy as np

# name -> (loader, model id, pretrained tag)
ENCODERS = {
    "mobileclip": ("open_clip", "MobileCLIP-S2", "datacompdr"),
    "siglipb16": ("open_clip", "ViT-B-16-SigLIP", "webli"),
    "vitl14": ("open_clip", "ViT-L-14", "datacomp_xl_s13b_b90k"),
    "dinov2b": ("hf", "facebook/dinov2-base", None),
    "color": ("color", None, None),
}

BATCH = 128

# Colour signature geometry: a 3x3 grid of cells, each an 8-hue by 4-saturation histogram.
# Coarse deliberately. Fine bins would make the descriptor sensitive to the lighting the catalog
# was shot under, which is exactly the thing that must not decide a match.
COLOR_GRID = 3
COLOR_HUE = 8
COLOR_SAT = 4


def device():
    import torch

    if torch.cuda.is_available():
        return "cuda"
    return "mps" if torch.backends.mps.is_available() else "cpu"


def open_clip_visual(name):
    """The vision tower on its own, plus its evaluation transform.

    Exposed separately because fine-tuning needs the module itself, not a closure over it, and
    because a fine-tuned index has to load its own weights back into that module rather than the
    pretrained ones.
    """
    import open_clip

    loader, model_id, pretrained = ENCODERS[name]
    if loader != "open_clip":
        raise ValueError(f"{name} is not an open_clip encoder")
    model, _, preprocess = open_clip.create_model_and_transforms(model_id, pretrained=pretrained)
    return preprocess, model.visual.to(device()).eval()


def _load_open_clip(model_id, pretrained, state=None):
    import open_clip
    import torch

    model, _, preprocess = open_clip.create_model_and_transforms(model_id, pretrained=pretrained)
    visual = model.visual
    if state is not None:
        visual.load_state_dict(state)
    visual = visual.to(device()).eval()

    def prepare(images):
        return torch.stack([preprocess(i) for i in images])

    def encode(batch):
        with torch.no_grad():
            return visual(batch)

    return prepare, encode


def _load_hf(model_id, _pretrained, state=None):
    if state is not None:
        raise ValueError("fine-tuned weights are only supported for open_clip encoders")

    import torch
    from transformers import AutoImageProcessor, AutoModel

    processor = AutoImageProcessor.from_pretrained(model_id)
    model = AutoModel.from_pretrained(model_id).to(device()).eval()
    projected = hasattr(model, "get_image_features")

    def prepare(images):
        # One processor call for the whole batch. Per image it costs more than the forward pass.
        return processor(images=images, return_tensors="pt")["pixel_values"]

    def encode(batch):
        with torch.no_grad():
            out = (
                model.get_image_features(pixel_values=batch)
                if projected
                else model(pixel_values=batch)
            )
        if torch.is_tensor(out):
            return out
        # Some models return a wrapper even from the projected head, and which one varies by
        # transformers version, so unwrap by what is present rather than by model name.
        hidden = out.last_hidden_state
        # CLS carries the global summary, the mean patch carries local texture. Concatenating
        # both is the standard retrieval recipe: two variants of one product differ in exactly
        # the local detail CLS discards.
        return torch.cat([hidden[:, 0], hidden[:, 1:].mean(dim=1)], dim=-1)

    return prepare, encode


def _load_color(_model_id, _pretrained, state=None):
    import cv2
    import torch

    def signature(image):
        array = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2HSV)
        array = cv2.resize(array, (96, 96), interpolation=cv2.INTER_AREA)
        step = 96 // COLOR_GRID
        cells = []
        for row in range(COLOR_GRID):
            for col in range(COLOR_GRID):
                cell = array[row * step : (row + 1) * step, col * step : (col + 1) * step]
                hist = cv2.calcHist(
                    [cell], [0, 1], None, [COLOR_HUE, COLOR_SAT], [0, 180, 0, 256]
                ).ravel()
                # Normalized per cell, so a bright cell cannot drown a dim one. Where the
                # colour sits matters more than how much of it there is.
                cells.append(hist / max(hist.sum(), 1e-6))
        return np.concatenate(cells).astype(np.float32)

    def prepare(images):
        return torch.from_numpy(np.stack([signature(i) for i in images]))

    return prepare, lambda batch: batch


LOADERS = {"open_clip": _load_open_clip, "hf": _load_hf, "color": _load_color}


def load(name, state=None):
    """Returns (prepare, encode). `state` replaces the pretrained weights with fine-tuned ones."""
    if name not in ENCODERS:
        raise KeyError(f"unknown encoder {name}; have {sorted(ENCODERS)}")
    loader, model_id, pretrained = ENCODERS[name]
    return LOADERS[loader](model_id, pretrained, state)


def embed(images, prepare, encode):
    """L2-normalized float32 rows for a list of PIL images."""
    import torch

    if not len(images):
        # An empty batch is a legitimate call, not a mistake: a frame where the detector found
        # nothing. Without this it fails inside numpy with "need at least one array to
        # concatenate", which says nothing about what went wrong.
        return np.zeros((0, 0), dtype=np.float32)

    out = []
    for start in range(0, len(images), BATCH):
        batch = prepare(images[start : start + BATCH]).to(device())
        vectors = encode(batch).float()
        out.append(torch.nn.functional.normalize(vectors, dim=-1).cpu().numpy())
    return np.concatenate(out).astype(np.float32)
