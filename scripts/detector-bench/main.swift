// scripts/detector-bench/main.swift
//
// Runs a KartDetector over a folder of photographs and reports what it found.
//
//   npm run bench:detector -- --input server/eval/corpus/images --output /tmp/kart-bench
//
// Writes one annotated PNG per input image plus a report.json, and prints a summary table.
// This is the instrument that decides which detector ships: run it against real cart photos
// and compare the instance counts to what is actually in the cart.

import CoreGraphics
import CoreText
import CoreVideo
import Foundation
import ImageIO
import UniformTypeIdentifiers

// MARK: - Arguments

func argument(_ name: String, default fallback: String? = nil) -> String? {
  let args = CommandLine.arguments
  guard let i = args.firstIndex(of: "--\(name)"), i + 1 < args.count else { return fallback }
  return args[i + 1]
}

guard let inputPath = argument("input") else {
  print("usage: detector-bench --input <dir> [--output <dir>] [--min-pixel-fraction N] [--epsilon N]")
  exit(2)
}

let outputPath = argument("output", default: "/tmp/kart-bench")!
let minPixelFraction = Double(argument("min-pixel-fraction", default: "0.002")!) ?? 0.002
let epsilon = Double(argument("epsilon", default: "0.004")!) ?? 0.004

let detector: KartDetector = AppleInstanceMaskDetector(
  minPixelFraction: minPixelFraction, simplifyEpsilon: epsilon)

// MARK: - Image loading

func loadImage(_ url: URL) -> CGImage? {
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(source, 0, nil)
}

func makeBuffer(_ image: CGImage, gray: Bool) -> CVPixelBuffer? {
  var buffer: CVPixelBuffer?
  let format = gray ? kCVPixelFormatType_OneComponent8 : kCVPixelFormatType_32BGRA
  let attributes: [CFString: Any] = [
    kCVPixelBufferCGImageCompatibilityKey: true,
    kCVPixelBufferCGBitmapContextCompatibilityKey: true,
  ]
  guard
    CVPixelBufferCreate(
      kCFAllocatorDefault, image.width, image.height, format, attributes as CFDictionary, &buffer)
      == kCVReturnSuccess,
    let out = buffer
  else { return nil }

  CVPixelBufferLockBaseAddress(out, [])
  defer { CVPixelBufferUnlockBaseAddress(out, []) }

  let space = gray ? CGColorSpaceCreateDeviceGray() : CGColorSpaceCreateDeviceRGB()
  let info =
    gray
    ? CGImageAlphaInfo.none.rawValue
    : CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue

  guard
    let context = CGContext(
      data: CVPixelBufferGetBaseAddress(out), width: image.width, height: image.height,
      bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(out), space: space,
      bitmapInfo: info)
  else { return nil }

  context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
  return out
}

func grayBytes(_ buffer: CVPixelBuffer) -> (luma: [UInt8], width: Int, height: Int) {
  CVPixelBufferLockBaseAddress(buffer, .readOnly)
  defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
  let width = CVPixelBufferGetWidth(buffer)
  let height = CVPixelBufferGetHeight(buffer)
  let stride = CVPixelBufferGetBytesPerRow(buffer)
  guard let base = CVPixelBufferGetBaseAddress(buffer)?.assumingMemoryBound(to: UInt8.self) else {
    return ([], 0, 0)
  }
  var out = [UInt8](repeating: 0, count: width * height)
  for y in 0..<height {
    let row = base.advanced(by: y * stride)
    for x in 0..<width { out[y * width + x] = row[x] }
  }
  return (out, width, height)
}

// MARK: - Annotation

let palette: [(r: Double, g: Double, b: Double)] = [
  (0.00, 0.90, 1.00), (1.00, 0.42, 0.42), (0.45, 0.95, 0.45), (1.00, 0.85, 0.20),
  (0.85, 0.45, 1.00), (1.00, 0.60, 0.20), (0.35, 0.65, 1.00), (1.00, 0.35, 0.75),
]

func annotate(_ image: CGImage, instances: [DetectedInstance], to url: URL) {
  let width = image.width
  let height = image.height
  guard
    let context = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
  else { return }

  context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  context.setLineWidth(max(2, Double(max(width, height)) / 400))

  for (i, instance) in instances.enumerated() {
    let colour = palette[i % palette.count]
    guard instance.polygon.count >= 6 else { continue }

    let path = CGMutablePath()
    // The detector reports origin top-left; CoreGraphics draws origin bottom-left, so y flips.
    for point in stride(from: 0, to: instance.polygon.count - 1, by: 2) {
      let x = Double(instance.polygon[point]) * Double(width)
      let y = (1 - Double(instance.polygon[point + 1])) * Double(height)
      if point == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
    }
    path.closeSubpath()

    context.setFillColor(red: colour.r, green: colour.g, blue: colour.b, alpha: 0.28)
    context.addPath(path)
    context.fillPath()
    context.setStrokeColor(red: colour.r, green: colour.g, blue: colour.b, alpha: 1.0)
    context.addPath(path)
    context.strokePath()

    // CoreText attribute keys, not the AppKit or UIKit ones. `.font` and `.foregroundColor`
    // are extensions those frameworks add, and neither is linked here.
    let font = CTFontCreateWithName("Helvetica-Bold" as CFString, Double(max(width, height)) / 40, nil)
    let label = NSAttributedString(
      string: "\(i + 1)",
      attributes: [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String):
          CGColor(red: 1, green: 1, blue: 1, alpha: 1),
      ])
    context.textPosition = CGPoint(
      x: Double(instance.box.minX) * Double(width) + 6,
      y: (1 - Double(instance.box.minY)) * Double(height) - Double(max(width, height)) / 34)
    CTLineDraw(CTLineCreateWithAttributedString(label), context)
  }

  guard
    let output = context.makeImage(),
    let destination = CGImageDestinationCreateWithURL(
      url as CFURL, UTType.png.identifier as CFString, 1, nil)
  else { return }
  CGImageDestinationAddImage(destination, output, nil)
  CGImageDestinationFinalize(destination)
}

