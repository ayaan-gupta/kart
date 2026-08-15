// ios/Kart/FrameMetrics.swift
import CoreVideo
import Foundation

/// The dimension the luma plane is decimated to before the motion metric runs. Motion asks
/// whether the whole scene shifted, which is coarse structure, so decimation costs it nothing
/// and makes it nearly free at camera frame rate.
private let MOTION_SAMPLE_EDGE = 96

/// The side of the centre crop sharpness is measured over, in native pixels.
///
/// Sharpness must not be measured on the decimated motion sample. Variance-of-Laplacian
/// measures energy at the pixel scale, and a 20x nearest-neighbour decimation (1080p down to a
/// 96px edge) is exactly what destroys that energy, replacing it with aliasing that barely
/// moves with focus. Measured here on a synthetic 1920x1080 photo-like image under progressive
/// box blur, the decimated path scored 5177 sharp, 647 at 2px of blur and 92 at 16px, so a
/// badly defocused frame sat at the `minSharpness` of 100 rather than far below it. The same
/// images at native resolution scored 5064, 103 and 2.0. A bounded window keeps the cost
/// trivial: about 65k pixels, three times a second.
private let SHARPNESS_WINDOW = 256

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
    let read = FrameMetrics.withLumaPlane(pixelBuffer) { plane in
      (
        sharpness: FrameMetrics.sharpness(of: plane),
        sample: FrameMetrics.motionSample(of: plane)
      )
    }

    guard let read else {
      previous = nil
      return (0, 1.0)
    }

    // The first frame of a session has nothing to compare against. Reporting maximum motion
    // holds the gate shut for one frame, which is the safe direction to fail.
    let motion = previous.map { FrameMetricsMath.meanAbsoluteDifference($0, read.sample) } ?? 1.0
    previous = read.sample

    return (read.sharpness, motion)
  }

  // MARK: - Luma access

  /// Where the 8-bit luma bytes of a frame buffer live. Valid only while the buffer is locked.
  private struct LumaPlane {
    let base: UnsafePointer<UInt8>
    let bytesPerRow: Int
    let width: Int
    let height: Int
  }

  /// Locks the buffer, locates its luma bytes and hands them to `body`.
  ///
  /// The format is checked rather than assumed, the way `MaskContour.labels` checks its mask
  /// format. An unknown format returns nil, which surfaces as sharpness 0 and motion 1, and the
  /// gate holds. Reading a BGRA buffer as though it were luma would index interleaved channels
  /// as pixels and quietly report a metric computed on a quarter of the image.
  private static func withLumaPlane<T>(_ pixelBuffer: CVPixelBuffer, _ body: (LumaPlane) -> T) -> T? {
    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

    let planar: Bool
    switch CVPixelBufferGetPixelFormatType(pixelBuffer) {
    // Plane 0 of any 4:2:0 YUV layout is a full-resolution 8-bit luma plane. This is what
    // VisionCamera delivers on device.
    case kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
      kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
      kCVPixelFormatType_420YpCbCr8Planar,
      kCVPixelFormatType_420YpCbCr8PlanarFullRange:
      planar = true
    // A single-component 8-bit buffer is already luma-only. This is what the bench builds.
    case kCVPixelFormatType_OneComponent8:
      planar = false
    default:
      return nil
    }

    let width = planar ? CVPixelBufferGetWidthOfPlane(pixelBuffer, 0) : CVPixelBufferGetWidth(pixelBuffer)
    let height = planar ? CVPixelBufferGetHeightOfPlane(pixelBuffer, 0) : CVPixelBufferGetHeight(pixelBuffer)
    let bytesPerRow =
      planar
      ? CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0) : CVPixelBufferGetBytesPerRow(pixelBuffer)
    let base =
      planar
      ? CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0) : CVPixelBufferGetBaseAddress(pixelBuffer)

    guard width > 0, height > 0, bytesPerRow >= width, let address = base else { return nil }

    return body(
      LumaPlane(
        base: address.assumingMemoryBound(to: UInt8.self), bytesPerRow: bytesPerRow,
        width: width, height: height))
  }

  /// Variance of the Laplacian over a centre crop of native-resolution pixels.
  ///
  /// The crop is centred because that is where a cart being held up to the camera is, and it is
  /// bounded because the metric only needs enough pixels to estimate a variance. A source
  /// smaller than the window is measured whole.
  private static func sharpness(of plane: LumaPlane) -> Double {
    let cropWidth = min(SHARPNESS_WINDOW, plane.width)
    let cropHeight = min(SHARPNESS_WINDOW, plane.height)
    let originX = (plane.width - cropWidth) / 2
    let originY = (plane.height - cropHeight) / 2

    var crop = [UInt8](repeating: 0, count: cropWidth * cropHeight)
    for y in 0..<cropHeight {
      let row = plane.base.advanced(by: (originY + y) * plane.bytesPerRow + originX)
      for x in 0..<cropWidth { crop[y * cropWidth + x] = row[x] }
    }

    return FrameMetricsMath.varianceOfLaplacian(crop, width: cropWidth, height: cropHeight)
  }

  /// Nearest-neighbour downsample of the whole luma plane, for the motion comparison.
  private static func motionSample(of plane: LumaPlane) -> [UInt8] {
    let scale = max(1, max(plane.width, plane.height) / MOTION_SAMPLE_EDGE)
    let width = max(1, plane.width / scale)
    let height = max(1, plane.height / scale)

    var out = [UInt8](repeating: 0, count: width * height)
    for y in 0..<height {
      let row = plane.base.advanced(by: min(y * scale, plane.height - 1) * plane.bytesPerRow)
      for x in 0..<width { out[y * width + x] = row[min(x * scale, plane.width - 1)] }
    }

    return out
  }
}
