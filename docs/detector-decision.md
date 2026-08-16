# Detector decision: capture then process

Decided 2026-08-16 on measured evidence, and re-decided the same day after the live-tracking
alternative was built and measured rather than assumed. Supersedes the Apple instance mask
detector.

The short version: **live per-item segmentation of a whole cart is not affordable on a phone
with anything licensable today, so the app captures a frame and processes it.** Everything
above the detector survives unchanged, which is most of the work.

## What was measured, in order

### Apple's free Vision requests cannot enumerate cart items

Ten real, openly licensed photographs of loaded carts.

| Candidate | Result | Verdict |
|---|---|---|
| `VNGenerateForegroundInstanceMaskRequest` | 1 instance every photo, 0 of roughly 100 items | dead |
| Objectness saliency | 1, sometimes 2, whole-cart blobs | dead |
| Attention saliency | 1, often nearly the whole frame | dead |
| Contours | 6 to 43 kept, dominated by cart mesh, no item separation | dead |
| Rectangles | 14 to 23, mostly cars, shelving, pavement, zero produce recall | dead |

Proven three ways: synthetic scenes (8 touching objects returned 1), a 25-cell contact sheet of
real products (returned 1), and the ten cart photographs (1 every time).

### SAM works, and is far too slow to run per frame

SAM2.1-tiny under Apple's Core ML conversion reaches 56% mean recall, up to 90% on box-dense
carts. Encoder alone is 340 to 400ms on an M4 Pro, cheapest useful configuration 595ms.
Projected 6x to 30x over a 300ms phone frame budget. Seeded prompting made recall worse (21%).

### The licence sweep killed everything faster

- **EdgeSAM**: 38.7 FPS on an iPhone 14 with official Core ML, the best on-device numbers found
  anywhere. NTU S-Lab License 1.0, non-commercial, read from the LICENSE file. Would need a
  negotiated agreement.
- **FastSAM**: claims Apache in its README, is actually AGPL-3.0, relicensed deliberately by
  Ultralytics in commit 279ceab, two copyright holders to clear.
- **MobileSAM, NanoSAM, EfficientSAM, EfficientViT-SAM**: all Apache-2.0, none with a measured
  iPhone number, only MobileSAM with any Core ML port and that one third party.
- **SAM2 streaming**: propagation re-runs the full image encoder every frame, confirmed by
  reading `sam2_video_predictor.py`, and its feature cache holds exactly one frame.

### EdgeTAM cleared licensing, so it was built and measured

Apache-2.0 for code and weights both, verified from the LICENSE file, the GitHub API, the README
and the Hugging Face card. No acceptable-use policy, no usage cap. Meta reports 15.7 FPS for the
full video segmentation pipeline on an iPhone 15 Pro Max against 0.7 FPS for SAM2-B+, measured
with Xcode's performance tool (arXiv 2501.07256, Table 2 and Appendix C).

That looked like it put live outlines back on the table. It does not, for three independent
reasons, each measured here rather than inferred.

**1. Cost is linear in the number of tracked objects.** EdgeTAM under PyTorch on MPS, tracking a
synthetic handheld pan built from `wm_full_from_above`, seeded from its own automatic mask
generator:

| objects | ms/frame | vs 1 object | mask IoU | survival |
|---|---|---|---|---|
| 1 | 133.6 | 1.00x | 0.927 | 1.00 |
| 2 | 242.3 | 1.81x | 0.927 | 1.00 |
| 4 | 488.6 | 3.66x | 0.933 | 1.00 |
| 8 | 1061.1 | 7.94x | 0.954 | 1.00 |
| 16 | 1909.3 | 14.3x | 0.945 | 1.00 |
| 24 | 3081.3 | 23.1x | 0.937 | 1.00 |

