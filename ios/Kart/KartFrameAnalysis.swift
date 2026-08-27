// ios/Kart/KartFrameAnalysis.swift
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO
import Vision

/// Everything the frame processor does to one frame, with no VisionCamera in it.
///
/// This is the body of `KartVisionFrameProcessorPlugin.callback`, lifted out. That method now
/// unwraps the `Frame` and calls straight into `analyse` below; nothing was reimplemented and no
/// behaviour changed with the move.
///
/// The reason for the split is that `KartVisionFrameProcessorPlugin` imports VisionCamera, and
/// VisionCamera only builds inside a full Xcode iOS build. Everything that made this file worth
/// separating - the orientation pin, the two-gate handshake, the argument parsing, the reply
/// shape - was therefore reachable only from a device or a Simulator, and two of the four bugs
/// that kept this app from ever uploading a frame lived in exactly these lines. With the import
/// gone, `swiftc` compiles this on a Mac alongside `AppleInstanceMaskDetector`, `MaskContour`,
/// `FrameMetrics` and `KartImageTools`, which is what lets `scripts/replay-driver` push a video
/// clip through the real thing with no phone and no Simulator involved.
///
/// It also matters that the Simulator is not a substitute here:
/// `VNGenerateForegroundInstanceMaskRequest` cannot create an inference context there and fails
/// on every call, so the Simulator finds zero instances in any image and can say nothing about
/// tracking, the gate's track count, or anything downstream of them. The same code run as a Mac
/// binary segments normally.
public enum KartFrameAnalysis {

  /// The orientation every frame is interpreted with.
  ///
  /// Fixed at `.right`, not read from the frame, because this app is locked to portrait
  /// (`app.json`) and the back camera's sensor buffer is landscape. `.right` is the one
  /// interpretation that stands that buffer upright in a portrait UI, and it is therefore a
  /// property of the app rather than something to re-derive per frame.
  ///
  /// Reading the frame's own orientation drew every silhouette rotated 180 degrees on device,
  /// measured across three separate captures: an item occupying x 0 to 0.62 and y 0.47 to 0.70
  /// produced an outline at x 0.45 to 1.0 and y 0.28 to 0.53, which is both axes through
  /// `1 - v`. That value ultimately comes from `AVCaptureConnection.videoOrientation`, which
  /// VisionCamera drives from the *device's* physical orientation by default. Pointing a phone
  /// down at a trolley is exactly the posture in which the device-orientation sensor becomes
  /// unreliable and can settle upside down while the locked UI stays portrait, which is that 180
  /// degrees.
  ///
  /// Consequences ran well past the overlay. `MaskContour` derives each instance's box from the
  /// same rotated grid, the census composites its numbered badges at those boxes, and the crops
  /// sent to identify are cut from them, so a rotated mask put every badge on wall and floor.
  /// The model would have correctly reported "not a product" and the bag would have stayed empty
  /// even with a working gate and a funded API key.
  ///
  /// This is only correct while the app stays portrait-locked. Supporting landscape means
  /// deriving this from the *interface* orientation, never from the device's.
  public static let orientation: CGImagePropertyOrientation = .right

  /// True when making the buffer upright swaps its width and height.
  public static func swapsDimensions(_ orientation: CGImagePropertyOrientation) -> Bool {
    switch orientation {
    case .left, .leftMirrored, .right, .rightMirrored: return true
    default: return false
    }
  }

  /// Runs one frame and returns the reply dictionary the JavaScript side consumes.
  ///
  /// `frameWidth` and `frameHeight` are the buffer's own dimensions as the caller sees them,
  /// before the orientation swap; the reply reports them swapped, which is what a portrait UI
  /// needs and what a device reports through the debug overlay.
  ///
  /// `detector` and `metrics` are passed in rather than owned here because both carry state
  /// across frames: `FrameMetrics` compares against the previous frame it measured, so a
  /// freshly-made one reports first-frame motion on every call and the motion half of the
  /// keyframe gate silently stops meaning anything.
  public static func analyse(
    pixelBuffer: CVPixelBuffer,
    frameWidth: Int,
    frameHeight: Int,
    arguments: [AnyHashable: Any]?,
    detector: KartDetector,
    metrics: FrameMetrics
  ) -> [String: Any] {
    let width = swapsDimensions(orientation) ? frameHeight : frameWidth
    let height = swapsDimensions(orientation) ? frameWidth : frameHeight

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
      barcodes = readBarcodes(pixelBuffer: pixelBuffer, orientation: orientation)
    }

    // `metrics.measure` returns a three-element tuple with its own `error` label; the keyframe
    // gate only needs the two numeric signals, so they are repackaged into the narrower shape
    // rather than passed through directly (the tuple types are not otherwise interchangeable).
    let keyframeBase64 = keyframe(
      pixelBuffer: pixelBuffer, orientation: orientation,
      measured: (sharpness: measured.sharpness, motion: measured.motion), arguments: arguments)
    let cropped = crops(pixelBuffer: pixelBuffer, orientation: orientation, arguments: arguments)

