// scripts/swift-tests/main.swift
//
// Unit tests for the parts of the detector that are pure geometry. Compiled together with the
// app's Swift sources by `npm run test:swift`, so there is no Xcode test target to keep in
// sync with a project file that Expo regenerates.

import CoreGraphics
import CoreVideo
import Foundation

var failures = 0

func check(_ condition: Bool, _ message: String) {
  if condition {
    print("  ok   \(message)")
  } else {
    print("  FAIL \(message)")
    failures += 1
  }
}

func suite(_ name: String, _ body: () -> Void) {
  print(name)
  body()
}

/// Builds a label grid with `value` filled inside `rect` and 0 everywhere else.
func grid(width: Int, height: Int, rect: (x: Int, y: Int, w: Int, h: Int), value: UInt8) -> [UInt8] {
  var labels = [UInt8](repeating: 0, count: width * height)
  for y in rect.y..<(rect.y + rect.h) {
    for x in rect.x..<(rect.x + rect.w) {
      labels[y * width + x] = value
    }
  }
  return labels
}

/// Builds a mask whose top edge is a deliberately irregular staircase rather than a
/// straight line: no two neighbouring columns share the same jitter, so the raw traced
/// boundary carries far more vertices than the ceiling permits and cannot be swallowed by
/// simplification the way a smooth curve would be.
func jaggedGrid(width: Int, height: Int, value: UInt8) -> [UInt8] {
  var labels = [UInt8](repeating: 0, count: width * height)
  let left = 10
  let right = width - 10
  let baseTop = height / 2
  let bottom = height - 10
  for x in left..<right {
    let jitter = (x * 37) % 9
    let top = max(0, baseTop - jitter)
    for y in top..<bottom {
      labels[y * width + x] = value
    }
  }
  return labels
}

suite("MaskContour.instances") {
  let labels = grid(width: 100, height: 100, rect: (20, 30, 40, 20), value: 1)
  let found = MaskContour.instances(
    labels: labels, width: 100, height: 100, minPixelFraction: 0.001, simplifyEpsilon: 0.004)

  check(found.count == 1, "finds exactly one instance in a single-rectangle mask")

  if let only = found.first {
    check(only.index == 1, "reports the instance label as its index")
    check(only.pixelCount == 800, "counts the filled pixels")
    check(abs(only.box.minX - 0.20) < 0.02, "normalizes the box origin x")
    check(abs(only.box.minY - 0.30) < 0.02, "normalizes the box origin y")
    check(abs(only.box.width - 0.40) < 0.03, "normalizes the box width")
    check(abs(only.box.height - 0.20) < 0.03, "normalizes the box height")
    check(only.polygon.count % 2 == 0, "emits an even number of polygon coordinates")
    check(only.polygon.count >= 6, "emits at least three points")
    check(only.polygon.count <= 40, "simplifies a rectangle down to a handful of points")
    check(only.polygon.allSatisfy { $0 >= -0.001 && $0 <= 1.001 }, "keeps polygon points normalized")
  }
}

suite("MaskContour.instances with several objects") {
  var labels = grid(width: 100, height: 100, rect: (5, 5, 20, 20), value: 1)
  let second = grid(width: 100, height: 100, rect: (60, 60, 30, 30), value: 2)
  for i in 0..<labels.count where second[i] != 0 { labels[i] = second[i] }

  let found = MaskContour.instances(
    labels: labels, width: 100, height: 100, minPixelFraction: 0.001, simplifyEpsilon: 0.004)

  check(found.count == 2, "separates two disjoint instances")
  check(found.map(\.index).sorted() == [1, 2], "keeps both instance labels")
  check(found[0].box.minX < found[1].box.minX, "returns instances ordered by label")
}

suite("MaskContour.instances filtering") {
  // A four-pixel speck in a 100x100 grid is 0.04 percent of the frame. Specks are detector
  // noise, and every one that survives becomes a phantom item in the Plan 3 count.
  let labels = grid(width: 100, height: 100, rect: (50, 50, 2, 2), value: 1)
  let found = MaskContour.instances(
    labels: labels, width: 100, height: 100, minPixelFraction: 0.002, simplifyEpsilon: 0.004)
  check(found.isEmpty, "discards instances below the minimum pixel fraction")
}

