// ios/Kart/MaskContour.swift
import CoreGraphics
import CoreVideo
import Foundation

/// Ceiling on polygon vertices after simplification. An overlay outline does not read
/// better beyond this many points, it is far above the 8 vertices an L-shape trace needs,
/// and it bounds what crosses the JSI boundary and gets re-fit by the tracker every frame.
private let MAX_POLYGON_VERTICES = 64

public struct MaskInstance {
  public let index: Int
  public let pixelCount: Int
  /// Normalized to the mask, origin top-left.
  public let box: CGRect
  /// Flat `[x0, y0, x1, y1, ...]`, normalized to the mask, origin top-left.
  public let polygon: [Float]
}

/// Converts a Vision instance mask into one outline per instance.
///
/// The boundary is traced directly out of the label grid rather than by running a
/// `VNDetectContoursRequest` per instance. One pass over a buffer we already have beats twenty
/// more Vision requests per detection cycle, and it removes any dependency on which pixel
/// formats that request happens to accept.
public enum MaskContour {

  /// Reads a Vision instance mask into a plain label grid.
  ///
  /// `VNInstanceMaskObservation.instanceMask` labels each pixel with its instance index, 0 for
  /// background. Both the one-component 8-bit and 32-bit float layouts are handled, because
  /// the format is not contractual and has differed between revisions.
  public static func labels(from mask: CVPixelBuffer) -> (labels: [UInt8], width: Int, height: Int)? {
    CVPixelBufferLockBaseAddress(mask, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }

    let width = CVPixelBufferGetWidth(mask)
    let height = CVPixelBufferGetHeight(mask)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(mask)
    guard width > 0, height > 0, let base = CVPixelBufferGetBaseAddress(mask) else { return nil }

    var out = [UInt8](repeating: 0, count: width * height)
    let format = CVPixelBufferGetPixelFormatType(mask)

    switch format {
    case kCVPixelFormatType_OneComponent8:
      let src = base.assumingMemoryBound(to: UInt8.self)
      for y in 0..<height {
        let row = src.advanced(by: y * bytesPerRow)
        for x in 0..<width { out[y * width + x] = row[x] }
      }
    case kCVPixelFormatType_OneComponent32Float:
      let src = base.assumingMemoryBound(to: UInt8.self)
      for y in 0..<height {
        let row = UnsafeRawPointer(src.advanced(by: y * bytesPerRow))
          .assumingMemoryBound(to: Float.self)
        for x in 0..<width {
          let v = row[x]
          out[y * width + x] = v <= 0 ? 0 : UInt8(min(255, max(0, v.rounded())))
        }
      }
    default:
      return nil
    }

    return (out, width, height)
  }

  public static func instances(
    from mask: CVPixelBuffer,
    minPixelFraction: Double = 0.002,
    simplifyEpsilon: Double = 0.004
  ) -> [MaskInstance] {
    guard let read = labels(from: mask) else { return [] }
    return instances(
      labels: read.labels, width: read.width, height: read.height,
      minPixelFraction: minPixelFraction, simplifyEpsilon: simplifyEpsilon)
  }

