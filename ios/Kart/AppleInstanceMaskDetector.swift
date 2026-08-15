// ios/Kart/AppleInstanceMaskDetector.swift
import CoreGraphics
import CoreVideo
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

    return MaskContour.instances(
      from: observation.instanceMask,
      minPixelFraction: minPixelFraction,
      simplifyEpsilon: simplifyEpsilon
    ).map { DetectedInstance(box: $0.box, polygon: $0.polygon, score: score) }
  }
}
