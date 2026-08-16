# The grounded enumerator

Finds the regions in a captured cart frame. Everything else about recognition runs in the
recognition service; this runs on a GPU because it has to.

## Why this is a separate service

`docs/detector-decision.md` and `docs/enumeration-recall.md` carry the measurements. The short
version, on ten real cart photographs with 92 hand-labelled items:

| enumerator | items covered | outlines | where it can run |
|---|---|---|---|
| Apple foreground instance mask | 1 region per photo, 0 items | one blob | phone |
| the model's own boxes | 0.902 | boxes only | no new infrastructure |
| the model's boxes, cropped and segmented on device | 0.739 | real, 76% of boxes | phone |
| the model's boxes refined by SAM | 0.478 | real | GPU |
| **Grounding DINO, refined by SAM** | **0.924, 0.869 refined** | **real** | **GPU** |

Nothing that runs on a phone produces outlines worth drawing. That is what this service is for.

## The contract

```
POST  { "image": "<base64 jpeg>" }
200   { "instances": [ { "box": {"x":0,"y":0,"w":0,"h":0},
                         "polygon": [x0,y0,x1,y1,...],
                         "score": 0.55 } ] }
```

Boxes and polygons are normalized to the frame, origin top-left. `score` is confidence that the
region is **one distinct object**, not a class score, and it must be at or above 0.5 for anything
the enumerator stands behind: `ByteTrack` will not seed a track below that, and passing Grounding
DINO's raw text-match score through unmapped produced zero tracks and an empty bag on every
photograph tried. `app.py` documents the mapping it uses.

Any host satisfying this contract works. `app.py` is written for Modal because Modal is one file
and a decorator; Replicate and fal want the same two functions wrapped their own way.

## Deploying it

```bash
modal deploy server/enumerator/app.py
```

Modal prints a URL. Put it in the recognition service's environment:

```bash
ENUMERATOR_URL=https://<your-app>.modal.run
ENUMERATOR_TOKEN=<only if your host wants a bearer token>
```

The SAM2.1 tiny checkpoint needs to be on the image at `/models/sam2.1_hiera_tiny.pt`. Add a
Modal volume, or bake it in with a `.run_commands("wget ...")` step, whichever you prefer.

## Running without it

Leaving `ENUMERATOR_URL` unset is a supported state, not a broken one. The census still names
every product it can see through `unmarkedItems`, which measured 72% of hand-labelled units on
real photographs with no usable detector at all. The bag fills; it has no outlines and no per
item photographs in it. `/api/census` reports `"enumeration": "degraded"` so the client knows.
