# Cart recognition rebuild: open-vocabulary VLM pipeline

Date: 2026-08-12
Status: Approved for planning
Supersedes: `2026-08-10-live-camera-scan-design.md` (recognition layer only; the persistence
layer from that spec stays as-is)

## Problem

The shipped recognition pipeline does not work. Tested on a physical device with a real cart,
it recognizes essentially nothing except bananas, and it counts a single bunch of bananas as
several bunches. Three independent structural faults cause this, and none of them are tuning
problems:

1. **The "find" stage cannot enumerate.** `VNGenerateObjectnessBasedSaliencyImageRequest` is an
   attention model, not an object detector. It returns a small number of "what stands out"
   blobs, and `KartVisionFrameProcessorPlugin.swift` then caps that at `.prefix(3)`. A cart
   holding fifteen items structurally cannot yield more than three regions per frame, and
   those regions are not object instances.

2. **The "read" stage has no brand vocabulary.** `VNClassifyImageRequest` returns labels from a
   fixed generic taxonomy of roughly 1300 hypernyms (`food`, `produce`, `banana`). It can never
   return "Cheerios" or "Froot Loops". `labelCatalog.ts` attempts to compensate by mapping
   `bottle` to five candidate SKUs and disambiguating with `.fast`-level OCR over a small
   region of interest, which in practice almost never produces tokens that match a catalog
   name.

3. **Counting inflates on tracker churn.** Saliency boxes jitter between frames. When IoU drops
   below the `0.3` match threshold in `tracker.ts`, the tracker creates a *new* candidate, which
   independently reaches `locked` and fires `addDetection` again. Because `aggregate()` sums
   lock events, one physical bunch of bananas becomes a quantity of two or three. Nothing
   reconciles item identity globally.

A fourth, smaller fault: `evaluateCoverageHint` is not occlusion detection. It is a four second
idle timer with no perception behind it, so its hint is uncorrelated with whether anything is
actually hidden.

The catalog is also a hard ceiling on correctness. It holds 50 hardcoded SKUs, so the best
possible outcome for a box of Froot Loops is to be mislabeled as "Honey Nut Oat Cereal".

## Goals

- Identify real grocery products at brand level ("Kellogg's Froot Loops, family size"), open
  vocabulary, not constrained to a fixed catalog.
- Enumerate every distinct item in a loaded cart, not three.
- Count each physical item exactly once. One bunch of bananas is quantity one, and two
  identical bags of chips are quantity two.
- Items confidently identified and counted are tinted green along their own silhouette, with a
  small check mark.
- Items identified with low confidence are tinted amber, and a banner asks the user to move
  closer to them. This resolves itself automatically once confidence rises.
- When items are stacked or occluded, tell the user, based on real perceptual signal rather
  than a timer.
- Recognition quality is measurable, not vibes. An offline eval harness scores precision and
  recall against real cart photos.

## Non-goals (this pass)

- Android. The detector, barcode path, and native frame plumbing are iOS-only for now.
- ARKit 3D anchoring. Designed for, deliberately deferred. See "Deferred by design".
- Training a custom model on Kart's own product photography.
- Real price data. See "Open questions".
- Accounts, sync, or server-side cart history.

## Key research findings that shape this design

**VLMs name well and localize badly.** Studies of VLM grounding consistently report bounding
boxes that are hallucinated, imprecise, and inconsistent between similar frames, with decoders
defaulting to large boxes under low confidence. Asking a VLM for coordinates would fix the
naming problem and break the overlay.

**Set-of-Mark prompting sidesteps this.** Overlaying numbered marks on regions and asking the
model to label mark N beats fully-finetuned grounding models on frontier proprietary models. It
does not transfer to open-source VLMs, which is acceptable here. The model never regresses a
coordinate.

**VLMs fail at cross-view instance correspondence.** Multi-image studies report a pronounced
accuracy drop as the number of images containing the object of interest grows, with
double-counting as a named failure mode. Therefore we never ask the model to reconcile an
inventory across viewpoints. Cross-view identity is our code's job.

**Prior art:** Amazon's Dash Cart, with fixed cameras and an integrated scale, still requires
shoppers to type a PLU code or pick from a list for produce, and leans on barcodes for
packaged goods. Mashgin reaches 99.9% using nine cameras, which says accuracy comes from many
viewpoints rather than one perfect one. We have one camera that moves, so viewpoints accumulate
over time instead of simultaneously.

## Architecture

Three layers, each doing only what it is reliable at.

```
every frame (~12Hz), on device
  VNDetectBarcodesRequest ─► UPC hit ─► Open Food Facts ─► identified, green, no VLM call
  YOLOE-seg (Core ML) ─► instance masks ─► ByteTrack ─► stable tracks ─► overlay @60fps

keyframe (~every 2s), gated on sharpness + stillness
  SoM composite (numbered masks burned onto downscaled frame)
     ─► POST /api/census ─► gpt-5.4-mini, reasoning_effort: none
        └─ per-mark labels, per-view counts, occlusion assessment

low-confidence tracks only
  tight high-res crop ─► POST /api/identify ─► gpt-5.4, reasoning_effort: low
```

