// scripts/generate-dev-test-image.swift
//
// Builds the bundled test photograph used by the developer Frame Lab screen
// (src/app/dev/frame-lab.tsx). Run with the `swift` interpreter, not `swiftc`, so top-level
// statements are allowed in a file that is not named `main.swift`:
//
//   swift scripts/generate-dev-test-image.swift assets/dev/cart-lab-sample.png
//
// Draws several distinct, separated, high-contrast shapes on a neutral background, standing in
// for grocery items sitting in a cart. Vision's VNGenerateForegroundInstanceMaskRequest (see
// ios/Kart/AppleInstanceMaskDetector.swift) segments "salient objects that can be separated from
// the background", so each shape gets its own drop shadow and a soft gradient fill: enough
// contrast and edge energy to read as a distinct foreground object and to score well on
// FrameMetrics' variance-of-Laplacian sharpness gate, without needing any downloaded or personal
// photo.

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count > 1 else {
  print("usage: generate-dev-test-image <output.png>")
  exit(2)
}
let outputURL = URL(fileURLWithPath: CommandLine.arguments[1])

let width = 1080
let height = 1440

guard
  let context = CGContext(
    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
else {
  print("could not create CGContext")
  exit(1)
}

// A flat, slightly warm countertop-grey background. Neutral enough that every shape below
// contrasts against it regardless of its own colour.
context.setFillColor(CGColor(red: 0.86, green: 0.85, blue: 0.83, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: width, height: height))

struct Shape {
  let rect: CGRect
  let color: (r: CGFloat, g: CGFloat, b: CGFloat)
  let kind: String  // "box" or "oval", so the set is not all rectangles
}

// Five well-separated shapes of very different sizes, standing in for a carton, a bottle, a
// bagged item, a box and a small tub. Positions leave a visible gap between every pair so the
// instance mask has a real chance of separating them rather than merging into one blob.
let shapes: [Shape] = [
  Shape(rect: CGRect(x: 90, y: 980, width: 300, height: 260), color: (0.78, 0.18, 0.16), kind: "box"),
  Shape(rect: CGRect(x: 470, y: 1000, width: 190, height: 320), color: (0.14, 0.45, 0.78), kind: "oval"),
  Shape(rect: CGRect(x: 740, y: 1020, width: 250, height: 220), color: (0.20, 0.62, 0.28), kind: "box"),
  Shape(rect: CGRect(x: 150, y: 480, width: 340, height: 300), color: (0.92, 0.72, 0.10), kind: "box"),
  Shape(rect: CGRect(x: 620, y: 460, width: 260, height: 260), color: (0.55, 0.24, 0.68), kind: "oval"),
]

func drawShape(_ shape: Shape) {
  context.saveGState()

  // Drop shadow first, offset down-right, so Vision has a genuine luminance/edge boundary to
  // key off, the same way a real object's cast shadow separates it from a countertop.
  context.setShadow(offset: CGSize(width: 10, height: -14), blur: 26, color: CGColor(red: 0, green: 0, blue: 0, alpha: 0.35))

  let path = CGMutablePath()
  if shape.kind == "oval" {
    path.addEllipse(in: shape.rect)
  } else {
    path.addRoundedRect(in: shape.rect, cornerWidth: 22, cornerHeight: 22)
  }

  // A soft top-to-bottom gradient rather than a flat fill: gives the sharpness metric (variance
  // of the Laplacian) real internal edge energy, closer to how a photographed product looks
  // than a single flat swatch would.
  context.addPath(path)
  context.clip()
  let colors = [
    CGColor(red: min(1, shape.color.r + 0.16), green: min(1, shape.color.g + 0.16), blue: min(1, shape.color.b + 0.16), alpha: 1),
    CGColor(red: shape.color.r * 0.72, green: shape.color.g * 0.72, blue: shape.color.b * 0.72, alpha: 1),
  ]
  guard let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: [0, 1])
  else { context.restoreGState(); return }
  context.drawLinearGradient(
    gradient, start: CGPoint(x: shape.rect.midX, y: shape.rect.maxY),
    end: CGPoint(x: shape.rect.midX, y: shape.rect.minY), options: [])

  context.restoreGState()

  // A crisp outline on top of the gradient sharpens the object's own boundary further.
  context.saveGState()
  context.addPath(path)
  context.setStrokeColor(CGColor(red: shape.color.r * 0.5, green: shape.color.g * 0.5, blue: shape.color.b * 0.5, alpha: 1))
  context.setLineWidth(4)
  context.strokePath()
  context.restoreGState()
}

for shape in shapes { drawShape(shape) }

guard let image = context.makeImage() else {
  print("could not render image")
  exit(1)
}

guard
  let destination = CGImageDestinationCreateWithURL(outputURL as CFURL, UTType.png.identifier as CFString, 1, nil)
else {
  print("could not create PNG destination at \(outputURL.path)")
  exit(1)
}
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else {
  print("could not write PNG")
  exit(1)
}

print("wrote \(width)x\(height) test image with \(shapes.count) shapes to \(outputURL.path)")
