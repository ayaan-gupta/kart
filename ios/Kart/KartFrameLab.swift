// ios/Kart/KartFrameLab.swift
//
// Debug-only bridge for the developer Frame Lab screen (src/app/dev/frame-lab.tsx). Pushes a
// bundled test photograph through the exact same native code the live camera path uses:
// CVPixelBuffer -> CMSampleBuffer -> a real VisionCamera `Frame` -> a real
// `KartVisionFrameProcessorPlugin.callback(_:withArguments:)` call. Nothing here is a
// reimplementation or a mock of that pipeline. It supplies the one input the Simulator cannot
// (a pixel buffer with real content) and calls the production plugin code unmodified, including
// the real `AppleInstanceMaskDetector`, `MaskContour`, `FrameMetrics` and barcode reading.
//
// What this deliberately does not attempt: a real VisionCamera `Frame` JSI host object crossing
// into a worklet runtime the way `plugin.call(frame, args)` does on device. `FrameHostObject`,
// the C++ type that would make that possible, is a private VisionCamera header
// (ios/Pods/Headers/Private/VisionCamera/FrameHostObject.h, not exported on the module's public
// header search path), and reimplementing it here would mean testing a hand-rolled substitute
// for VisionCamera's own JSI plumbing rather than the real thing, which is worse than being
// honest that this one hop still needs a camera. See the report for what the worklet-boundary
// probe (frameLabNative.ts, probeWorkletBoundary) proves instead, and its own honest limit.
//
// Compiled only into Debug builds. The #if DEBUG guard here, matched by the same guard in
// KartFrameLab.m, means this class and its RN bridge do not exist at all in a Release/TestFlight/
// App Store binary: there is no code path by which a normal user's build could expose it.

#if DEBUG

import CoreImage
import CoreMedia
import CoreVideo
import Foundation
import ImageIO
import QuartzCore
import VisionCamera

