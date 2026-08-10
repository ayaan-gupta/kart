// ios/Kart/KartVisionFrameProcessorPlugin.swift
import VisionCamera
import Vision
import CoreVideo

@objc(KartVisionFrameProcessorPlugin)
public class KartVisionFrameProcessorPlugin: FrameProcessorPlugin {
  public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]!) {
    super.init(proxy: proxy, options: options)
  }

  public override func callback(_ frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any? {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(frame.buffer) else { return [] }

    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])

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

      let topLabel = classifyRequest.results?.max { $0.confidence < $1.confidence }
      let ocrText = (textRequest.results ?? [])
        .compactMap { $0.topCandidates(1).first?.string }
        .joined(separator: " ")

      results.append([
        "box": appBox,
        "label": topLabel?.identifier ?? "",
        "confidence": Double(topLabel?.confidence ?? 0),
        "ocrText": ocrText,
      ])
    }

    return results
  }
}