suite("MaskContour.instances edge cases") {
  let empty = MaskContour.instances(
    labels: [UInt8](repeating: 0, count: 100), width: 10, height: 10,
    minPixelFraction: 0.0, simplifyEpsilon: 0.004)
  check(empty.isEmpty, "returns nothing for an all-background mask")

  let full = MaskContour.instances(
    labels: [UInt8](repeating: 1, count: 100), width: 10, height: 10,
    minPixelFraction: 0.0, simplifyEpsilon: 0.004)
  check(full.count == 1, "handles a mask that covers the whole frame")

  let degenerate = MaskContour.instances(
    labels: [], width: 0, height: 0, minPixelFraction: 0.0, simplifyEpsilon: 0.004)
  check(degenerate.isEmpty, "returns nothing for a zero-size mask")
}

suite("MaskContour.instances concave shapes") {
  // An L shape. A radial or convex-hull approximation would fill in the notch; a real
  // boundary trace keeps it, which is the difference between tinting the banana bunch and
  // tinting the rectangle around it.
  var labels = grid(width: 100, height: 100, rect: (20, 20, 50, 20), value: 1)
  let leg = grid(width: 100, height: 100, rect: (20, 40, 20, 40), value: 1)
  for i in 0..<labels.count where leg[i] != 0 { labels[i] = 1 }

  let found = MaskContour.instances(
    labels: labels, width: 100, height: 100, minPixelFraction: 0.001, simplifyEpsilon: 0.002)
  check(found.count == 1, "traces an L shape as one instance")

  if let only = found.first {
    // Shoelace area of the outline, normalized. The L covers 1800 of 10000 pixels, 0.18.
    // A shape that had lost its notch would come out near the 0.30 bounding-box area.
    var twiceArea: Float = 0
    let n = only.polygon.count / 2
    for i in 0..<n {
      let j = (i + 1) % n
      twiceArea += only.polygon[i * 2] * only.polygon[j * 2 + 1]
      twiceArea -= only.polygon[j * 2] * only.polygon[i * 2 + 1]
    }
    let area = abs(twiceArea) / 2
    check(area > 0.14 && area < 0.23, "preserves the concave notch rather than filling it")

    // The area band alone rejects a bounding box (0.30) by a wide margin, but a convex hull of
    // this L (5 vertices, area about 0.24) lands only just outside the ceiling. A real trace
    // produces 8 vertices for this shape; requiring at least 6 proves the reflex corner at the
    // inside of the L survived as an actual vertex, since no convex hull of an L can exceed 5.
    check(n >= 6, "keeps enough vertices that the notch could not be a convex hull")
  }
}

suite("MaskContour.instances self-touching mask") {
  // A bowtie/dumbbell: two 10x10 lobes connected only through a single pixel at (20, 10),
  // which is also the topmost, leftmost foreground pixel in scan order, so it is chosen as the
  // trace's start point. Lobe A occupies x in [10, 20), y in [11, 21); lobe B occupies
  // x in [21, 31), y in [11, 21); the pinch pixel at (20, 10) is diagonally adjacent to a
  // corner of each lobe and to nothing else, so the two lobes are otherwise disconnected.
  //
  // A trace that stops the moment it revisits the start pixel's coordinates, rather than
  // re-entering it from the same direction it first left, can close the loop after finishing
  // only the lobe it happened to enter first, silently dropping the other lobe.
  var labels = grid(width: 100, height: 100, rect: (20, 10, 1, 1), value: 1)
  let lobeA = grid(width: 100, height: 100, rect: (10, 11, 10, 10), value: 1)
  let lobeB = grid(width: 100, height: 100, rect: (21, 11, 10, 10), value: 1)
  for i in 0..<labels.count where lobeA[i] != 0 { labels[i] = 1 }
  for i in 0..<labels.count where lobeB[i] != 0 { labels[i] = 1 }

  let found = MaskContour.instances(
    labels: labels, width: 100, height: 100, minPixelFraction: 0.001, simplifyEpsilon: 0.002)
  check(found.count == 1, "traces the bowtie as one instance")

  if let only = found.first {
    func pointInPolygon(_ px: Float, _ py: Float, _ poly: [Float]) -> Bool {
      var inside = false
      let n = poly.count / 2
      var j = n - 1
      for i in 0..<n {
        let xi = poly[i * 2]
        let yi = poly[i * 2 + 1]
        let xj = poly[j * 2]
        let yj = poly[j * 2 + 1]
        if (yi > py) != (yj > py), px < (xj - xi) * (py - yi) / (yj - yi) + xi {
          inside.toggle()
        }
        j = i
      }
      return inside
    }

    // Centers of lobe A and lobe B, normalized.
    let centerA = pointInPolygon(0.15, 0.16, only.polygon)
    let centerB = pointInPolygon(0.26, 0.16, only.polygon)
    check(centerA, "encloses lobe A's center")
    check(centerB, "encloses lobe B's center")
  }
}

