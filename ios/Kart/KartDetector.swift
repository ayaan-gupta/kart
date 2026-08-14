// ios/Kart/KartDetector.swift
import CoreGraphics
import CoreVideo
import ImageIO

/// One class-agnostic object proposal.
///
/// The detector answers "how many distinct things are here, and what shape is each". It never
/// answers "what is it". Naming belongs to the cloud layer, which is far better at it, and
/// keeping the two apart is what lets the detector be swapped on measurement alone.
public struct DetectedInstance {
  /// Normalized to the frame, origin top-left.
  public let box: CGRect
  /// Flat `[x0, y0, x1, y1, ...]`, normalized to the frame, origin top-left.
  public let polygon: [Float]
  /// Confidence that this region is one distinct object, 0 to 1. Not a class score.
  public let score: Float

  public init(box: CGRect, polygon: [Float], score: Float) {
    self.box = box
    self.polygon = polygon
    self.score = score
  }
}

/// The single seam between "find the shapes" and everything else.
///
/// Nothing above this protocol may know which model produced the instances. That is what makes
/// the choice between Apple's segmenter and a bundled Core ML model a measurement outcome
/// rather than an architectural commitment.
public protocol KartDetector {
  /// A short, stable identifier used in benchmark output, for example "apple-instance-mask".
  var name: String { get }

  func detect(
    pixelBuffer: CVPixelBuffer,
    orientation: CGImagePropertyOrientation
  ) throws -> [DetectedInstance]
}
