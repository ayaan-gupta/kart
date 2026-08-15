// ios/Kart/FrameMetrics.swift
import CoreVideo
import Foundation

/// The dimension the luma plane is decimated to before the motion metric runs. Motion asks
/// whether the whole scene shifted, which is coarse structure, so decimation costs it nothing
/// and makes it nearly free at camera frame rate.
private let MOTION_SAMPLE_EDGE = 96

/// The side of one sharpness tile, and how many tiles per axis, in native pixels.
///
/// Two separate things are going on here.
///
/// First, sharpness must not be measured on the decimated motion sample. Variance-of-Laplacian
/// measures energy at the pixel scale, and a 20x nearest-neighbour decimation (1080p down to a
/// 96px edge) is exactly what destroys that energy, replacing it with aliasing that barely
/// moves with focus. Measured on a synthetic 1920x1080 photo-like image under progressive box
/// blur, the decimated path scored 5177 sharp, 647 at 2px of blur and 92 at 16px, so a badly
/// defocused frame sat at the `minSharpness` of 100 rather than far below it. The same images
/// at native resolution scored 5064, 103 and 2.0.
///
/// Second, it must not be measured on one window either. A single 256x256 centre window covers
/// roughly a 13cm square of a bird's-eye cart scene, which is smaller than a cereal box face, a
/// pizza box, a case of water or a carrier bag. Landing wholly inside one flat item is an
/// ordinary frame, not a corner case, and variance-of-Laplacian is contrast-relative, so a
/// bright denoised white surface reads near zero while being perfectly in focus. The cost that
/// actually decides it: with one window, `minSharpness` is untunable in principle, because its
/// value depends on which three percent of the cart happens to sit under the reticle.
///
/// So: a 3x3 grid of 128x128 tiles at the centres of a thirds partition, reduced with `max`.
/// About 147k pixels against 65k, still nothing three times a second. `max` is the right
/// reducer because the question the gate asks is "is anything in this frame in focus": a
/// genuinely defocused frame has no sharp tile anywhere, and blur suppresses specular edges
/// too, so the usual false-positive worry does not really bite. It also damps the
/// frame-to-frame jitter a single window produces as the phone drifts.
private let SHARPNESS_TILE = 128
private let SHARPNESS_GRID = 3

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

  /// Sharpness and motion for one frame, plus why they are missing when they are.
  ///
  /// The error is not decoration. A buffer this cannot read reports sharpness 0 and motion 1,
  /// which jams the gate shut on every frame for the life of the session and looks exactly like
  /// a user who never holds the phone still. Returning silently would route that around the
  /// error channel the plugin exists to feed.
  public func measure(pixelBuffer: CVPixelBuffer)
    -> (sharpness: Double, motion: Double, error: String?)
  {
    let read = FrameMetrics.withLumaPlane(pixelBuffer) { plane in
      (
        sharpness: FrameMetrics.sharpness(of: plane),
        sample: FrameMetrics.motionSample(of: plane)
      )
    }

    guard let read else {
      previous = nil
      return (0, 1.0, FrameMetrics.unreadableReason(pixelBuffer))
    }

    // The first frame of a session has nothing to compare against. Reporting maximum motion
    // holds the gate shut for one frame, which is the safe direction to fail.
    let motion = previous.map { FrameMetricsMath.meanAbsoluteDifference($0, read.sample) } ?? 1.0
    previous = read.sample

    return (read.sharpness, motion, nil)
  }

  /// Why `withLumaPlane` refused a buffer, in words a maintainer can act on from a device log.
  ///
  /// Unreachable today, because VisionCamera resolves to a biplanar YUV format whenever a frame
  /// processor is installed. Enabling HDR or buffer compression changes that, and the whole
  /// point of finding 5's error channel is that the first device session should be diagnosable
  /// rather than a shrug.
  private static func unreadableReason(_ pixelBuffer: CVPixelBuffer) -> String {
    let format = CVPixelBufferGetPixelFormatType(pixelBuffer)
    let bytes = [
      UInt8(truncatingIfNeeded: format >> 24), UInt8(truncatingIfNeeded: format >> 16),
      UInt8(truncatingIfNeeded: format >> 8), UInt8(truncatingIfNeeded: format),
    ]
    // Most CoreVideo formats are four-character codes like '420v' or 'BGRA'; a few are plain
    // small integers, which are only readable as hex.
    let printable = bytes.allSatisfy { $0 >= 32 && $0 < 127 }
    let described =
      printable
      ? "'\(String(decoding: bytes, as: UTF8.self))'" : String(format: "0x%08X", format)
    return "frame metrics: unsupported pixel format \(described), sharpness and motion unavailable"
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
  /// format. An unknown format returns nil, which `measure` turns into sharpness 0, motion 1
  /// and an error string, so the gate holds and says why. Reading a BGRA buffer as though it
  /// were luma would index interleaved channels as pixels and quietly report a metric computed
  /// on a quarter of the image.
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

  /// Variance of the Laplacian over a grid of native-resolution tiles, reduced with `max`.
  ///
  /// Tiles rather than one window because any single window is small enough to land wholly
  /// inside one flat item, and `max` because the gate is asking whether anything in the frame
  /// is in focus. A source smaller than one tile is measured whole.
  private static func sharpness(of plane: LumaPlane) -> Double {
    // One square side for every tile, so a frame narrower or shorter than the tile still
    // produces a usable window rather than an empty one. A frame smaller than the grid simply
    // yields overlapping tiles, which costs a little repeated work and breaks nothing.
    let side = min(SHARPNESS_TILE, plane.width, plane.height)
    guard side > 2 else { return 0 }

    var tile = [UInt8](repeating: 0, count: side * side)
    var best = 0.0

    for row in 0..<SHARPNESS_GRID {
      for column in 0..<SHARPNESS_GRID {
        // Tile centres sit at the middle of each cell of a thirds partition, so the set spans
        // the frame without ever reaching the extreme edge, where vignetting and lens softness
        // would drag a corner tile down for reasons that have nothing to do with focus.
        let centreX = plane.width * (2 * column + 1) / (2 * SHARPNESS_GRID)
        let centreY = plane.height * (2 * row + 1) / (2 * SHARPNESS_GRID)
        let originX = min(max(0, centreX - side / 2), plane.width - side)
        let originY = min(max(0, centreY - side / 2), plane.height - side)

        for y in 0..<side {
          let source = plane.base.advanced(by: (originY + y) * plane.bytesPerRow + originX)
          for x in 0..<side { tile[y * side + x] = source[x] }
        }

        best = max(best, FrameMetricsMath.varianceOfLaplacian(tile, width: side, height: side))
      }
    }

    return best
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
