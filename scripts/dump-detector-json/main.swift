// scripts/dump-detector-json.swift
//
// One-off tool: runs the real, unmodified AppleInstanceMaskDetector against one image and
// prints full instance data (box + complete polygon vertex array + score) as JSON to stdout.
//
// Exists because `npm run bench:detector` (scripts/detector-bench/main.swift) only records a
// vertex *count* in report.json, not the vertices themselves, and this task needs the real
// polygon coordinates to seed the Frame Lab screen's "replay captured Vision output" fixture
// (see .superpowers/sdd/2026-08-14-kart-fusion-and-ui/simulator-e2e-report.md for why: the iOS
// Simulator cannot run VNGenerateForegroundInstanceMaskRequest at all, Vision error code 9,
// "Could not create inference context", confirmed by this exact detector code succeeding when
// run outside the Simulator sandbox against the same image).
//
// Run with the `swift` interpreter (top-level statements, not compiled with the app's sources):
//   swift scripts/dump-detector-json.swift assets/dev/cart-lab-sample.png

import CoreGraphics
import CoreVideo
import Foundation
import ImageIO

guard CommandLine.arguments.count > 1 else {
  print("usage: dump-detector-json <image.png>")
  exit(2)
}
let imagePath = CommandLine.arguments[1]

func loadImage(_ path: String) -> CGImage? {
  guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(source, 0, nil)
}

func makeBuffer(_ image: CGImage) -> CVPixelBuffer? {
  var buffer: CVPixelBuffer?
  let attributes: [CFString: Any] = [
    kCVPixelBufferCGImageCompatibilityKey: true,
    kCVPixelBufferCGBitmapContextCompatibilityKey: true,
  ]
  guard
    CVPixelBufferCreate(
      kCFAllocatorDefault, image.width, image.height, kCVPixelFormatType_32BGRA,
      attributes as CFDictionary, &buffer) == kCVReturnSuccess,
    let out = buffer
  else { return nil }

  CVPixelBufferLockBaseAddress(out, [])
  defer { CVPixelBufferUnlockBaseAddress(out, []) }
  let space = CGColorSpaceCreateDeviceRGB()
  let info = CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
  guard
    let context = CGContext(
      data: CVPixelBufferGetBaseAddress(out), width: image.width, height: image.height,
      bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(out), space: space, bitmapInfo: info)
  else { return nil }
  context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
  return out
}

guard let image = loadImage(imagePath), let buffer = makeBuffer(image) else {
  print("could not load/build buffer for \(imagePath)")
  exit(1)
}

let detector = AppleInstanceMaskDetector()
let instances: [DetectedInstance]
do {
  instances = try detector.detect(pixelBuffer: buffer, orientation: .up)
} catch {
  print("detect failed: \(error)")
  exit(1)
}

struct OutInstance: Encodable {
  let box: [String: Double]
  let polygon: [Float]
  let score: Float
}
let out = instances.map {
  OutInstance(
    box: ["x": $0.box.minX, "y": $0.box.minY, "w": $0.box.width, "h": $0.box.height],
    polygon: $0.polygon, score: $0.score)
}
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let data = try! encoder.encode(out)
print(String(decoding: data, as: UTF8.self))