suite("MaskContour.instances polygon vertex ceiling") {
  let width = 240
  let height = 240
  let jagged = jaggedGrid(width: width, height: height, value: 1)

  // Default epsilon: the escalation loop in simplifyBounded must bring a genuinely messy
  // trace under the ceiling on its own.
  let found = MaskContour.instances(
    labels: jagged, width: width, height: height, minPixelFraction: 0.001, simplifyEpsilon: 0.004)
  check(found.count == 1, "still finds exactly one instance in a jagged mask")
  if let only = found.first {
    let points = only.polygon.count / 2
    check(points <= 64, "caps a jagged boundary at the vertex ceiling under default epsilon")
    check(points >= 3, "still returns a usable polygon after capping")
  }

  // An epsilon so small that eight doublings still cannot reach a useful tolerance forces
  // the deterministic decimation fallback, not just the escalation loop, proving the cap
  // is guaranteed rather than merely likely.
  let forcedFallback = MaskContour.instances(
    labels: jagged, width: width, height: height, minPixelFraction: 0.001,
    simplifyEpsilon: 0.0000001)
  if let only = forcedFallback.first {
    let points = only.polygon.count / 2
    // decimate() always emits exactly maxVertices points once triggered, so landing on
    // exactly 64 here (not merely under it) is the fingerprint of the fallback actually
    // firing, not of escalation getting lucky.
    check(points == 64, "decimation fallback lands on exactly the vertex ceiling")
  } else {
    check(false, "still returns an instance when escalation cannot converge")
  }

  // A shape well under the ceiling must pass through simplifyBounded unchanged: no
  // escalation triggers, so this is the same result the plain rectangle suite above
  // already exercises. Restated here so the no-distortion guarantee sits next to the
  // ceiling checks it is a counterpart to.
  let plain = grid(width: 100, height: 100, rect: (20, 30, 40, 20), value: 1)
  let plainFound = MaskContour.instances(
    labels: plain, width: 100, height: 100, minPixelFraction: 0.001, simplifyEpsilon: 0.004)
  if let only = plainFound.first {
    check(
      only.polygon.count / 2 <= 20,
      "leaves a simple rectangle's point count unaffected by the ceiling")
  }
}

suite("FrameMetricsMath.varianceOfLaplacian") {
  let flat = [UInt8](repeating: 128, count: 64 * 64)
  check(
    FrameMetricsMath.varianceOfLaplacian(flat, width: 64, height: 64) < 1.0,
    "reports near zero for a flat grey image")

  var checker = [UInt8](repeating: 0, count: 64 * 64)
  for y in 0..<64 {
    for x in 0..<64 { checker[y * 64 + x] = (x / 4 + y / 4) % 2 == 0 ? 0 : 255 }
  }
  let sharp = FrameMetricsMath.varianceOfLaplacian(checker, width: 64, height: 64)
  check(sharp > 100.0, "reports a large value for a hard-edged checkerboard")

  // A blurred checkerboard must score below a crisp one. This ordering is the whole contract:
  // the gate only ever compares sharpness against a threshold.
  var blurred = checker
  for y in 1..<63 {
    for x in 1..<63 {
      let sum =
        Int(checker[(y - 1) * 64 + x]) + Int(checker[(y + 1) * 64 + x])
        + Int(checker[y * 64 + x - 1]) + Int(checker[y * 64 + x + 1]) + Int(checker[y * 64 + x])
      blurred[y * 64 + x] = UInt8(sum / 5)
    }
  }
  check(
    FrameMetricsMath.varianceOfLaplacian(blurred, width: 64, height: 64) < sharp,
    "ranks a blurred image below a crisp one")

  check(
    FrameMetricsMath.varianceOfLaplacian([], width: 0, height: 0) == 0,
    "returns zero for an empty image")
}

