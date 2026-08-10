// ios/Kart/KartVisionFrameProcessorPlugin.swift
import VisionCamera
import Vision
import CoreVideo

/// `Frame.orientation` is a `UIImage.Orientation` describing the rotation needed to make the
/// raw sensor buffer appear upright. `VNImageRequestHandler` wants the equivalent
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
}

@objc(KartVisionFrameProcessorPlugin)
public class KartVisionFrameProcessorPlugin: FrameProcessorPlugin {
  public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]!) {
    super.init(proxy: proxy, options: options)
  }

  public override func callback(_ frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any? {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(frame.buffer) else { return [] }

    // Give Vision the frame's actual orientation so saliency/classify/text requests all operate
    // on an upright image instead of the raw (often landscape) sensor buffer. Once the handler
    // is given this, every Vision request's own boundingBox/regionOfInterest coordinates are
    // already reported in the corrected, upright normalized space — no further rotation math
    // is needed on the Vision side. (The JS side still needs to know the corrected frame
    // dimensions to map those normalized boxes to screen pixels; see frameSize handling in
    // scan.tsx, since `frame.width`/`frame.height` themselves stay raw/unrotated.)
    let orientation = CGImagePropertyOrientation(frame.orientation)
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: orientation, options: [:])

    let saliencyRequest = VNGenerateObjectnessBasedSaliencyImageRequest()
    do {
      try handler.perform([saliencyRequest])
    } catch {
      return []
    }

    guard
      let observation = saliencyRequest.results?.first,
      let salientObjects = observation.salientObjects
    else {
      return []
    }

    let topRegions = salientObjects
      .sorted { $0.confidence > $1.confidence }
      .prefix(3)

    var results: [[String: Any]] = []

    for region in topRegions {
      // Vision's coordinate space is normalized with origin bottom-left.
      // Flip to top-left origin to match the app's Box convention.
      let visionBox = region.boundingBox
      let appBox: [String: Any] = [
        "x": visionBox.origin.x,
        "y": 1 - visionBox.origin.y - visionBox.height,
        "w": visionBox.width,
        "h": visionBox.height,
      ]

      let classifyRequest = VNClassifyImageRequest()
      classifyRequest.regionOfInterest = visionBox

      let textRequest = VNRecognizeTextRequest()
      textRequest.recognitionLevel = .fast
      textRequest.regionOfInterest = visionBox

      try? handler.perform([classifyRequest, textRequest])

      // Vision's classifier returns ~1300 hierarchical labels; the single top-1 result is very
      // often a generic hypernym ("food", "produce", "material") with no catalog mapping even
      // when a more specific, correct label was returned right behind it. Return the top 5 so
      // the JS-side matcher can fall through to a lower-ranked candidate.
      let topLabels = (classifyRequest.results ?? [])
        .sorted { $0.confidence > $1.confidence }
        .prefix(5)
        .map { ["label": $0.identifier, "confidence": Double($0.confidence)] as [String: Any] }

      let ocrText = (textRequest.results ?? [])
        .compactMap { $0.topCandidates(1).first?.string }
        .joined(separator: " ")

      results.append([
        "box": appBox,
        "labels": topLabels,
        "ocrText": ocrText,
      ])
    }

    return results
  }
}
