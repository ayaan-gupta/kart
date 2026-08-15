// ios/Kart/AppleInstanceMaskDetector.swift
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO
import Vision

/// `KartDetector` backed by `VNGenerateForegroundInstanceMaskRequest` (iOS 17 and later).
///
/// Chosen as the first implementation because it costs nothing to ship, adds nothing to the
/// binary, and carries no licence obligation, not because it is known to be the best. Apple
/// describes it as segmenting "salient objects that can be separated from the background",
/// which is a weaker promise than enumerating every item in a stacked cart. Whether it holds
/// up is exactly what the benchmark in this task exists to find out.
public final class AppleInstanceMaskDetector: KartDetector {
  public let name = "apple-instance-mask"

  private let minPixelFraction: Double
  private let simplifyEpsilon: Double

  public init(minPixelFraction: Double = 0.002, simplifyEpsilon: Double = 0.004) {
    self.minPixelFraction = minPixelFraction
    self.simplifyEpsilon = simplifyEpsilon
  }

  // Measured on macOS 26.5.2 / Xcode 26.3, 2026-08-15, with a standalone harness (not part of
  // this repo) building synthetic 1920x1080 and 1080x1920 images with shapes at known pixel
  // positions and running VNGenerateForegroundInstanceMaskRequest on each, across
  // orientations .up/.right/.left. Full numbers in
  // .superpowers/sdd/2026-08-13-kart-on-device-detection/vision-mask-geometry-report.md.
  //
  // - `observation.instanceMask` was 512x512 in every run, regardless of source dimensions,
  //   aspect ratio, or orientation. Its aspect ratio (1.0) essentially never matches a real
  //   camera frame's (1920x1080 = 1.78, 1080x1920 = 0.5625), so raw `instanceMask` cannot be
  //   read as though it shared the frame's aspect ratio.
  // - Content inside that 512x512 grid is not letterboxed or cropped: a shape touching the
  //   source's left/top/right/bottom edge touches the mask's corresponding edge too, and a
  //   shape's raw-mask bounding box normalized by 512 matches its true frame-normalized
  //   position to within about 0.002 (roughly one mask pixel), the resolution limit of the
  //   512-pixel grid. That is: Vision maps the oriented frame into the square via an
  //   independent, non-uniform stretch per axis, not a uniform aspect-preserving resize. This
  //   makes `MaskContour`'s existing normalize-by-the-mask's-own-dimensions arithmetic
  //   numerically equivalent to normalizing by the frame's dimensions, but that equivalence
  //   depends on an undocumented Vision implementation detail (no letterboxing) that Apple does
  //   not promise to keep, which is why this code does not rely on it.
  // - `generateScaledMaskForImage(forInstances:from:)` returns a buffer whose dimensions equal
  //   the *oriented* frame (matching `KartVisionFrameProcessorPlugin`'s own `swapsDimensions`
  //   computation): 1920x1080 for `.up`, 1080x1920 for `.right`/`.left` on a 1920x1080 source.
  //   Its content is correctly rotated for the orientation passed to the handler: a shape's
  //   position in the returned buffer matches the position you get by rotating the shape's raw
  //   sensor-space position the way `CGImagePropertyOrientation` defines that orientation, not
  //   the raw unrotated sensor position. So the mask is already in oriented/upright space, not
  //   sensor space, confirming the no-flip assumption elsewhere in this file needs no change.
  // - Calling `generateScaledMaskForImage(forInstances:from:)` with the *full* instance
  //   IndexSet at once merges every requested instance into one undifferentiated foreground
  //   region (single label, no per-instance separation): measured pixel count matched the sum
  //   of the individual instances' areas. Calling it once per single-label IndexSet instead
  //   returns one correctly-scaled, correctly-positioned binary mask per instance. That is the
  //   API's real per-instance contract, and it is what `detect` below relies on. Measured cost
  //   on this machine: about 1 to 3 ms per single-instance call, so a worst-case 64-instance
  //   frame adds roughly 70 to 175 ms; this Mac is not the iPhone the app ships on, but the
  //   call only runs for instances that already passed `minPixelFraction`, keeping the common
  //   case far below the 64-instance ceiling.
  public func detect(
    pixelBuffer: CVPixelBuffer,
    orientation: CGImagePropertyOrientation
  ) throws -> [DetectedInstance] {
    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(
      cvPixelBuffer: pixelBuffer, orientation: orientation, options: [:])
    try handler.perform([request])

    guard let observation = request.results?.first else { return [] }

    // Apple exposes one confidence for the whole observation and none per instance, so every
    // instance carries the same score. The practical consequence is that ByteTrack's
    // second-stage recovery pass never engages under this detector: with no score spread there
    // are no low-confidence detections to recover from. A Core ML detector would supply real
    // per-instance scores and light that stage up. Do not paper over this by inventing a score
    // out of mask area; a fabricated confidence is worse than an honest constant one.
    //
    // The clamp to the tracker's high threshold is that same honest-constant principle, not a
    // departure from it. This value carries no per-instance information whatever it is, so the
    // only question it can answer is the one the tracker actually asks: may this detection seed
    // a track. Passing the raw observation confidence through would leave that answer to a
    // number Apple never promised anything about, where a single dip under 0.5 turns the whole
    // app into one that detects nothing. Reporting the floor states plainly what this detector
    // means, which is "I have no ranking to offer, treat every instance as trackable", and it
    // takes nothing away: with one flat score there was no ranking to lose. It stays a
    // constant, and it is still not fabricated per-instance evidence.
    let score = max(
      KartDetectorScore.trackerHighThreshold, min(1, max(0, observation.confidence)))

    // The raw `instanceMask` is read once, only to decide which labels are large enough to
    // keep (see the measurement above: it is a fixed 512x512 grid, cheap to scan). Each kept
    // label is then rescanned individually through `generateScaledMaskForImage(forInstances:
    // from:)`, which is the only way measured to get a mask sized to the oriented frame without
    // depending on the "no letterboxing" assumption a raw-mask-only reading would require. This
    // is why `handler` is kept alive past `perform(_:)`: `generateScaledMaskForImage` needs it.
    guard let raw = MaskContour.labels(from: observation.instanceMask) else { return [] }
    let candidates = MaskContour.selectCandidates(
      labels: raw.labels, width: raw.width, height: raw.height,
      minPixelFraction: minPixelFraction)

    var out: [DetectedInstance] = []
    out.reserveCapacity(candidates.count)

    for candidate in candidates {
      guard
        let scaledMask = try? observation.generateScaledMaskForImage(
          forInstances: IndexSet(integer: candidate.label), from: handler),
        let decoded = MaskContour.labels(from: scaledMask),
        let instance = MaskContour.traceIsolatedInstance(
          labels: decoded.labels, width: decoded.width, height: decoded.height,
          index: candidate.label, simplifyEpsilon: simplifyEpsilon)
      else { continue }

      out.append(DetectedInstance(box: instance.box, polygon: instance.polygon, score: score))
    }

    return out
  }
}
