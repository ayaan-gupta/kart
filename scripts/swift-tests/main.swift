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

/// Overload for the KartImageTools suite below, whose calls put the check's name first and an
/// optional detail last. Added rather than changing the two-argument `check` above, which the
/// rest of this file already relies on with its condition-first, message-second order.
func check(_ name: String, _ condition: Bool, _ detail: String = "") {
  if condition {
    print("  ok   \(name)")
  } else {
    print("  FAIL \(name)\(detail.isEmpty ? "" : " (\(detail))")")
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

suite("MaskContour.instances instance ceiling") {
  // 80 squares, one per label, areas strictly increasing with the label. A Vision mask can
  // carry all 255 labels, and nothing but this cap stops them: the vertex ceiling bounds one
  // outline, not how many outlines there are, and byteTrack.ts runs an O(n^3) Hungarian solve
  // twice a frame on whatever it is handed.
  let cell = 100
  let columns = 10
  let width = cell * columns
  let height = cell * 8
  var labels = [UInt8](repeating: 0, count: width * height)
  for k in 0..<80 {
    let side = 10 + k  // 10x10 up to 89x89, so no two labels share an area
    let originX = (k % columns) * cell + 2
    let originY = (k / columns) * cell + 2
    for y in originY..<(originY + side) {
      for x in originX..<(originX + side) { labels[y * width + x] = UInt8(k + 1) }
    }
  }

  // 0.0001 of 800000 pixels is 80, under the 100-pixel area of the smallest square, so the
  // size floor rejects nothing and the cap is the only thing doing any work here.
  let found = MaskContour.instances(
    labels: labels, width: width, height: height, minPixelFraction: 0.0001,
    simplifyEpsilon: 0.004)

  check(found.count == 64, "caps the instance count at 64 (got \(found.count))")

  let kept = Set(found.map(\.index))
  // Areas increase with the label, so the 64 largest are labels 17 through 80 exactly.
  check(kept == Set(17...80), "keeps the 64 largest instances and drops the smallest 16")
  check(
    found.map(\.index) == found.map(\.index).sorted(),
    "still returns the kept instances in label order")

  let smallestKept = found.map(\.pixelCount).min() ?? 0
  check(
    smallestKept == 26 * 26,
    "the smallest kept instance is larger than every dropped one (got \(smallestKept))")

  // Under the cap nothing is selected away, which is the case every real cart hits.
  var few = [UInt8](repeating: 0, count: width * height)
  for k in 0..<5 {
    let originX = k * cell + 2
    for y in 2..<40 {
      for x in originX..<(originX + 38) { few[y * width + x] = UInt8(k + 1) }
    }
  }
  let underCap = MaskContour.instances(
    labels: few, width: width, height: height, minPixelFraction: 0.0001, simplifyEpsilon: 0.004)
  check(underCap.count == 5, "leaves a mask under the ceiling untouched")
}

// `AppleInstanceMaskDetector` selects candidate labels on one grid (the raw, low-resolution
// `instanceMask`, measured at a fixed 512x512 regardless of frame size) and then traces each
// selected instance's final polygon on a *different* grid (the per-instance buffer from
// `generateScaledMaskForImage`, measured to match the oriented frame's own dimensions). These
// two grids differ in both size and aspect ratio on every real camera frame. The suites below
// cover that mismatch directly: selection on a small grid must not leak into normalization of
// the differently-sized grid actually traced.
suite("MaskContour.selectCandidates matches the selection instances() used to do inline") {
  let labels = grid(width: 100, height: 100, rect: (10, 10, 30, 20), value: 1)
  let candidates = MaskContour.selectCandidates(
    labels: labels, width: 100, height: 100, minPixelFraction: 0.001)

  check(candidates.count == 1, "finds the one labeled region")
  if let only = candidates.first {
    check(only.label == 1, "reports the region's label")
    check(only.pixelCount == 600, "counts its pixels")
    check(only.minX == 10 && only.minY == 10, "reports its pixel-space origin")
    check(only.maxX == 39 && only.maxY == 29, "reports its pixel-space extent")
  }

  let filtered = MaskContour.selectCandidates(
    labels: labels, width: 100, height: 100, minPixelFraction: 0.5)
  check(filtered.isEmpty, "drops a region below the minimum pixel fraction, same as instances()")
}

suite("MaskContour.traceIsolatedInstance normalizes to its own grid, not a selection grid") {
  // The "selection" grid: small and square, standing in for the fixed low-resolution
  // instanceMask. Only used to prove the trace below does not depend on it.
  let selectionLabels = grid(width: 8, height: 8, rect: (0, 0, 4, 4), value: 1)
  let selectionCandidates = MaskContour.selectCandidates(
    labels: selectionLabels, width: 8, height: 8, minPixelFraction: 0.01)
  check(selectionCandidates.count == 1, "selection grid still finds its one region")

  // The "trace" grid: a wide, differently-aspected grid standing in for a
  // generateScaledMaskForImage single-instance buffer sized to a real oriented frame. A
  // rectangle hard against the right edge, well clear of where the selection grid's own
  // region would land if its coordinates were mistakenly reused here.
  let width = 200
  let height = 50
  let traceLabels = grid(width: width, height: height, rect: (150, 10, 50, 30), value: 1)

  let instance = MaskContour.traceIsolatedInstance(
    labels: traceLabels, width: width, height: height, index: 7, simplifyEpsilon: 0.004)

  guard let instance else {
    check(false, "traces the isolated instance")
    return
  }

  check(instance.index == 7, "carries through the caller-supplied index unchanged")
  check(instance.pixelCount == 50 * 30, "counts the traced region's pixels")
  // Normalized against the 200x50 trace grid, not the 8x8 selection grid: minX 150/200 = 0.75,
  // reaching the right edge at (150+50)/200 = 1.0. Reusing the selection grid's dimensions here
  // would put these numbers nowhere near the true position.
  check(abs(instance.box.minX - 0.75) < 0.02, "normalizes x by the trace grid's own width")
  check(abs(instance.box.maxX - 1.0) < 0.02, "reaches the trace grid's right edge, not the 8x8 grid's")
  check(abs(instance.box.minY - 0.20) < 0.03, "normalizes y by the trace grid's own height")
  check(
    instance.polygon.allSatisfy { $0 >= -0.001 && $0 <= 1.001 },
    "keeps polygon points normalized to the trace grid, not the selection grid")
}

suite("MaskContour.traceIsolatedInstance treats any nonzero pixel as foreground") {
  // generateScaledMaskForImage was measured to use 1 for foreground, but the doc comment on
  // AppleInstanceMaskDetector.detect notes this is not a documented guarantee, so the tracer
  // matches "nonzero" rather than exactly 1. A high value stands in for a soft-edged matte.
  let labels = grid(width: 40, height: 40, rect: (5, 5, 10, 10), value: 200)
  let instance = MaskContour.traceIsolatedInstance(
    labels: labels, width: 40, height: 40, index: 1, simplifyEpsilon: 0.004)
  check(instance != nil, "traces a region whose label value is not 1")
  check(instance?.pixelCount == 100, "still counts every foreground pixel regardless of its value")
}

suite("MaskContour.traceIsolatedInstance edge cases") {
  let empty = [UInt8](repeating: 0, count: 20 * 20)
  check(
    MaskContour.traceIsolatedInstance(
      labels: empty, width: 20, height: 20, index: 1, simplifyEpsilon: 0.004) == nil,
    "returns nil for an all-background grid")

  check(
    MaskContour.traceIsolatedInstance(
      labels: [], width: 0, height: 0, index: 1, simplifyEpsilon: 0.004) == nil,
    "returns nil for a zero-size grid")
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

  // Sharpness comes off fixed-size tiles, so a source smaller than one tile must be measured
  // whole rather than fall off an edge or report nothing.
  if let small = makePixelBuffer(
    photoLike(width: 64, height: 48), width: 64, height: 48,
    format: kCVPixelFormatType_OneComponent8)
  {
    let value = FrameMetrics().measure(pixelBuffer: small).sharpness
    check(value > 100, String(format: "measures a source smaller than one tile (%.1f)", value))
  } else {
    check(false, "could not create a sub-window pixel buffer")
  }

  // The case the tile grid exists for, and the reason a single window could not stay.
  //
  // A sharp frame whose centre is a bright, aggressively denoised flat surface: a pizza box, a
  // case of water or a carrier bag filling the middle of a bird's-eye shot, which is an ordinary
  // frame rather than a corner case. The flat patch is 700x500, enough to swallow any single
  // centre window whole while leaving the outer tiles textured. Measured through this same path,
  // a 256x256 centre window scored this frame 13.4 and the gate refused it as blurry while it
  // was perfectly in focus. Worse than the false negative: with one window `minSharpness` is
  // untunable in principle, because its value depends on which three percent of the cart happens
  // to sit under the reticle.
  var flatCentre = sharpImage
  var flatSeed: UInt64 = 0x0123_4567
  let flatWidth = 700
  let flatHeight = 500
  let flatX = (width - flatWidth) / 2
  let flatY = (height - flatHeight) / 2
  for y in flatY..<(flatY + flatHeight) {
    for x in flatX..<(flatX + flatWidth) {
      flatSeed ^= flatSeed << 13
      flatSeed ^= flatSeed >> 7
      flatSeed ^= flatSeed << 17
      // Near-white with barely a bit of dither, so its own variance is nowhere near the gate.
      flatCentre[y * width + x] = UInt8(239 + Int(flatSeed % 3))
    }
  }
  if let flatBuffer = makePixelBuffer(
    flatCentre, width: width, height: height, format: kCVPixelFormatType_OneComponent8)
  {
    let value = FrameMetrics().measure(pixelBuffer: flatBuffer).sharpness
    check(
      value > 1000,
      String(format: "keeps a sharp frame with a flat centre well above the threshold (%.1f)", value))
  } else {
    check(false, "could not create a flat-centre pixel buffer")
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
    // Holding the gate silently would route this straight around the error channel the plugin
    // exists to feed: every frame scores 0 forever and nothing anywhere says why.
    check(
      measured.error != nil, "says why it refused rather than jamming the gate shut in silence")
    if let reason = measured.error {
      check(reason.contains("BGRA"), "names the offending pixel format (\(reason))")
    }
  } else {
    check(false, "could not create a BGRA pixel buffer")
  }
}

/// Draws an asymmetric test card: a red square in the TOP LEFT of upright space, blue elsewhere.
func testCard(width: Int, height: Int) -> CGImage {
  let ctx = CGContext(
    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  ctx.setFillColor(CGColor(red: 0, green: 0, blue: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
  ctx.setFillColor(CGColor(red: 1, green: 0, blue: 0, alpha: 1))
  // CGContext origin is bottom-left, so the visual TOP left is high y.
  ctx.fill(CGRect(x: 0, y: height * 3 / 4, width: width / 4, height: height / 4))
  return ctx.makeImage()!
}

/// Reads one pixel from a JPEG, in top-left origin normalized coordinates.
func pixel(_ jpeg: Data, atX nx: Double, y ny: Double) -> (r: Int, g: Int, b: Int) {
  let src = CGImageSourceCreateWithData(jpeg as CFData, nil)!
  let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
  let w = img.width, h = img.height
  var buf = [UInt8](repeating: 0, count: w * h * 4)
  let ctx = CGContext(
    data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  let px = min(w - 1, max(0, Int(nx * Double(w))))
  // A CGBitmapContext's memory row 0 is the visual TOP row: CG user space is bottom-left
  // origin, so drawing into (0,0,w,h) puts the image's top edge at the highest y, which is
  // where row 0 lives. Normalized top-left y therefore maps straight through, with no flip.
  let py = min(h - 1, max(0, Int(ny * Double(h))))
  let i = (py * w + px) * 4
  return (Int(buf[i]), Int(buf[i + 1]), Int(buf[i + 2]))
}

func jpegSize(_ d: Data) -> (Int, Int) {
  let src = CGImageSourceCreateWithData(d as CFData, nil)!
  let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
  return (img.width, img.height)
}

print("uprightTransform")
for (name, o, swaps) in [
  ("up", CGImagePropertyOrientation.up, false), ("right", .right, true),
  ("left", .left, true), ("down", .down, false),
] {
  let (_, size) = KartImageTools.uprightTransform(o, width: 400, height: 200)
  check("\(name) size", swaps ? (size.width == 200 && size.height == 400) : (size.width == 400 && size.height == 200), "got \(size)")
}

print("jpegData: downscaling")
let card = testCard(width: 2000, height: 1500)
let big = KartImageTools.jpegData(from: card, orientation: .up, maxEdge: 1536, quality: 0.78)!
let (bw, bh) = jpegSize(big)
check("longest edge capped", bw == 1536, "got \(bw)")
check("aspect preserved", abs(Double(bh) - 1152) <= 1, "got \(bh)")
check("upload size is sane", big.count < 400_000 && big.count > 1_000, "\(big.count) bytes")

let small = testCard(width: 300, height: 200)
let (sw, _) = jpegSize(KartImageTools.jpegData(from: small, orientation: .up, maxEdge: 1536, quality: 0.78)!)
check("never upscales", sw == 300, "got \(sw)")

print("jpegData: orientation")
// .up must leave the red square in the visual top left.
let p = pixel(big, atX: 0.1, y: 0.1)
check("up keeps red top-left", p.r > 200 && p.b < 60, "got \(p)")
let pbr = pixel(big, atX: 0.9, y: 0.9)
check("up keeps blue bottom-right", pbr.b > 200 && pbr.r < 60, "got \(pbr)")

// A buffer tagged .right needs a +90 rotation to become upright. Feeding the same card in as
// .right must therefore MOVE the red square off the top left.
let rotated = KartImageTools.jpegData(from: card, orientation: .right, maxEdge: 1536, quality: 0.78)!
let (rw, rh) = jpegSize(rotated)
check("right swaps dimensions", rw < rh, "got \(rw)x\(rh)")
let rp = pixel(rotated, atX: 0.1, y: 0.1)
check("right moves the marker", !(rp.r > 200 && rp.b < 60), "got \(rp)")

// Addition beyond the brief's verbatim suite: "moved off top-left" alone cannot tell a correct
// 90 degree rotation from one rotated the wrong way, and .left/.right were in fact swapped in
// an earlier version of KartImageTools.swift here, confirmed independently against
// CGImageSourceCreateThumbnailAtIndex(..., kCGImageSourceCreateThumbnailWithTransform: true),
// which is Apple's own EXIF-orientation correction and not code from this file. EXIF 6 (.right)
// is "rotate 90 CW to correct", which carries the marker from top-left to top-right; EXIF 8
// (.left) is "rotate 90 CCW to correct", which carries it to bottom-left. Pinning the exact
// corner, not just "moved", is what would have caught the swap.
let rp2 = pixel(rotated, atX: 0.9, y: 0.1)
check("right places the marker at top-right, not left's corner", rp2.r > 200 && rp2.b < 60, "got \(rp2)")
let leftRotated = KartImageTools.jpegData(from: card, orientation: .left, maxEdge: 1536, quality: 0.78)!
let lrSize = jpegSize(leftRotated)
check("left also swaps dimensions", lrSize.0 < lrSize.1, "got \(lrSize)")
let lp = pixel(leftRotated, atX: 0.1, y: 0.9)
check("left places the marker at bottom-left, not right's corner", lp.r > 200 && lp.b < 60, "got \(lp)")

// Independent cross-check that does not trust the reader's convention: crop the four corners
// with cropJpeg (whose top-left origin is proven by CGImage.cropping) and assert exactly one
// of them is the red marker, and that it is the top-left one.
print("orientation cross-check via cropJpeg")
func cornerIsRed(_ jpeg: Data, x: Double, y: Double) -> Bool {
  guard let c = KartImageTools.cropJpeg(
    jpeg, box: CGRect(x: x, y: y, width: 0.12, height: 0.12), padding: 0, maxEdge: 64, quality: 0.9)
  else { return false }
  let px = pixel(c, atX: 0.5, y: 0.5)
  return px.r > 200 && px.b < 60
}
check("top-left corner is the marker", cornerIsRed(big, x: 0.02, y: 0.02))
check("top-right corner is not", !cornerIsRed(big, x: 0.86, y: 0.02))
check("bottom-left corner is not", !cornerIsRed(big, x: 0.02, y: 0.86))
check("bottom-right corner is not", !cornerIsRed(big, x: 0.86, y: 0.86))

print("cropJpeg")
// Crop the red quadrant back out of the upright frame. No padding, so it should be all red.
let crop = KartImageTools.cropJpeg(big, box: CGRect(x: 0, y: 0, width: 0.25, height: 0.25), padding: 0, maxEdge: 256, quality: 0.8)!
let (cw, ch) = jpegSize(crop)
check("crop is capped at maxEdge", max(cw, ch) == 256, "got \(cw)x\(ch)")
let cc = pixel(crop, atX: 0.5, y: 0.5)
check("crop centre is the red item", cc.r > 200 && cc.b < 60, "got \(cc)")
check("thumbnail is small on disk", crop.count < 30_000, "\(crop.count) bytes")

// Padding must pull in surrounding context, so the far corner is no longer pure red.
let padded = KartImageTools.cropJpeg(big, box: CGRect(x: 0, y: 0, width: 0.25, height: 0.25), padding: 0.6, maxEdge: 256, quality: 0.8)!
let pc = pixel(padded, atX: 0.95, y: 0.95)
check("padding includes context", pc.b > 150, "got \(pc)")

// A box running off the edge is clamped, not rejected. This is the half-out-of-view item.
let overflow = KartImageTools.cropJpeg(big, box: CGRect(x: 0.9, y: 0.9, width: 0.5, height: 0.5), padding: 0.1, maxEdge: 256, quality: 0.8)
check("box off the edge is clamped, not nil", overflow != nil)

// A box entirely outside the frame has nothing to show and must return nil rather than a
// 1x1 sliver that would render as a grey smudge in the bag.
check("box fully outside returns nil",
      KartImageTools.cropJpeg(big, box: CGRect(x: 3, y: 3, width: 0.2, height: 0.2), padding: 0, maxEdge: 256, quality: 0.8) == nil)
check("zero-area box returns nil",
      KartImageTools.cropJpeg(big, box: CGRect(x: 0.5, y: 0.5, width: 0, height: 0), padding: 0, maxEdge: 256, quality: 0.8) == nil)

print("base64 round trip")
let b64 = big.base64EncodedString()
check("base64 decodes back", Data(base64Encoded: b64)?.count == big.count)
check("base64 payload is uploadable", b64.count < 550_000, "\(b64.count) chars")

print("")
if failures == 0 {
  print("All Swift checks passed.")
  exit(0)
} else {
  print("\(failures) Swift check(s) failed.")
  exit(1)
}
