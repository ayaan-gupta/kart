// scripts/swift-tests/main.swift
//
// Unit tests for the parts of the detector that are pure geometry. Compiled together with the
// app's Swift sources by `npm run test:swift`, so there is no Xcode test target to keep in
// sync with a project file that Expo regenerates.

import CoreGraphics
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