    return [
      "instances": instances.map { instance in
        [
          "box": box(instance.box),
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
      // NSNull rather than an omitted key: the bridge turns a Swift nil in a dictionary literal
      // into a missing key, and the binder distinguishes "no keyframe" from "no such field".
      "keyframe": keyframeBase64 ?? NSNull(),
      // The thresholds this frame was actually judged against, echoed back so the JavaScript side
      // can see them. Without this the two halves of the gate could disagree indefinitely with no
      // symptom other than a scan that never uploads: a mis-boxed `minSharpness` silently became
      // infinity here while JavaScript believed it had sent a reachable number. Echoing what was
      // parsed makes that disagreement visible in one glance at the debug overlay.
      "gateMinSharpness": number(arguments?["minSharpness"]) ?? .greatestFiniteMagnitude,
      "gateMaxMotion": number(arguments?["maxMotion"]) ?? 0,
      "crops": cropped,
    ]
  }

  /// The reply for a frame that carried no readable image buffer.
  public static func empty(width: Int, height: Int, error: String?) -> [String: Any] {
    [
      "instances": [], "barcodes": [], "sharpness": 0.0, "motion": 1.0,
      "width": width, "height": height, "error": error ?? NSNull(),
      "keyframe": NSNull(), "crops": [],
    ]
  }

  /// Encodes the frame for upload, but only when both halves of the keyframe gate agree.
  ///
  /// JavaScript owns the slow conditions (are there tracks, has enough time passed) and signals
  /// them through `wantKeyframe`. This owns the fast one: whether this particular frame is sharp
  /// and still enough to be worth three hundred kilobytes and a model call. Splitting it this
  /// way means the thresholds still live in exactly one place, `config.ts`, and no frame is ever
  /// encoded only to be thrown away.
  ///
  /// Thin glue over `KartImageTools.encodeKeyframeIfGated`: the gate decision and the encode
  /// live there, where they have Swift-test coverage.
  private static func keyframe(
    pixelBuffer: CVPixelBuffer,
    orientation: CGImagePropertyOrientation,
    measured: (sharpness: Double, motion: Double),
    arguments: [AnyHashable: Any]?
  ) -> String? {
    let data = KartImageTools.encodeKeyframeIfGated(
      wantKeyframe: (arguments?["wantKeyframe"] as? Bool) ?? false,
      sharpness: measured.sharpness,
      motion: measured.motion,
      minSharpness: number(arguments?["minSharpness"]) ?? .greatestFiniteMagnitude,
      maxMotion: number(arguments?["maxMotion"]) ?? 0,
      orientation: orientation,
      quality: 0.78,
      // @autoclosure on the tools side: this pixel buffer -> CGImage bridge only actually runs
      // once the gate has already passed.
      image: KartImageTools.cgImage(from: pixelBuffer))
    return data?.base64EncodedString()
  }

  /// Reads a number out of the argument bag without caring how it was boxed.
  ///
  /// `as? Double` was not safe here. A JavaScript number crosses the bridge as an `NSNumber`, and
  /// whether that bridges to Swift as `Double` or as `Int` depends on whether the value happened
  /// to be integral. Every threshold this reads used to be the literal `12`, so the cast could
  /// fail, and both fallbacks fail *closed*: `minSharpness` became `.greatestFiniteMagnitude` and
  /// `maxMotion` became `0`, which together reject every frame that will ever exist. Silently.
  /// There is no error channel on this path, so the result on device was a camera that tracked
  /// and outlined correctly and never once uploaded anything, which is indistinguishable from a
  /// user who cannot hold the phone still.
  ///
  /// `NSNumber` covers both boxings, so an integral threshold and a fractional one behave the
  /// same. Returning optional keeps the caller's fail-closed defaults for a genuinely absent key,
  /// which is the right direction to fail for a *missing* argument, unlike a mis-boxed one.
  public static func number(_ value: Any?) -> Double? {
    if let number = value as? NSNumber { return number.doubleValue }
    if let double = value as? Double { return double }
    if let int = value as? Int { return Double(int) }
    return nil
  }

  /// Cuts out the tracks JavaScript asked for, from this frame.
  ///
  /// The boxes come from the tracker's current estimate, so this crops where the item is *now*
  /// rather than where it was in the keyframe that named it. That is deliberate: the thumbnail
  /// stays fresh, and it costs nothing extra because the pixels are already here.
  private static func crops(
    pixelBuffer: CVPixelBuffer,
    orientation: CGImagePropertyOrientation,
    arguments: [AnyHashable: Any]?
  ) -> [[String: Any]] {
    guard let requested = arguments?["cropBoxes"] as? [[String: Any]], !requested.isEmpty else {
      return []
    }
    let boxes: [(id: String, box: CGRect)] = requested.compactMap { entry in
      guard
        let id = entry["id"] as? String,
        let x = entry["x"] as? Double, let y = entry["y"] as? Double,
        let w = entry["w"] as? Double, let h = entry["h"] as? Double
      else { return nil }
      return (id: id, box: CGRect(x: x, y: y, width: w, height: h))
    }
    guard
      !boxes.isEmpty,
      let image = KartImageTools.cgImage(from: pixelBuffer),
      let full = KartImageTools.jpegData(
        from: image, orientation: orientation,
        maxEdge: KartImageTools.keyframeMaxEdge, quality: 0.85)
    else { return [] }

    let padding = CGFloat((arguments?["thumbnailPadding"] as? Double) ?? 0.08)
    return KartImageTools.trackThumbnails(from: full, boxes: boxes, padding: padding, quality: 0.8)
      .map { ["id": $0.id, "jpeg": $0.jpeg.base64EncodedString()] }
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