suite("FrameMetricsMath.meanAbsoluteDifference") {
  let a = [UInt8](repeating: 100, count: 256)
  check(FrameMetricsMath.meanAbsoluteDifference(a, a) == 0, "reports zero for identical frames")

  let b = [UInt8](repeating: 200, count: 256)
  let diff = FrameMetricsMath.meanAbsoluteDifference(a, b)
  check(abs(diff - 100.0 / 255.0) < 0.001, "normalizes the difference to 0 to 1")

  check(
    FrameMetricsMath.meanAbsoluteDifference(a, [UInt8](repeating: 1, count: 4)) == 1.0,
    "reports maximum motion when the frames are different sizes")

  check(FrameMetricsMath.meanAbsoluteDifference([], []) == 0, "returns zero for empty frames")
}

/// A deterministic photo-like luma image: smooth structure, a hard-edged box, and fine
/// per-pixel texture. The texture matters. Variance-of-Laplacian measures energy at the pixel
/// scale, so an image made only of smooth gradients cannot tell a working focus measure from a
/// broken one.
func photoLike(width: Int, height: Int) -> [UInt8] {
  var out = [UInt8](repeating: 0, count: width * height)
  var seed: UInt64 = 0x9E37_79B9_7F4A_7C15
  for y in 0..<height {
    for x in 0..<width {
      seed ^= seed << 13
      seed ^= seed >> 7
      seed ^= seed << 17
      let noise = Double(seed % 1000) / 1000.0
      var v = 90.0 + 60.0 * sin(Double(x) / Double(width) * 7.0)
        * cos(Double(y) / Double(height) * 5.0)
      if x > width / 4 && x < width * 3 / 4 && y > height / 4 && y < height * 3 / 4 { v += 60 }
      v += (noise - 0.5) * 55.0
      out[y * width + x] = UInt8(min(255, max(0, v)))
    }
  }
  return out
}

/// Separable box blur, the stand-in for defocus.
func boxBlur(_ src: [UInt8], width: Int, height: Int, radius: Int) -> [UInt8] {
  guard radius > 0 else { return src }
  var tmp = [Double](repeating: 0, count: width * height)
  var out = [UInt8](repeating: 0, count: width * height)
  for y in 0..<height {
    for x in 0..<width {
      var sum = 0.0
      for dx in -radius...radius { sum += Double(src[y * width + min(width - 1, max(0, x + dx))]) }
      tmp[y * width + x] = sum / Double(radius * 2 + 1)
    }
  }
  for y in 0..<height {
    for x in 0..<width {
      var sum = 0.0
      for dy in -radius...radius { sum += tmp[min(height - 1, max(0, y + dy)) * width + x] }
      out[y * width + x] = UInt8(min(255, max(0, sum / Double(radius * 2 + 1))))
    }
  }
  return out
}

func makePixelBuffer(_ luma: [UInt8], width: Int, height: Int, format: OSType) -> CVPixelBuffer? {
  var buffer: CVPixelBuffer?
  guard
    CVPixelBufferCreate(kCFAllocatorDefault, width, height, format, nil, &buffer)
      == kCVReturnSuccess,
    let out = buffer
  else { return nil }

  CVPixelBufferLockBaseAddress(out, [])
  defer { CVPixelBufferUnlockBaseAddress(out, []) }
  guard let base = CVPixelBufferGetBaseAddress(out)?.assumingMemoryBound(to: UInt8.self) else {
    return nil
  }
  let stride = CVPixelBufferGetBytesPerRow(out)
  // Only meaningful for the single-component case; a BGRA buffer is filled with the same bytes
  // purely so the format guard has something non-empty to reject.
  let bytesPerPixel = format == kCVPixelFormatType_OneComponent8 ? 1 : 4
  for y in 0..<height {
    for x in 0..<width {
      let value = luma[y * width + x]
      for b in 0..<bytesPerPixel { base[y * stride + x * bytesPerPixel + b] = value }
    }
  }
  return out
}

