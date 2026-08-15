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
  ///
  /// See the score contract on `KartDetector.detect` before setting this. It is not a free
  /// diagnostic field: the tracker gates on it, and the wrong constant here means the app
  /// detects nothing at all.
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

  /// Returns one instance per distinct object found in the frame.
  ///
  /// **The score contract.** ByteTrack seeds a new track only from a detection scoring at or
  /// above its high threshold, and discards anything below its low threshold, currently 0.5 and
  /// 0.1 in `src/engine/liveVision/byteTrack.ts`. A detector that reports one flat confidence
  /// for every instance is therefore not supplying a ranking, it is throwing a switch: land
  /// under 0.5 and no track is ever seeded, on every device, forever, with no partial failure
  /// and no diagnostic. The symptom is an app that detects nothing, which is indistinguishable
  /// from a broken camera, an empty cart, or the over-counting defect this whole plan exists to
  /// fix.
  ///
  /// So: a detector with no meaningful per-instance confidence **must** report at or above
  /// `KartDetectorScore.trackerHighThreshold`. A detector with real per-instance confidences
  /// reports them as they are, and gets ByteTrack's second-stage recovery pass for free.
  func detect(
    pixelBuffer: CVPixelBuffer,
    orientation: CGImagePropertyOrientation
  ) throws -> [DetectedInstance]
}

/// The one number the score contract is written against.
///
/// Duplicated from `DEFAULT_CONFIG.highThreshold` in `src/engine/liveVision/byteTrack.ts`
/// because Swift cannot read it, and named here rather than written as a bare literal at the
/// one call site so that the next detector has somewhere to look. If the JavaScript threshold
/// moves, this moves with it.
public enum KartDetectorScore {
  public static let trackerHighThreshold: Float = 0.5
}