@objc(KartFrameLab)
final class KartFrameLab: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { false }

  private enum LabError: Error {
    case failed(String)
    var message: String {
      switch self {
      case .failed(let message): return message
      }
    }
  }

  private static let ciContext = CIContext(options: nil)

  /// One instance shared across every call in this process, matching how
  /// `KartVisionFrameProcessorPlugin` holds a single `FrameMetrics` for the plugin's whole
  /// lifetime. Motion is a comparison against the previous frame; reusing this object is what
  /// lets a second and third call against the same still image report the real (near-zero)
  /// motion value a static test subject should produce, instead of "no previous frame" maximum
  /// motion on every single call.
  private static let metrics = FrameMetrics()

  /// `FrameProcessorPlugin`'s base initializer (node_modules/react-native-vision-camera's
  /// FrameProcessorPlugin.m) discards `proxy` outright, and `KartVisionFrameProcessorPlugin`
  /// never reads `self.proxy` inside `callback`, so a proxy wrapping a throwaway pointer is
  /// safe: nothing on this path ever dereferences it. Verified by reading both files before
  /// relying on this, not assumed. `VisionCameraProxyHolder`'s `proxy` parameter bridges from
  /// Objective-C `void*` as a non-optional `UnsafeMutableRawPointer`, so `nil` is not accepted
  /// here; one never-freed one-byte allocation for the process's lifetime is the simplest way
  /// to satisfy that without reading undefined memory.
  private static let plugin = KartVisionFrameProcessorPlugin(
    proxy: VisionCameraProxyHolder(proxy: .allocate(byteCount: 1, alignment: 1)), options: [:])

  /// Loads `path` (an absolute file path to a bundled/cached image, resolved on the JS side by
  /// `expo-asset`), builds a real camera-shaped pixel buffer from it, and runs it through the
  /// real plugin. Resolves with exactly the dictionary shape the real plugin returns from
  /// `plugin.call(frame, args)` on device, so `toFrameScan` on the JS side needs no special
  /// casing to consume it.
  @objc func scanBundledImage(
    _ path: String,
    request: NSDictionary,
    resolver: @escaping RCTPromiseResolveBlock,
    rejecter: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let result = try KartFrameLab.run(
          imagePath: path, request: (request as? [AnyHashable: Any]) ?? [:])
        DispatchQueue.main.async { resolver(result) }
      } catch let error as LabError {
        DispatchQueue.main.async { rejecter("kart_frame_lab", error.message, nil) }
      } catch {
        DispatchQueue.main.async { rejecter("kart_frame_lab", "\(error)", nil) }
      }
    }
  }

  private static func run(imagePath: String, request: [AnyHashable: Any]) throws -> [AnyHashable: Any] {
    let cleanPath = imagePath.hasPrefix("file://") ? String(imagePath.dropFirst(7)) : imagePath
    guard
      let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: cleanPath) as CFURL, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
      throw LabError.failed("could not decode test image at \(cleanPath)")
    }

    guard let pixelBuffer = makeYUVPixelBuffer(from: cgImage) else {
      throw LabError.failed("could not build a pixel buffer from the test image")
    }
    guard let sampleBuffer = makeSampleBuffer(pixelBuffer: pixelBuffer) else {
      throw LabError.failed("could not wrap the pixel buffer in a CMSampleBuffer")
    }

    let frame = Frame(buffer: sampleBuffer, orientation: .up, isMirrored: false)
    guard let result = plugin.callback(frame, withArguments: request) as? [AnyHashable: Any] else {
      throw LabError.failed("plugin callback returned no result")
    }
    return result
  }

  /// Renders into a biplanar 4:2:0 buffer, the same pixel format VisionCamera hands the plugin
  /// on device once a frame processor is installed (see the comment on
  /// `FrameMetrics.unreadableReason`), so `FrameMetrics.measure` reads a real luma plane instead
  /// of taking its "unsupported pixel format" branch, and sharpness/motion come back as real
  /// numbers rather than the error-path constants.
  private static func makeYUVPixelBuffer(from image: CGImage) -> CVPixelBuffer? {
    let attributes: [CFString: Any] = [
      kCVPixelBufferIOSurfacePropertiesKey: [:],
      kCVPixelBufferCGImageCompatibilityKey: true,
    ]
    var buffer: CVPixelBuffer?
    let status = CVPixelBufferCreate(
      kCFAllocatorDefault, image.width, image.height,
      kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, attributes as CFDictionary, &buffer)
    guard status == kCVReturnSuccess, let out = buffer else { return nil }

    ciContext.render(CIImage(cgImage: image), to: out)
    return out
  }

  /// Standard CoreMedia boilerplate for wrapping an already-built `CVPixelBuffer` as a
  /// `CMSampleBuffer`: a format description derived straight from the buffer, and a timing
  /// struct carrying the current time (a still-image test has no real presentation timeline).
  private static func makeSampleBuffer(pixelBuffer: CVPixelBuffer) -> CMSampleBuffer? {
    var formatDescription: CMFormatDescription?
    guard
      CMVideoFormatDescriptionCreateForImageBuffer(
        allocator: kCFAllocatorDefault, imageBuffer: pixelBuffer,
        formatDescriptionOut: &formatDescription) == noErr,
      let format = formatDescription
    else { return nil }

    var timing = CMSampleTimingInfo(
      duration: .invalid,
      presentationTimeStamp: CMTime(seconds: CACurrentMediaTime(), preferredTimescale: 1_000_000_000),
      decodeTimeStamp: .invalid)

    var sampleBuffer: CMSampleBuffer?
    let status = CMSampleBufferCreateForImageBuffer(
      allocator: kCFAllocatorDefault, imageBuffer: pixelBuffer, dataReady: true,
      makeDataReadyCallback: nil, refcon: nil, formatDescription: format,
      sampleTiming: &timing, sampleBufferOut: &sampleBuffer)
    guard status == noErr else { return nil }
    return sampleBuffer
  }
}

#endif
