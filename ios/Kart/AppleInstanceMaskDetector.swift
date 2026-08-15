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
    let score = min(1, max(0, observation.confidence))

    return MaskContour.instances(
      from: observation.instanceMask,
      minPixelFraction: minPixelFraction,
      simplifyEpsilon: simplifyEpsilon
    ).map { DetectedInstance(box: $0.box, polygon: $0.polygon, score: score) }
  }
}