23.1x the cost for 24x the objects. The image encoder runs once per frame and is amortised, but
memory attention and the mask decoder run per object and dominate everything else. The tracking
is genuinely good, mask IoU near 0.94 with essentially nothing lost even at 24 objects. EdgeTAM
is not inaccurate. It is unaffordable at cart scale, and Meta's 15.7 FPS is a single-object
figure that scales to roughly 0.8 FPS for a 20-item cart on the same phone.

**2. The shipped Core ML export cannot track at all.** `coreml/export_to_coreml.py` exports three
models: image encoder, prompt encoder, mask decoder. There is no memory attention and no memory
encoder, and the image encoder wrapper adds `no_mem_embed`, which is SAM2's explicit no-memory
path. `coreml/inference_example.py` names its class `EdgeTAMVideoTracker` and the README calls it
real-time tracking; it re-encodes each frame and re-runs the same fixed points with `mask_input`
zeroed, with no memory bank and no propagation. It is per-frame image segmentation with a static
point prompt. The README's benchmark (PyTorch 40.1ms against Core ML 39.2ms, IoU 0.989) measures
that image path on synthetic data and is not a tracking number.

Shipping EdgeTAM tracking on iOS therefore means exporting memory attention and the memory
encoder, the recurrent parts with a growing memory bank, which is exactly what neither Apple nor
Meta shipped.

**3. The multi-object path crashes.** `sam2/modeling/perceiver.py:298` calls
`.expand(B, -1, -1).view(-1, 1, C)`, and `expand` returns a non-contiguous view, so `.view`
raises whenever B exceeds 1. B is the object count. Patching it to `.reshape` fixes it and is
semantics-preserving, verified by tracking one object alone and then inside a batch of four and
getting IoU exactly 1.0000 on every frame. That this ships broken says the multi-object path is
not exercised upstream, which is consistent with the headline FPS being a single-object figure.

### Apple's object tracker is cheap, and holds for about a third of a second

`VNTrackObjectRequest` at `.accurate`, one request per instance through one
`VNSequenceRequestHandler`, seeded from the same enumeration masks and scored against the same
ground truth. Aggregate over all ten carts, up to 32 objects each:

| frames since seed | seconds at 15fps | mean box IoU | fraction at or above 0.7 |
|---|---|---|---|
| 1 | 0.07 | 0.903 | 0.98 |
| 2 | 0.13 | 0.791 | 0.82 |
| 3 | 0.20 | 0.780 | 0.81 |
| 5 | 0.33 | 0.711 | 0.67 |
| 8 | 0.53 | 0.624 | 0.51 |
| 15 | 1.00 | 0.578 | 0.46 |

Cost is 18 to 40ms per frame for up to 32 objects, sublinear in object count, against EdgeTAM's
3081ms for 24. Roughly 100x cheaper.

There is a hard ceiling: **32 simultaneous trackers**. 32 succeeds, 33 fails with
`Exceeded maximum allowed number of Trackers for a tracker type: VNObjectTrackerRevision2Type`,
bisected exactly. Older revisions were documented at 16, so the app must handle the error rather
than assume any number.

So Apple's tracker keeps an outline convincingly locked for about a fifth of a second and
acceptably for about a third. That is enough to stop an overlay looking frozen while a capture is
processed. It is not enough to replace re-enumeration, and re-enumeration costs seconds.

## The decision

**Capture then process.** The user frames the cart, the app captures, and results come back after
a short think. Several captures accumulate into one bag.

1. It removes the latency problem instead of managing it. On one captured frame, 600ms to 2s is
   fine. At 3fps it is not, and nothing licensable closes that gap.
2. **The fusion layer already accumulates across keyframes.** The high-water-mark counting rule
   was built to combine several views of one cart, so a user-triggered capture is just a keyframe
   with a different trigger and the architecture barely changes.
3. Nothing above the detector is affected. Green and amber states, the check mark, the counting
   rule, coaching copy, guided capture and the bag with real photographs all survive as built.