### Layer 1: on-device detection and tracking

**Detector: YOLOE-seg, exported to Core ML.** YOLOE does open-vocabulary detection *and*
instance segmentation, accepts a text-prompt vocabulary, and has a prompt-free mode covering
1200+ LVIS and Objects365 categories rather than COCO's 80. Critically it re-parameterizes its
open-vocabulary modules into the main network at inference, so it costs the same FLOPs as a
closed-set YOLO of the same size. Segmentation rather than plain detection because the product
requirement is to tint the item's silhouette, not a rectangle.

The detector is used **class-agnostically**. We take its masks and ignore its labels; naming is
the VLM's job. Its only responsibility is answering "how many distinct things are here, and
what shape is each".

**Tracker: ByteTrack.** Two-stage association (high-confidence detections first, then recovery
from low-confidence ones) with Kalman motion prediction. This replaces the naive
greedy-IoU matcher and is the direct fix for jitter-induced track fragmentation.

**Barcode fast path.** `VNDetectBarcodesRequest` runs on every frame. A decoded UPC resolves
through Open Food Facts (free, no API key, ODbL, requires attribution) and yields a certain
identification with no VLM call. Expected to cover only a minority of items in a real cart,
since most products land label-down or buried, but it is nearly free and it is ground truth
when it fires.

> **This reverses a documented product decision.** The 2026-08-10 spec explicitly listed
> barcode scanning as a non-goal: "the product goal is items being recognized visually, the way
> a person would recognize them, not scanned." The reversal is narrow: this is an invisible
> accelerator, never a UX. The user is never asked to find, aim at, or scan a barcode, and
> nothing about the interaction changes. It is gated behind `ENABLE_BARCODE_FAST_PATH` so it can
> be switched off without touching the pipeline if the product call stands.

### Layer 2: cloud recognition

Two endpoints, both on Vercel, both holding the OpenAI key server-side. The app ships no
credentials.

**`POST /api/census`** takes a downscaled keyframe (1024px long edge) with numbered marks burned
onto the tracked masks, plus a text list of `{markId, bbox}` so the model can cross-check mark
association. Model `gpt-5.4-mini` at `reasoning_effort: "none"`, which is near-instant and keeps
output to just the JSON. Structured outputs with a strict schema, so the client never parses
free text.

Returns per mark: `name`, `brand`, `size`, `category`, `confidence`, `needsCloserLook`. Plus
`unmarkedItems` for things the detector missed, `inViewCounts` per product type, and
`occlusionAssessment`.

**`POST /api/identify`** takes a tight high-resolution crop of a single low-confidence item.
Model `gpt-5.4` at `reasoning_effort: "low"`. A cropped cereal box at full resolution is both
cheaper and more accurate than a full frame at full resolution.

**Keyframe gating.** Variance-of-Laplacian sharpness plus a stillness check run on device, and
only frames passing both are uploaded. Blurry frames are simultaneously the most expensive to
get wrong and the most common, so this improves accuracy and cuts cost together.

**Prompt caching.** Stable system prompt first, volatile image content last. Cached input is
$0.075/1M on mini and $0.25/1M on gpt-5.4.

### Layer 3: fusion and the counting rule

This is the load-bearing part of the design.

- **Quantity is keyed on stable track IDs.** One track is one physical item. Quantity of a
  product is the number of distinct tracks carrying that identity. It is **never** a running
  sum of lock events, which is the current bug.
- **The VLM's in-view count clamps over-segmentation.** If the tracker holds three tracks in a
  region but the model looking at that single frame reports one bunch of bananas, the tracks
  collapse to one. Counting a handful of objects inside one image is something VLMs do
  reliably; this uses that and nothing more.
- **Cross-view merging happens in our code**, keyed on track identity, never delegated to the
  model. This is the documented VLM failure mode and we route around it.

Because tracks are spatially distinct, items spread across different viewpoints still
accumulate correctly, while the clamp prevents one item from becoming several.

Track state machine: `pending -> identified(low) -> identified(high) -> counted`.

### UI behavior

| State | Rendering | Trigger |
|---|---|---|
| Counted | Green mask tint, small check | Identity at or above green threshold, present in `inViewCounts` |
| Low confidence | Amber mask tint | Below threshold, or model set `needsCloserLook` |
| Occluded | Banner only | See below |

The "move closer" banner appears once an amber track persists past roughly 1.5s, so it does not
flicker on transient dips, and retracts automatically when a crop call resolves the item.

