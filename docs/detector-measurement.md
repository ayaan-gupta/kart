# Choosing the detector

The on-device detector is chosen by measurement, not by argument. This is how.

## Run it

    npm run bench:detector -- --input server/eval/corpus/images --output /tmp/kart-bench

You need real photographs of loaded carts in `server/eval/corpus/images`, shot the way the app
will see them: from above, items stacked, nothing tidied up for the camera.

## Read it

Open the annotated PNGs first. The numbers are meaningless until you have seen where the
outlines actually landed. Then compare against the ground truth in
`server/eval/corpus/ground-truth.json`.

| Signal | What it tells you |
|---|---|
| `instanceCount` versus the true item count | Whether the detector sees items or sees one pile |
| Annotated overlay | Whether outlines are on items or on shadows, cart mesh and floor |
| `detectMs` | Whether it can run at three detections per second on a phone |
| `points` per instance | Whether outlines are usable shapes or noise |
| `sharp` | The real range for tuning `minSharpness` in `keyframe.ts` |
| `motion` | Only meaningful for consecutive video frames. See below |
| `score` | Whether the detector clears ByteTrack's `highThreshold` at all |

`score` deserves a paragraph, because it is the difference between the app working and the app
detecting nothing whatsoever. ByteTrack seeds a track only from a detection scoring at or above
`highThreshold` (0.5), and discards anything under `lowThreshold` (0.1). A detector that reports
one flat confidence for every instance is therefore an all-or-nothing switch: if that number
lands under 0.5 no track is ever created, on every device, forever, and the symptom is an app
that simply never sees anything. Read this column on the first run. The `KartDetector` protocol
requires a detector with no meaningful per-instance confidence to report at or above the
tracker's high threshold, and `AppleInstanceMaskDetector` clamps to satisfy it, so this column
shows the clamped value the tracker actually receives.

`motion` is a comparison against the previous image in the folder, because that is what the
metric is. There is no such thing as the motion of a single still. Run over a folder of
unrelated cart photos the number is noise, and over photos of differing sizes it pins to 1.0 by
design. It becomes a real measurement only when the input is consecutive frames pulled from a
video of an actual scan, which is the one way to tune `maxMotion` that this branch offers. The
first image in any run reports 1.0, because there is nothing before it.

## Decide

**Apple's segmenter is enough** if it finds most items with outlines on the right things. Ship
it. Nothing is added to the binary and there is no licence to buy.

**It is not enough** if it collapses the cart into a few blobs. Then a Core ML detector goes in
behind the same `KartDetector` protocol, which is a contained change: no tracker, pipeline, or
UI code moves.

Two candidates, and the licence is the deciding factor between them:

- **YOLOE**, open vocabulary over 1200-plus LVIS and Objects365 categories, which includes the
  packaged goods a COCO-trained model has never heard of. Released under AGPL-3.0. Shipping it
  inside a closed-source app means buying a commercial licence from Ultralytics or Roboflow.
  **This has to be settled before it goes in a build, not after.**
- **A permissively licensed model**, Apache-2.0, no fee. SAM-family models segment anything
  regardless of category but tend to over-segment, splitting one cereal box into several
  pieces. RF-DETR-Seg is Apache-2.0 but COCO-trained, so out of the box it misses most packaged
  goods and would need fine-tuning on a grocery dataset.

## Caveats worth keeping in mind

- The harness runs on the Mac against still images, where orientation is always upright. It
  **cannot** catch a mask that comes back in raw sensor orientation on device. That only shows
  up on hardware, as outlines rotated or mirrored away from the items. The single place to fix
  it is the normalization in `MaskContour.instances`.
- Timings on a Mac are not phone timings. Treat `detectMs` as a ranking between detectors, not
  as a budget.
- The bench computes `sharp` and `motion` by holding a `FrameMetrics` and calling `measure` once
  per image, which is exactly what the frame processor plugin does per frame. That is on purpose
  and worth keeping. An earlier version measured sharpness over the full-resolution grayscale
  image while the device measured it over a decimated sample, and this table told the reader the
  bench numbers were the range to tune `minSharpness` against. The two disagreed by factors from
  0.76x to under 0.01x depending on image content, so no correction factor could have existed.
  Any future edit that recomputes a metric here instead of calling `FrameMetrics` reopens that.
- Apple's segmenter reports one confidence for the whole observation, so every instance carries
  the same score and ByteTrack's second-stage recovery never engages. A detector with real
  per-instance scores would enable it.
- A jagged mask edge does not always simplify down on its own. One smoke test against a
  non-cart image produced a single 9168-point outline at the default `simplifyEpsilon =
  0.004`. `MaskContour.simplify` now enforces a 64-vertex ceiling per instance, escalating
  epsilon first and falling back to uniform decimation only if escalation cannot converge,
  so a future measurement cannot repeat that number. Still read the `points` column, not
  only `instanceCount`, when judging a result: an outline sitting at the cap is still a
  messier shape than one that settled well under it, even though neither can exceed 64
  points anymore.
