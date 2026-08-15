// ios/Kart/FrameMetrics.swift
import CoreVideo
import Foundation

/// The dimension the luma plane is sampled down to before either metric runs. Small enough to
/// be nearly free at camera frame rate, large enough that a genuinely blurry frame still scores
/// distinctly below a sharp one.
private let SAMPLE_EDGE = 96

public enum FrameMetricsMath {

  /// Variance of the Laplacian, the standard cheap focus measure. A sharp image has strong
  /// second derivatives at edges and therefore high variance; a blurred one does not.
  public static func varianceOfLaplacian(_ luma: [UInt8], width: Int, height: Int) -> Double {
    guard width > 2, height > 2, luma.count >= width * height else { return 0 }

    var sum = 0.0
    var sumSquares = 0.0
    var count = 0

    for y in 1..<(height - 1) {
      for x in 1..<(width - 1) {
        let centre = Int(luma[y * width + x])
        let value =
          Double(
            Int(luma[(y - 1) * width + x]) + Int(luma[(y + 1) * width + x])
              + Int(luma[y * width + x - 1]) + Int(luma[y * width + x + 1]) - 4 * centre)
        sum += value
        sumSquares += value * value
        count += 1
      }
    }

    guard count > 0 else { return 0 }
    let mean = sum / Double(count)
    return max(0, sumSquares / Double(count) - mean * mean)
  }

  /// Mean absolute difference between two same-size samples, normalized to 0 to 1.
  ///
  /// Mismatched sizes report maximum motion rather than zero. A size change means the camera
  /// reconfigured, and treating that as "perfectly still" would let the gate fire on the one
  /// frame least likely to be usable.
  public static func meanAbsoluteDifference(_ a: [UInt8], _ b: [UInt8]) -> Double {
    if a.isEmpty && b.isEmpty { return 0 }
    guard a.count == b.count, !a.isEmpty else { return 1.0 }

    var total = 0
    for i in 0..<a.count { total += abs(Int(a[i]) - Int(b[i])) }
    return Double(total) / (Double(a.count) * 255.0)
  }
}

/// Stateful wrapper: sharpness is per frame, motion needs the frame before it.
public final class FrameMetrics {
  private var previous: [UInt8]?

  public init() {}

  public func reset() {
    previous = nil
  }

  public func measure(pixelBuffer: CVPixelBuffer) -> (sharpness: Double, motion: Double) {
    guard let sample = FrameMetrics.sampleLuma(pixelBuffer) else {
      previous = nil
      return (0, 1.0)
    }

    let sharpness = FrameMetricsMath.varianceOfLaplacian(
      sample.luma, width: sample.width, height: sample.height)

    // The first frame of a session has nothing to compare against. Reporting maximum motion
    // holds the gate shut for one frame, which is the safe direction to fail.
    let motion =
      previous.map { FrameMetricsMath.meanAbsoluteDifference($0, sample.luma) } ?? 1.0
    previous = sample.luma

    return (sharpness, motion)
  }

  /// Nearest-neighbour downsample of plane 0. Biplanar YUV keeps luma in plane 0, and a
  /// single-plane buffer is already luma-only, so both cases read the same way.
  private static func sampleLuma(_ pixelBuffer: CVPixelBuffer) -> (luma: [UInt8], width: Int, height: Int)? {
    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

    let planar = CVPixelBufferGetPlaneCount(pixelBuffer) > 0
    let srcWidth = planar ? CVPixelBufferGetWidthOfPlane(pixelBuffer, 0) : CVPixelBufferGetWidth(pixelBuffer)
    let srcHeight = planar ? CVPixelBufferGetHeightOfPlane(pixelBuffer, 0) : CVPixelBufferGetHeight(pixelBuffer)
    let bytesPerRow =
      planar
      ? CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0) : CVPixelBufferGetBytesPerRow(pixelBuffer)
    let base =
      planar
      ? CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0) : CVPixelBufferGetBaseAddress(pixelBuffer)

    guard srcWidth > 0, srcHeight > 0, let address = base else { return nil }

    let scale = max(1, max(srcWidth, srcHeight) / SAMPLE_EDGE)
    let width = max(1, srcWidth / scale)
    let height = max(1, srcHeight / scale)
    let src = address.assumingMemoryBound(to: UInt8.self)

    var out = [UInt8](repeating: 0, count: width * height)
    for y in 0..<height {
      let row = src.advanced(by: min(y * scale, srcHeight - 1) * bytesPerRow)
      for x in 0..<width { out[y * width + x] = row[min(x * scale, srcWidth - 1)] }
    }

    return (out, width, height)
  }
}