  public static func instances(
    labels: [UInt8],
    width: Int,
    height: Int,
    minPixelFraction: Double,
    simplifyEpsilon: Double
  ) -> [MaskInstance] {
    guard width > 0, height > 0, labels.count >= width * height else { return [] }

    // One pass to learn which labels exist, how big each is, and where each lives.
    var counts = [Int](repeating: 0, count: 256)
    var minX = [Int](repeating: Int.max, count: 256)
    var minY = [Int](repeating: Int.max, count: 256)
    var maxX = [Int](repeating: Int.min, count: 256)
    var maxY = [Int](repeating: Int.min, count: 256)

    for y in 0..<height {
      let row = y * width
      for x in 0..<width {
        let label = Int(labels[row + x])
        if label == 0 { continue }
        counts[label] += 1
        if x < minX[label] { minX[label] = x }
        if x > maxX[label] { maxX[label] = x }
        if y < minY[label] { minY[label] = y }
        if y > maxY[label] { maxY[label] = y }
      }
    }

    let minPixels = Int((Double(width * height) * minPixelFraction).rounded())
    let epsilonPixels = simplifyEpsilon * Double(max(width, height))
    var out: [MaskInstance] = []

    for label in 1..<256 where counts[label] > 0 && counts[label] >= max(minPixels, 3) {
      guard
        let traced = traceBoundary(
          labels: labels, width: width, height: height, label: UInt8(label),
          minX: minX[label], minY: minY[label], maxX: maxX[label], maxY: maxY[label])
      else { continue }

      let simplified = simplifyBounded(
        traced, epsilon: epsilonPixels, maxVertices: MAX_POLYGON_VERTICES)
      guard simplified.count >= 3 else { continue }

      var polygon = [Float]()
      polygon.reserveCapacity(simplified.count * 2)
      for point in simplified {
        polygon.append(Float(Double(point.x) / Double(width)))
        polygon.append(Float(Double(point.y) / Double(height)))
      }

      let box = CGRect(
        x: Double(minX[label]) / Double(width),
        y: Double(minY[label]) / Double(height),
        width: Double(maxX[label] - minX[label] + 1) / Double(width),
        height: Double(maxY[label] - minY[label] + 1) / Double(height))

      out.append(
        MaskInstance(index: label, pixelCount: counts[label], box: box, polygon: polygon))
    }

    return out
  }

  // MARK: - Boundary tracing

  private struct Point {
    let x: Int
    let y: Int
  }

  /// Eight-connected neighbours, clockwise from east.
  private static let neighbours: [(dx: Int, dy: Int)] = [
    (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1),
  ]

  /// Moore neighbourhood boundary tracing.
  ///
  /// Walks the outer edge of one label, keeping every turn, so concave shapes survive. The
  /// iteration cap is a guard against a pathological mask, not an expected exit.
  private static func traceBoundary(
    labels: [UInt8], width: Int, height: Int, label: UInt8,
    minX: Int, minY: Int, maxX: Int, maxY: Int
  ) -> [Point]? {
    func isLabel(_ x: Int, _ y: Int) -> Bool {
      guard x >= 0, y >= 0, x < width, y < height else { return false }
      return labels[y * width + x] == label
    }

    var start: Point?
    outer: for y in minY...maxY {
      for x in minX...maxX where isLabel(x, y) {
        start = Point(x: x, y: y)
        break outer
      }
    }
    guard let first = start else { return nil }

    var contour = [first]
    // Scanning found `first` moving left to right, so the pixel to its west is known background
    // and is the correct place to start looking from.
    let firstBacktrack = Point(x: first.x - 1, y: first.y)
    var backtrack = firstBacktrack
    var current = first
    let limit = 4 * (maxX - minX + 1) * (maxY - minY + 1) + 16

    for _ in 0..<limit {
      let entry =
        neighbours.firstIndex { current.x + $0.dx == backtrack.x && current.y + $0.dy == backtrack.y }
        ?? 4

      var moved = false
      var closed = false
      for step in 1...8 {
        let index = (entry + step) % 8
        let nx = current.x + neighbours[index].dx
        let ny = current.y + neighbours[index].dy
        if isLabel(nx, ny) {
          let previous = (entry + step - 1) % 8
          let newBacktrack = Point(
            x: current.x + neighbours[previous].dx, y: current.y + neighbours[previous].dy)

          // Jacob's stopping criterion. A region that touches itself at a single pixel, a
          // bowtie or dumbbell, revisits that pixel's coordinates mid-trace while arriving
          // from a different neighbor than the artificial backtrack used to start the walk.
          // That revisit is a genuine boundary vertex belonging to the other lobe, not the end
          // of the loop, so it must be kept and the walk must continue through it. The walk is
          // only closed when it returns to the start pixel by arriving from the exact same
          // neighbor it started from, which means the very first step is about to repeat.
          if nx == first.x, ny == first.y, newBacktrack.x == firstBacktrack.x,
            newBacktrack.y == firstBacktrack.y
          {
            closed = true
          } else {
            backtrack = newBacktrack
            current = Point(x: nx, y: ny)
            contour.append(current)
          }
          moved = true
          break
        }
      }

      // A single isolated pixel has no boundary to walk.
      if !moved { break }
      if closed { break }
    }

    return contour.count >= 3 ? contour : nil
  }