// MARK: - Run

let inputURL = URL(fileURLWithPath: inputPath)
let outputURL = URL(fileURLWithPath: outputPath)
try? FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)

let extensions: Set<String> = ["jpg", "jpeg", "png", "heic", "heif"]
let files =
  ((try? FileManager.default.contentsOfDirectory(at: inputURL, includingPropertiesForKeys: nil)) ?? [])
  .filter { extensions.contains($0.pathExtension.lowercased()) }
  .sorted { $0.lastPathComponent < $1.lastPathComponent }

if files.isEmpty {
  print("No images found in \(inputPath).")
  print("Drop cart photos there and run again. Without photos this reports nothing,")
  print("which is the honest outcome and not a bug.")
  exit(1)
}

/// String(format:) does not honour a width specifier for %@, so columns are padded by hand.
func pad(_ text: String, _ width: Int) -> String {
  text.count >= width ? String(text.prefix(width)) : text + String(repeating: " ", count: width - text.count)
}
func padLeft(_ text: String, _ width: Int) -> String {
  text.count >= width ? text : String(repeating: " ", count: width - text.count) + text
}

var rows: [[String: Any]] = []
print("")
print(pad("image", 32) + padLeft("items", 7) + padLeft("ms", 9) + padLeft("sharp", 9) + padLeft("pts/item", 10))
print(String(repeating: "-", count: 67))

for file in files {
  guard let image = loadImage(file), let colour = makeBuffer(image, gray: false) else {
    print("\(file.lastPathComponent): could not decode")
    continue
  }

  let started = Date()
  let instances = (try? detector.detect(pixelBuffer: colour, orientation: .up)) ?? []
  let elapsedMs = Date().timeIntervalSince(started) * 1000

  var sharpness = 0.0
  if let gray = makeBuffer(image, gray: true) {
    let sample = grayBytes(gray)
    sharpness = FrameMetricsMath.varianceOfLaplacian(
      sample.luma, width: sample.width, height: sample.height)
  }

  annotate(image, instances: instances, to: outputURL.appendingPathComponent(
    file.deletingPathExtension().lastPathComponent + ".annotated.png"))

  let averagePoints =
    instances.isEmpty ? 0 : instances.map { $0.polygon.count / 2 }.reduce(0, +) / instances.count

  print(
    pad(file.lastPathComponent, 32) + padLeft("\(instances.count)", 7)
      + padLeft(String(format: "%.1f", elapsedMs), 9)
      + padLeft(String(format: "%.0f", sharpness), 9) + padLeft("\(averagePoints)", 10))

  rows.append([
    "image": file.lastPathComponent,
    "width": image.width,
    "height": image.height,
    "detector": detector.name,
    "instanceCount": instances.count,
    "detectMs": elapsedMs,
    "sharpness": sharpness,
    "instances": instances.map { instance in
      [
        "areaFraction": instance.box.width * instance.box.height,
        "points": instance.polygon.count / 2,
        "score": instance.score,
        "box": [
          "x": instance.box.minX, "y": instance.box.minY,
          "w": instance.box.width, "h": instance.box.height,
        ],
      ] as [String: Any]
    },
  ])
}

let counts = rows.compactMap { $0["instanceCount"] as? Int }
print(String(repeating: "-", count: 67))
if !counts.isEmpty {
  // Double, not integer division. An integer mean reads 0 for any run averaging under one
  // item per image, which is exactly the failing case this table exists to show.
  let mean = Double(counts.reduce(0, +)) / Double(counts.count)
  print(String(
    format: "images: %d   min items: %d   max: %d   mean: %.1f",
    counts.count, counts.min()!, counts.max()!, mean))
}
print("annotated images written to \(outputPath)")
print("")
print("Open the annotated images before reading anything into the numbers. A count that looks")
print("right can still be twenty outlines on the wrong things.")

let report: [String: Any] = [
  "detector": detector.name,
  "minPixelFraction": minPixelFraction,
  "simplifyEpsilon": epsilon,
  "images": rows,
]
if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
  try? data.write(to: outputURL.appendingPathComponent("report.json"))
}
