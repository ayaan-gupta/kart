// ios/Kart/KartVisionFrameProcessorPlugin.swift
import CoreVideo
import Vision
import VisionCamera

/// `Frame.orientation` is a `UIImage.Orientation` describing the rotation needed to make the raw
/// sensor buffer appear upright. `VNImageRequestHandler` wants the equivalent
/// `CGImagePropertyOrientation`. The two enums are NOT raw-value compatible (their cases are
/// ordered differently), so this needs an explicit mapping rather than a cast.
private extension CGImagePropertyOrientation {
  init(_ uiOrientation: UIImage.Orientation) {
    switch uiOrientation {
    case .up: self = .up
    case .upMirrored: self = .upMirrored
    case .down: self = .down
    case .downMirrored: self = .downMirrored
    case .left: self = .left
    case .leftMirrored: self = .leftMirrored
    case .right: self = .right
    case .rightMirrored: self = .rightMirrored
    @unknown default: self = .up
    }
  }

  /// True when making the buffer upright swaps its width and height.
  var swapsDimensions: Bool {
    switch self {
    case .left, .leftMirrored, .right, .rightMirrored: return true
    default: return false
    }
  }
}

@objc(KartVisionFrameProcessorPlugin)
public class KartVisionFrameProcessorPlugin: FrameProcessorPlugin {

  /// The one place a concrete detector is named. Swapping in a Core ML detector, once the
  /// benchmark says to, is a change to this line and nothing else.
  private let detector: KartDetector = AppleInstanceMaskDetector()
  private let metrics = FrameMetrics()

  public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]!) {
    super.init(proxy: proxy, options: options)
  }

  public override func callback(
    _ frame: Frame, withArguments arguments: [AnyHashable: Any]?
  ) -> Any? {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(frame.buffer) else {
      return Self.empty(width: 0, height: 0, error: "frame carried no image buffer")
    }

    let orientation = CGImagePropertyOrientation(frame.orientation)
    let width = orientation.swapsDimensions ? frame.height : frame.width
    let height = orientation.swapsDimensions ? frame.width : frame.height

    // Everything that went wrong this frame, joined into one message. Two independent things
    // can fail, and either one alone produces a frame that reports nothing.
    //
    // A detector that throws on every frame and an empty cart must not look the same. `try?`
    // collapsed them, and on the phone there is no report.json to check afterwards: both
    // present as an app that quietly finds nothing, which is also what a working detector aimed
    // at an empty cart looks like, and what a detector scoring under the tracker's threshold
    // looks like. Several causes, one symptom, no way to tell them apart. The message rides
    // back with the frame so the JavaScript side can say which one it is.
    var problems: [String] = []

    let measured = metrics.measure(pixelBuffer: pixelBuffer)
    if let metricsError = measured.error { problems.append(metricsError) }

    var instances: [DetectedInstance] = []
    do {
      instances = try detector.detect(pixelBuffer: pixelBuffer, orientation: orientation)
    } catch let thrown {
      problems.append("\(detector.name): \(thrown)")
    }

    let error = problems.isEmpty ? nil : problems.joined(separator: "; ")

    var barcodes: [[String: Any]] = []
    if (arguments?["barcodes"] as? Bool) ?? false {
      barcodes = Self.readBarcodes(pixelBuffer: pixelBuffer, orientation: orientation)
    }

    return [
      "instances": instances.map { instance in
        [
          "box": Self.box(instance.box),
          // Bridged as Double rather than Float: JSI numbers are doubles, and converting once
          // here avoids a per-element boxing surprise on the JavaScript side.
          "polygon": instance.polygon.map { Double($0) },
          "score": Double(instance.score),
        ] as [String: Any]
      },
      "barcodes": barcodes,
      "sharpness": measured.sharpness,
      "motion": measured.motion,
      "width": width,
      "height": height,
      // VisionCamera's JSI bridge turns NSNull into `undefined`, and the shape guard in
      // frameProcessor.ts normalizes that to null. Plain data either way: no Vision type, no
      // NSError, just a string a maintainer can read out of a device log.
      "error": error ?? NSNull(),
    ]
  }

  private static func empty(width: Int, height: Int, error: String?) -> [String: Any] {
    [
      "instances": [], "barcodes": [], "sharpness": 0.0, "motion": 1.0,
      "width": width, "height": height, "error": error ?? NSNull(),
    ]
  }

  /// `MaskContour` computes this box directly from mask pixel rows, never through Vision's
  /// normalized reporting, so it is already origin top-left. No flip here.
  private static func box(_ rect: CGRect) -> [String: Any] {
    ["x": rect.minX, "y": rect.minY, "w": rect.width, "h": rect.height]
  }

  /// Vision reports normalized boxes with origin bottom-left. Everything above the native
  /// boundary uses origin top-left, so the flip happens here, once, for observations that come
  /// straight from a Vision request (barcodes). `box(_:)` above does not flip because its input
  /// never passes through Vision's coordinate convention.
  private static func visionBox(_ rect: CGRect) -> [String: Any] {
    ["x": rect.minX, "y": 1 - rect.minY - rect.height, "w": rect.width, "h": rect.height]
  }

  private static func readBarcodes(
    pixelBuffer: CVPixelBuffer, orientation: CGImagePropertyOrientation
  ) -> [[String: Any]] {
    let request = VNDetectBarcodesRequest()
    // Retail symbologies only. Every extra symbology is scan time spent on formats that will
    // never appear on a grocery item.
    request.symbologies = [.ean13, .ean8, .upce, .code128]

    let handler = VNImageRequestHandler(
      cvPixelBuffer: pixelBuffer, orientation: orientation, options: [:])
    guard (try? handler.perform([request])) != nil else { return [] }

    return (request.results ?? []).compactMap { observation in
      guard let payload = observation.payloadStringValue, !payload.isEmpty else { return nil }
      return [
        "payload": payload,
        "symbology": observation.symbology.rawValue,
        "box": visionBox(observation.boundingBox),
      ]
    }
  }
}