  // MARK: - Simplification

  /// Simplifies a closed contour to at most `maxVertices` points.
  ///
  /// Escalates `epsilon` first, since coarsening the tolerance is what turns a jagged
  /// trace into a clean outline, and doubling converges fast. Uniform decimation is a
  /// last-resort fallback for the rare contour escalation cannot tame in a bounded number
  /// of attempts (or a caller-supplied epsilon so small doubling cannot catch up), so the
  /// ceiling is guaranteed rather than merely likely. Decimation is not the primary
  /// strategy because picking every Nth point deforms a shape instead of coarsening it.
  private static func simplifyBounded(_ points: [Point], epsilon: Double, maxVertices: Int) -> [Point] {
    var result = simplify(points, epsilon: epsilon)
    if result.count <= maxVertices { return result }

    // A non-positive epsilon means simplify() left the contour untouched, so doubling it
    // would multiply zero by two forever. Start escalation from a nominal floor instead.
    var currentEpsilon = epsilon > 0 ? epsilon : 0.5
    for _ in 0..<8 {
      currentEpsilon *= 2
      result = simplify(points, epsilon: currentEpsilon)
      if result.count <= maxVertices { return result }
    }

    return decimate(result, maxVertices: maxVertices)
  }

  /// Keeps every Nth point of a closed contour so the result is guaranteed to fit within
  /// `maxVertices`. Used only once escalating epsilon has failed to converge, because
  /// picking points by position rather than by geometric significance can land on an
  /// awkward vertex instead of a genuine corner.
  private static func decimate(_ points: [Point], maxVertices: Int) -> [Point] {
    guard points.count > maxVertices, maxVertices >= 3 else { return points }
    var out: [Point] = []
    out.reserveCapacity(maxVertices)
    let step = Double(points.count) / Double(maxVertices)
    var cursor = 0.0
    for _ in 0..<maxVertices {
      out.append(points[Int(cursor) % points.count])
      cursor += step
    }
    return out
  }

  /// Ramer-Douglas-Peucker on a closed contour, applied to the open run and then re-closed.
  private static func simplify(_ points: [Point], epsilon: Double) -> [Point] {
    guard points.count > 3, epsilon > 0 else { return points }

    var keep = [Bool](repeating: false, count: points.count)
    keep[0] = true
    keep[points.count - 1] = true

    var stack = [(0, points.count - 1)]
    while let (from, to) = stack.popLast() {
      guard to > from + 1 else { continue }

      let ax = Double(points[from].x)
      let ay = Double(points[from].y)
      let bx = Double(points[to].x)
      let by = Double(points[to].y)
      let dx = bx - ax
      let dy = by - ay
      let length = (dx * dx + dy * dy).squareRoot()

      var worst = 0.0
      var worstIndex = from

      for i in (from + 1)..<to {
        let px = Double(points[i].x)
        let py = Double(points[i].y)
        // Perpendicular distance, degrading to plain distance when the segment is a point.
        let distance =
          length == 0
          ? ((px - ax) * (px - ax) + (py - ay) * (py - ay)).squareRoot()
          : abs(dy * px - dx * py + bx * ay - by * ax) / length
        if distance > worst {
          worst = distance
          worstIndex = i
        }
      }

      if worst > epsilon {
        keep[worstIndex] = true
        stack.append((from, worstIndex))
        stack.append((worstIndex, to))
      }
    }

    return points.enumerated().filter { keep[$0.offset] }.map(\.element)
  }
}
