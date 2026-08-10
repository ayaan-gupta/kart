// Runs Apple's Vision image classifier over video frames and prints
// timestamped labels. Output feeds src/engine/recognitionTrack.ts so the
// scan screen replays real model detections in sync with the footage.
// Usage: swift scripts/analyze-video.swift <video> [stepSeconds]
import AVFoundation
import Vision

let path = CommandLine.arguments[1]
let step = CommandLine.arguments.count > 2 ? Double(CommandLine.arguments[2]) ?? 0.5 : 0.5
let url = URL(fileURLWithPath: path)
let asset = AVAsset(url: url)
let duration = CMTimeGetSeconds(asset.duration)
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero

var t = 0.0
while t < duration {
  let time = CMTime(seconds: t, preferredTimescale: 600)
  if let cg = try? gen.copyCGImage(at: time, actualTime: nil) {
    let req = VNClassifyImageRequest()
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    try? handler.perform([req])
    let hits = (req.results ?? [])
      .filter { $0.confidence > 0.12 }
      .prefix(8)
      .map { "\($0.identifier):\(String(format: "%.2f", $0.confidence))" }
      .joined(separator: " ")
    print(String(format: "t=%.1f %@", t, hits))
  }
  t += step
}
