// Classify item regions of a video frame with Apple's Vision classifier.
// Usage: swift scripts/classify-regions.swift <video> <timeSec> name:x,y,w,h [name:x,y,w,h ...]
// Boxes are normalized to the frame (origin top-left). Prints top labels per region.

import AVFoundation
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count >= 4 else {
  print("usage: classify-regions.swift <video> <timeSec> name:x,y,w,h ...")
  exit(1)
}

let url = URL(fileURLWithPath: args[1])
let atSec = Double(args[2]) ?? 0.5

struct Region { let name: String; let x: Double; let y: Double; let w: Double; let h: Double }
var regions: [Region] = []
for spec in args.dropFirst(3) {
  let parts = spec.split(separator: ":")
  let nums = parts[1].split(separator: ",").compactMap { Double($0) }
  guard parts.count == 2, nums.count == 4 else { continue }
  regions.append(Region(name: String(parts[0]), x: nums[0], y: nums[1], w: nums[2], h: nums[3]))
}

let asset = AVURLAsset(url: url)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero

let time = CMTime(seconds: atSec, preferredTimescale: 600)
let frame = try generator.copyCGImage(at: time, actualTime: nil)
let W = Double(frame.width), H = Double(frame.height)

for r in regions {
  let rect = CGRect(x: r.x * W, y: r.y * H, width: r.w * W, height: r.h * H)
  guard let crop = frame.cropping(to: rect) else {
    print("\(r.name): crop failed")
    continue
  }
  let request = VNClassifyImageRequest()
  try VNImageRequestHandler(cgImage: crop, options: [:]).perform([request])
  let top = (request.results ?? [])
    .filter { $0.confidence >= 0.03 }
    .sorted { $0.confidence > $1.confidence }
    .prefix(6)
    .map { String(format: "%@:%.2f", $0.identifier, $0.confidence) }
  print("\(r.name)  \(top.joined(separator: "  "))")
}
