// ios/Kart/KartVisionFrameProcessorPlugin.swift
import CoreVideo
import Vision
import VisionCamera

/// The VisionCamera end of the frame processor, and nothing else.
///
/// Every decision this used to make about a frame - the orientation pin, the two-gate keyframe
/// handshake, argument parsing, barcode reading, the reply shape - now lives in
/// `KartFrameAnalysis`, which imports no VisionCamera and so compiles under `swiftc` on a Mac.
/// That move is what lets `scripts/replay-driver` drive a video clip through the real analysis
/// with no phone and no Simulator; it is not a rewrite, and the code and its comments went
/// across unchanged.
///
/// What is left here is the part that genuinely needs VisionCamera: receiving a `Frame`, taking
/// its buffer and dimensions, and holding the two objects that must persist across frames.
@objc(KartVisionFrameProcessorPlugin)
public class KartVisionFrameProcessorPlugin: FrameProcessorPlugin {

  /// The one place a concrete detector is named. Swapping in a Core ML detector, once the
  /// benchmark says to, is a change to this line and nothing else.
  private let detector: KartDetector = AppleInstanceMaskDetector()

  /// Held for the plugin's whole lifetime, not made per frame: motion is a comparison against
  /// the previous frame this object measured.
  private let metrics = FrameMetrics()

  public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]!) {
    super.init(proxy: proxy, options: options)
  }

  public override func callback(
    _ frame: Frame, withArguments arguments: [AnyHashable: Any]?
  ) -> Any? {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(frame.buffer) else {
      return KartFrameAnalysis.empty(width: 0, height: 0, error: "frame carried no image buffer")
    }
    return KartFrameAnalysis.analyse(
      pixelBuffer: pixelBuffer,
      frameWidth: frame.width,
      frameHeight: frame.height,
      arguments: arguments,
      detector: detector,
      metrics: metrics)
  }
}
