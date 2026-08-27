// scripts/replay-driver/main.swift
//
// A camera stand-in that runs on a Mac.
//
// Decodes a video clip one frame at a time and pushes each frame through the real
// `KartFrameAnalysis` - the real `AppleInstanceMaskDetector`, `MaskContour`, `FrameMetrics`,
// barcode reading, keyframe gate and JPEG encoder - then hands the reply back over stdout so the
// real JavaScript engine can decide what to ask for next. `server/eval/replay/run.ts` is the
// other half; between them a full scan runs with no phone, no Simulator and no camera.
//
// Why a Mac binary rather than the Simulator
// ------------------------------------------
// `VNGenerateForegroundInstanceMaskRequest` cannot create an inference context in the Simulator
// and fails on every call, so a Simulator replay finds zero instances in every frame, the gate
// holds every frame on `nothing-to-see`, and nothing downstream of the detector is exercised at
// all. The same unmodified detector segments normally when run as a Mac binary, which is what
// `npm run bench:detector` has been doing all along. This reuses that fact.
//
// Why the JavaScript half is a separate process
// ---------------------------------------------
// The gate is a handshake, not a filter: JavaScript decides on frame N whether it wants a
// keyframe, and the native half re-tests that decision against frame N+1. A native-only replay
// would have to stand in for the JavaScript decision, and would then be measuring the stand-in.
// Passing one request in and one reply out per frame keeps the real decision in the real code.
//
// What this still does not cover, stated plainly: `AVCaptureSession`, and VisionCamera's own JSI
// marshalling of a `Frame` into a worklet runtime. The first is Apple's. The second is covered
// separately, and only partially, by the probes in `src/engine/liveVision/frameLabNative.ts`.
//
// Protocol, one JSON object per line each way:
//
//   out  {"type":"open","width":1920,"height":1080,"frameRate":30,"durationSeconds":12}
//   in   {"wantKeyframe":true,"minSharpness":4.2,"maxMotion":0.15,"cropBoxes":[],"barcodes":true}
//   out  {"type":"frame","index":0,"ptsSeconds":0,"instances":[...],"sharpness":...,...}
//   ...
//   in   {"type":"close"}          (or EOF)
//   out  {"type":"closed","frames":360}
//
// A request line is passed to `KartFrameAnalysis.analyse` as its argument bag with no
// translation, so it is exactly the bag `frameProcessor.ts` builds for the live plugin.

import AVFoundation
import CoreVideo
import Foundation

// Errors go to stderr so a malformed line can never be mistaken for a reply.
func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data(("replay-driver: " + message + "\n").utf8))
  exit(1)
}

func emit(_ payload: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []) else {
    fail("could not serialize a reply")
  }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

/// Runs an async load from this synchronous tool and waits for it.
///
/// `AVAsset`'s synchronous accessors are deprecated and can block on a load that has not
/// happened; the replacements are async. The awaited work runs on the cooperative pool, so this
/// parks the main thread rather than deadlocking it.
func blocking<T>(_ operation: @escaping () async throws -> T) -> T {
  let semaphore = DispatchSemaphore(value: 0)
  var outcome: Result<T, Error>?
  Task {
    do { outcome = .success(try await operation()) } catch { outcome = .failure(error) }
    semaphore.signal()
  }
  semaphore.wait()
  switch outcome {
  case .success(let value): return value
  case .failure(let error): fail("\(error)")
  case nil: fail("asynchronous load produced no result")
  }
}

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
  fail("usage: replay-driver <clip.mov>")
}
let clipURL = URL(fileURLWithPath: arguments[1])
guard FileManager.default.fileExists(atPath: clipURL.path) else {
  fail("no clip at \(clipURL.path)")
}

let asset = AVURLAsset(url: clipURL, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
let tracks = blocking { try await asset.loadTracks(withMediaType: .video) }
guard let track = tracks.first else { fail("no video track in \(clipURL.lastPathComponent)") }
let (naturalSize, nominalFrameRate) = blocking {
  try await track.load(.naturalSize, .nominalFrameRate)
}
let duration = blocking { try await asset.load(.duration) }.seconds

// Video range rather than full range, because that is what the capture session delivers.
// `FrameMetrics` reads either, and its sharpness statistic is a variance over the luma plane, so
// the two ranges differ by a constant scale that the adaptive floor divides out. Matching the
// camera anyway removes a difference that would otherwise have to be reasoned about every time a
// number looked odd.
let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
  kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange),
  kCVPixelBufferIOSurfacePropertiesKey as String: [:],
])
// Nothing holds a reference to the buffer past its own frame, so there is nothing to gain from a
// copy per frame.
output.alwaysCopiesSampleData = false

guard let reader = try? AVAssetReader(asset: asset) else { fail("could not open a reader") }
guard reader.canAdd(output) else { fail("reader refused the video output") }
reader.add(output)
guard reader.startReading() else {
  fail("reader would not start: \(reader.error?.localizedDescription ?? "unknown")")
}

// One detector and one `FrameMetrics` for the whole clip, exactly as the live plugin holds one
// of each for the life of the camera session. A fresh `FrameMetrics` per frame would report
// first-frame motion on every frame and the motion half of the gate would stop meaning anything.
let detector: KartDetector = AppleInstanceMaskDetector()
let metrics = FrameMetrics()

emit([
  "type": "open",
  "width": Int(naturalSize.width),
  "height": Int(naturalSize.height),
  "frameRate": Double(nominalFrameRate),
  "durationSeconds": duration,
  "detector": detector.name,
])

var delivered = 0

while let line = readLine(strippingNewline: true) {
  let trimmed = line.trimmingCharacters(in: .whitespaces)
  if trimmed.isEmpty { continue }

  guard
    let data = trimmed.data(using: .utf8),
    let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  else {
    fail("could not parse a request line")
  }

  if (request["type"] as? String) == "close" { break }

  guard let sample = output.copyNextSampleBuffer() else {
    if reader.status == .failed {
      fail("decode failed after \(delivered) frames: \(reader.error?.localizedDescription ?? "?")")
    }
    emit(["type": "end", "frames": delivered])
    break
  }

  guard let pixelBuffer = CMSampleBufferGetImageBuffer(sample) else {
    emit(["type": "frame", "index": delivered, "ptsSeconds": 0]
      .merging(KartFrameAnalysis.empty(width: 0, height: 0, error: "no image buffer")) { a, _ in a })
    delivered += 1
    continue
  }

  var reply = KartFrameAnalysis.analyse(
    pixelBuffer: pixelBuffer,
    frameWidth: CVPixelBufferGetWidth(pixelBuffer),
    frameHeight: CVPixelBufferGetHeight(pixelBuffer),
    arguments: request,
    detector: detector,
    metrics: metrics)

  reply["type"] = "frame"
  reply["index"] = delivered
  reply["ptsSeconds"] = CMSampleBufferGetPresentationTimeStamp(sample).seconds
  emit(reply)
  delivered += 1
}

reader.cancelReading()
emit(["type": "closed", "frames": delivered])
