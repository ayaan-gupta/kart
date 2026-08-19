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

## Why a supervised detector does not replace it

The obvious objection to renting a GPU is that a small supervised detector runs on the phone
for free. Measured on the five held photographs, against 92 hand-labelled units, counting only
proposals that are neither a whole-frame box nor nested inside another:

| detector | usable proposals | recall | where it can run |
|---|---|---|---|
| YOLOv8 trained on retail shelves | 13 | 14% | phone |
| YOLO11x COCO, every class kept | 27 | 29% | phone |
| **Grounding DINO, tuned (below)** | **68** | **74%** | GPU |

A supervised detector only fires on what it was trained on. COCO found the bananas, the
broccoli and the bottles, which are COCO classes, and missed every milk carton, cereal box and
crisp packet. The shelf model collapsed outright: shelf photographs are upright, front-facing
and evenly spaced, and a cart is piled, angled and shot from above. SKU-110K is shelf imagery
and inherits that gap, so training on it does not close this.

Beating a grounded detector here needs annotated photographs of carts, which do not exist in
any licensed corpus this project can use.

## What tuning the prompt and deduplicating bought

Grounding DINO's weakness on carts is precision, not recall. The original configuration
proposed 94 boxes for 92 labelled units, which looked close, but 5 covered more than half the
frame and 36 were a second proposal on an item already proposed, leaving 53 usable.

| configuration | boxes | whole-frame | duplicates | usable | recall |
|---|---|---|---|---|---|
| original prompt, no suppression | 94 | 5 | 36 | 53 | 58% |
| + class-agnostic NMS | 80 | 3 | 16 | 61 | 66% |
| + drop nested boxes | 65 | 0 | 0 | 65 | 71% |
| **+ container words removed** | **68** | **0** | **0** | **68** | **74%** |
| single query phrase | 55 | 0 | 0 | 55 | 60% |
| box threshold raised to 0.30 | 24 | 0 | 0 | 24 | 26% |

Two causes, both in the configuration rather than the model. The prompt asked for "a bag", "a
package", "a container" and "a tray", and a shopping trolley is all four. And Grounding DINO
scores every query phrase against every region independently without suppressing across
phrases, so one cereal box matches "a product", "a box" and "a carton" and arrives three times.

Raising the threshold instead is the tempting fix and it is the wrong one: it removes real
items faster than duplicates, which is why the last row loses two thirds of the recall.

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