suite("FrameMetrics.measure through a real pixel buffer") {
  // The end-to-end check that was missing. Every other sharpness check calls FrameMetricsMath
  // directly on a small array, which never exercises how the frame is sampled. That is exactly
  // how a sampling step that destroyed the metric before it was measured survived review: the
  // maths was right and nothing tested the path.
  //
  // 1920x1080 specifically, because the defect scaled with the decimation factor and so does
  // any test for it. On these same images at 640x480 the old code decimated by 6 and still
  // separated sharp from blurred by 68x with the blurred frame at 79.6, under the threshold, so
  // a smaller test image would have passed over the bug exactly the way the existing checks
  // did. At 1080p the factor is 20, and the old path scored the 8px-blurred frame at 229.7,
  // over twice the threshold it was supposed to fail, with separation down to 22x.
  let width = 1920
  let height = 1080
  let sharpImage = photoLike(width: width, height: height)
  let blurredImage = boxBlur(sharpImage, width: width, height: height, radius: 4)

  guard
    let sharpBuffer = makePixelBuffer(
      sharpImage, width: width, height: height, format: kCVPixelFormatType_OneComponent8),
    let blurredBuffer = makePixelBuffer(
      blurredImage, width: width, height: height, format: kCVPixelFormatType_OneComponent8)
  else {
    check(false, "could not create the test pixel buffers")
    return
  }

  let sharp = FrameMetrics().measure(pixelBuffer: sharpBuffer).sharpness
  let blurred = FrameMetrics().measure(pixelBuffer: blurredBuffer).sharpness

  check(
    sharp > 1000,
    String(format: "scores a sharp frame far above minSharpness of 100 (got %.1f)", sharp))
  check(
    blurred < 100,
    String(format: "scores an 8px-blurred frame below minSharpness of 100 (got %.1f)", blurred))
  // 200x, not 20x. The old decimated path still managed 22x on these images, so a loose margin
  // would let the whole defect back in unnoticed. Native-resolution pixels separate these two
  // by three orders of magnitude, and anything close to 20x means the metric is being measured
  // on something other than the pixels focus actually acts on.
  check(
    sharp > blurred * 200,
    String(format: "separates sharp from blurred by a wide margin (%.0fx)", sharp / max(blurred, 0.0001)))

  // Sharpness comes off a centre crop, so a source smaller than the window must be measured
  // whole rather than fall off an edge or report nothing.
  if let small = makePixelBuffer(
    photoLike(width: 64, height: 48), width: 64, height: 48,
    format: kCVPixelFormatType_OneComponent8)
  {
    let value = FrameMetrics().measure(pixelBuffer: small).sharpness
    check(value > 100, String(format: "measures a source smaller than the crop window (%.1f)", value))
  } else {
    check(false, "could not create a sub-window pixel buffer")
  }

  // Motion is still the whole-frame comparison, and it still needs a previous frame.
  let stream = FrameMetrics()
  let first = stream.measure(pixelBuffer: sharpBuffer)
  check(first.motion == 1.0, "reports maximum motion for the first frame of a session")
  let second = stream.measure(pixelBuffer: sharpBuffer)
  check(second.motion == 0.0, "reports zero motion when the frame does not change")
  let third = stream.measure(pixelBuffer: blurredBuffer)
  check(third.motion > 0.0, "reports non-zero motion when the frame changes")

  // An unknown format is refused rather than read as luma. A BGRA buffer read as though its
  // bytes were pixels would sample a quarter of the image with interleaved channels and report
  // a number that looks like a measurement.
  if let bgra = makePixelBuffer(
    sharpImage, width: width, height: height, format: kCVPixelFormatType_32BGRA)
  {
    let measured = FrameMetrics().measure(pixelBuffer: bgra)
    check(measured.sharpness == 0, "refuses an unsupported pixel format instead of guessing")
    check(measured.motion == 1.0, "holds the gate shut on an unsupported pixel format")
  } else {
    check(false, "could not create a BGRA pixel buffer")
  }
}

print("")
if failures == 0 {
  print("All Swift checks passed.")
  exit(0)
} else {
  print("\(failures) Swift check(s) failed.")
  exit(1)
}