Occlusion combines three signals rather than a timer:
- **Semantic:** the model's `occlusionAssessment` from the census call. Judging whether a scene
  looks stacked is genuine visual reasoning and is a good fit for a VLM.
- **Geometric:** pairwise mask overlap ratio between tracks indicates stacking.
- **Coverage:** the fraction of cart-basket interior explained by identified masks versus
  unaccounted texture.

**Guided multi-angle capture.** The scan UI nudges the user around the cart the way Face ID
enrollment does. This is the single-camera translation of Mashgin's nine-camera rig: viewpoints
accumulate over time. It doubles as the occlusion remedy, since moving the camera is what
reveals hidden items, and it gives the tracker parallax.

## Cost and latency

| Tier | Model | Effort | Cadence | Per call |
|---|---|---|---|---|
| Census | `gpt-5.4-mini` | `none` | ~2s | ~$0.0033 |
| Crop | `gpt-5.4` | `low` | amber items only | ~$0.0031 |

Roughly **4 to 6 cents per cart scan** at eight census calls and five crops. Image tokenization
is patch-based at 32px: a 1024x768 frame is 768 patches times the 1.62 mini multiplier, about
1244 tokens. `gpt-5.5` ($5/$30) stays available as an escalation tier for stubborn items.

Latency budget: overlay is driven entirely on device, so network round trips never block
rendering. Census results arrive asynchronously and update labels in place.

## What gets deleted

- The saliency and classify path in `KartVisionFrameProcessorPlugin.swift`
- `src/engine/liveVision/labelCatalog.ts` (obsolete under open vocabulary)
- `src/engine/liveVision/labelMatcher.ts` (OCR-overlap matching, obsolete)
- `src/engine/liveVision/coverageHint.ts` (timer heuristic, replaced)
- `aggregate()`'s sum-of-detections counting in `store.ts`

`CATALOG` stops being a whitelist and becomes a cache of products seen, keyed by a stable
product key, holding the last known name and optional price.

## Testing

- **Unit:** tracker identity through jitter and occlusion, with an explicit regression test for
  the duplicate-bananas bug; the counting rule including the in-view clamp; occlusion scoring;
  SoM mark placement and mark-to-track mapping.
- **Contract:** strict schema validation of both endpoints against golden fixtures, so a model
  or prompt change that breaks shape fails in CI rather than on device.
- **Eval harness:** a directory of real cart photos with hand-written ground-truth item lists,
  scored for precision and recall on the census call. Without this we are tuning blind, which is
  how the current pipeline shipped looking plausible and detecting nothing.
- **Device:** live behavior can only be confirmed on hardware. Verified by screenshots.

## Deferred by design

**ARKit 3D anchoring.** The scene is rigid and the camera moves, which is exactly the case
ARKit's visual-inertial odometry handles. Detection to hit-test to `worldTransform` to
`ARAnchor` is a documented pattern. Anchoring items in 3D would make identity survive large
viewpoint changes, reproject at 60fps with zero ML cost, and turn cross-view entity resolution
into geometry rather than heuristics, which is precisely the weakness the multi-view research
exposes.

Deferred because ARKit and `react-native-vision-camera` both require exclusive camera control,
so adopting it means writing a custom Swift `RCTViewManager` around `ARSession` and dropping
vision-camera from the scan screen (`react-native-arkit` has been unmaintained for eight years).
The position-tracking layer is kept behind an interface so this can be swapped without touching
fusion logic.

**EdgeTAM** (16 FPS on an iPhone 15 Pro Max, 22x faster than SAM2) as memory-based mask
propagation, if occlusion re-identification proves to be the bottleneck.

## Risks

| Risk | Mitigation |
|---|---|
| YOLOE-seg may under-segment a densely stacked cart viewed from above; LVIS is not a top-down cart distribution | Spike is task one, before anything is built on it. Fallback is seeding tracks from model-returned points on the first keyframe |
| Barcode coverage in a real cart is unmeasured | Treated as an accelerator only; nothing depends on it |
| Mark-to-label association can fail when marks are dense or ambiguous | Cap marks per frame, place labels at mask centroids with collision avoidance, and send the bbox list as text for cross-checking |
| Open-vocabulary names are unstable across calls ("Froot Loops" vs "Kellogg's Froot Loops") | Normalize to a product key; treat the catalog cache as the canonical display name once seen |
| Cost per scan grows if keyframe gating is too permissive | Gate on sharpness and stillness; cap census calls per session |

## Open questions

1. **Prices.** Open vocabulary means no authoritative price. Options are a model estimate
   flagged approximate, blank until a real price source is wired, or hiding totals for the MVP.
   Not blocking the pipeline work; needs a product call before the bag UI is finalized.
2. **Cart photos.** The spike and the eval harness both need 10 to 20 photos of real loaded
   carts, including stacked and awkward cases. This is the one input that cannot be substituted.