4. No shipping product does live per-item segmentation from a handheld phone. Amazon Dash Cart,
   Just Walk Out, Instacart Caper, Veeve, Shopic, Imagr and Trigo all use cart-fixed or
   store-fixed multi-camera rigs, usually with weight sensors. Amazon Lens Live is the closest
   handheld analogue and solves the easier single-object search problem. The absence is evidence.

Apple's tracker earns a narrow, honest job: hold the outlines steady during the capture and the
wait, so the overlay tracks small hand movement instead of freezing. Not live scanning.

## What this costs

Live outlines while panning are gone. That was the appealing part of the EdgeTAM revision, and it
did not survive measurement.

## The enumerator still needs somewhere to run

Capture-then-process removes the frame budget, which is what makes a heavy enumerator thinkable
at all. It does not answer where that enumerator runs. Grounding DINO base, the only thing
measured that produces boxes tight enough to refine into outlines, is a 700MB PyTorch model with
a text encoder: not a phone, and not a standard serverless function.

One route out was tested and failed. If the phone could turn the model's own boxes into shapes,
the product would need no detector and no new infrastructure. Cropping each box and running
`VNGenerateForegroundInstanceMaskRequest` on the crop, which is a far easier question than
separating twenty touching items in one frame, costs about 25ms per box and loses 16 points of
coverage (0.902 to 0.739), with a quarter of boxes yielding no mask at all. See
`enumeration-recall.md`.

Decided 2026-08-16: **a hosted grounded enumerator**, which is what measured best and what the
pipeline run used. The recognition service calls it over HTTP; `server/src/enumerate.ts` is the
only code that knows it exists, and `server/enumerator/` carries the deployable and its contract.

The transition that followed:

- `/api/census` accepts a frame with no marks. That means "you find them", and it is what the
  capture path sends. A request that does bring its own marks behaves exactly as before, so the
  on-device path and the captured path coexist.
- The response carries the geometry back, because the device never had it. Without that there is
  nothing to outline and nothing for the tracker to follow.
- `RecognitionSession.onCapture` turns those regions into tracks with `minHits: 1`. A capture is
  one deliberate, authoritative look rather than a frame that might be detector noise, so there
  is nothing for a second sighting to corroborate, and requiring three would draw the whole cart
  as still forming.
- Everything above the detector is untouched, which is what the decision promised: the same
  tracker, the same high-water-mark counting rule, the same green and amber states, the same bag.

With no enumerator configured the census still names what it can see through `unmarkedItems`,
measured at 72% of hand-labelled units on real photographs. That is a supported degraded mode,
reported as `"enumeration": "degraded"`, not a failure.

## What is still unproven

- Everything above runs on a Mac. No number here was measured on a phone.
- Enumeration recall is now measured rather than eyeballed, against one labelled point per item.
  See `enumeration-recall.md`. The short version is that it was worse than the 56% quoted here
  (38% of items isolated), that tuning the thresholds alone lifts it to 64%, and that none of
  that survives a realistic badge budget, which is what makes a grounded detector the better
  enumerator.
- The synthetic pans have no parallax, so nothing ever becomes newly visible or newly hidden, and
  no item ever enters the frame. Occlusion change is the one thing they cannot test, and it is
  the case the counting rule cares most about.
- Whether EdgeTAM's automatic mask generator beats SAM2.1-tiny's 56%. The overlays look
  comparable, and both fragment products into parts (a bottle and its cap, a box and its label),
  which the census layer already tolerates because the model's `inViewCounts` clamps the count.

## The long-term path, if training is ever on the table

**RF-DETR-Seg** (Roboflow, Apache-2.0 verified): first-party Swift SDK, Core ML export targeting
the Neural Engine, and a segmentation head. iPhone latency unmeasured. Would need single-class
objectness fine-tuning, for which SKU-110K (1.7M densely packed retail products under one class)
is the established dataset. A model trained to propose whole products rather than parts would fix
enumeration recall and fragmentation together, which is the actual ceiling here.
