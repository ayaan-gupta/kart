// ios/Kart/KartImageTools.swift
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO
import UniformTypeIdentifiers
import VideoToolbox

/// JPEG encoding and cropping for the cloud recognition path.
///
/// Two separate jobs that share one pixel pipeline:
///  - `jpegData` turns the live camera buffer into an upright JPEG small enough to upload.
///  - `cropJpeg` cuts one item out of that same JPEG and writes it to disk for the bag.
///
/// Both are pure functions over pixels with no Vision or VisionCamera dependency, so they build
/// and run under `swiftc` on a Mac and are covered by the offline test suite.
public enum KartImageTools {

  /// Longest edge of the uploaded keyframe. The server downscales to 1024 for the census call
  /// (see `compositeMarks`), so anything above that only exists to give `/api/identify` a crop
  /// with real detail in it. 1536 is the smallest size that still leaves a usable crop of a
  /// single item in a twenty item cart.
  public static let keyframeMaxEdge = 1536

  /// Longest edge of a bag thumbnail. Rendered at most 46pt, so 256 covers a 3x display with
  /// room to spare and keeps a twenty item haul under half a megabyte on disk.
  public static let thumbnailMaxEdge = 256

  /// The smallest pixel extent, on either axis, that a crop is allowed to come out at.
  ///
  /// A box that is tiny, needle-thin, or almost entirely off the edge of the frame can survive
  /// the earlier normalized-area guard yet still round down to a 1px sliver once mapped to real
  /// pixels: a grey or noisy speck rather than a usable photograph of a product. thumbnailMaxEdge
  /// is 256, so 16 keeps a real thumbnail an order of magnitude clear of the floor while still
  /// rejecting slivers a human would see as a broken photo next to a bag item.
  public static let minimumCropPixels = 16

  // MARK: - Orientation

  /// The transform that carries a raw sensor buffer into upright space, and the upright size.
  ///
  /// This mirrors what `VNImageRequestHandler(orientation:)` does for the detector, so the
  /// polygons the tracker holds and the pixels we upload agree on which way is up. They have to:
  /// a normalized box from the tracker is used to crop this JPEG, and a mismatch here crops the
  /// wrong part of the image without ever throwing.
  static func uprightTransform(
    _ orientation: CGImagePropertyOrientation, width: Int, height: Int
  ) -> (transform: CGAffineTransform, size: CGSize) {
    let w = CGFloat(width)
    let h = CGFloat(height)
    switch orientation {
    case .up:
      return (.identity, CGSize(width: w, height: h))
    case .upMirrored:
      return (CGAffineTransform(scaleX: -1, y: 1).translatedBy(x: -w, y: 0), CGSize(width: w, height: h))
    case .down:
      return (CGAffineTransform(scaleX: -1, y: -1).translatedBy(x: -w, y: -h), CGSize(width: w, height: h))
    case .downMirrored:
      return (CGAffineTransform(scaleX: 1, y: -1).translatedBy(x: 0, y: -h), CGSize(width: w, height: h))
    // Verified against CGImageSourceCreateThumbnailAtIndex(..., kCGImageSourceCreateThumbnailWithTransform: true),
    // which applies Apple's own EXIF-orientation correction: EXIF 6 (.right) is "rotate 90 CW to
    // correct", EXIF 8 (.left) is "rotate 90 CCW to correct". CGAffineTransform(rotationAngle:) is
    // positive-CCW in CG's y-up user space, so .right needs the negative angle and .left the
    // positive one. An earlier version of this file had the two swapped, confirmed by running a
    // known test card through both this function and Apple's own thumbnail transform and diffing
    // which corner the marker landed on for all eight orientation cases.
    case .left:
      return (CGAffineTransform(rotationAngle: .pi / 2).translatedBy(x: 0, y: -h), CGSize(width: h, height: w))
    case .leftMirrored:
      return (CGAffineTransform(rotationAngle: .pi / 2).scaledBy(x: -1, y: 1).translatedBy(x: -w, y: -h), CGSize(width: h, height: w))
    case .right:
      return (CGAffineTransform(rotationAngle: -.pi / 2).translatedBy(x: -w, y: 0), CGSize(width: h, height: w))
    case .rightMirrored:
      return (CGAffineTransform(rotationAngle: -.pi / 2).scaledBy(x: -1, y: 1), CGSize(width: h, height: w))
    @unknown default:
      return (.identity, CGSize(width: w, height: h))
    }
  }

  // MARK: - Encoding

  /// Draws `image` upright, scaled so its longest edge is at most `maxEdge`, and returns JPEG data.
  public static func jpegData(
    from image: CGImage,
    orientation: CGImagePropertyOrientation,
    maxEdge: Int,
    quality: Double
  ) -> Data? {
    let (transform, uprightSize) = uprightTransform(
      orientation, width: image.width, height: image.height)

    let longest = max(uprightSize.width, uprightSize.height)
    // Only ever scale down. Upscaling a small buffer wastes bytes and invents no detail.
    let scale = longest > CGFloat(maxEdge) ? CGFloat(maxEdge) / longest : 1
    let outW = max(1, Int((uprightSize.width * scale).rounded()))
    let outH = max(1, Int((uprightSize.height * scale).rounded()))

    guard
      let context = CGContext(
        data: nil, width: outW, height: outH, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { return nil }

    context.interpolationQuality = .medium
    context.scaleBy(x: scale, y: scale)
    context.concatenate(transform)
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))

    guard let output = context.makeImage() else { return nil }
    return encode(output, quality: quality)
  }

  static func encode(_ image: CGImage, quality: Double) -> Data? {
    let data = NSMutableData()
    guard
      let dest = CGImageDestinationCreateWithData(
        data, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(
      dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return data as Data
  }

  /// Bridges the camera's YUV buffer to RGB. VideoToolbox owns the colour conversion here;
  /// hand-rolling it is a well known source of green-tinted or washed out uploads.
  public static func cgImage(from pixelBuffer: CVPixelBuffer) -> CGImage? {
    var out: CGImage?
    guard VTCreateCGImageFromCVPixelBuffer(pixelBuffer, options: nil, imageOut: &out) == noErr else {
      return nil
    }
    return out
  }

  // MARK: - Cropping

  /// Cuts a normalized, origin top-left box out of JPEG data and returns a smaller JPEG.
  ///
  /// The box is clamped to the image rather than rejected. A tracked polygon can legitimately
  /// run off the edge of the frame when an item is half out of view, and a clamped crop of the
  /// visible part is a better bag thumbnail than no thumbnail at all.
  ///
  /// Assumes `jpeg` carries no EXIF orientation tag of its own (true of every JPEG this file
  /// produces, since `jpegData` always bakes the upright transform into the pixels rather than
  /// tagging them): a tagged input would be read and cropped in its raw, untransformed pixel
  /// space, silently cropping the wrong region.
  public static func cropJpeg(
    _ jpeg: Data, box: CGRect, padding: CGFloat, maxEdge: Int, quality: Double
  ) -> Data? {
    guard
      let source = CGImageSourceCreateWithData(jpeg as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { return nil }

    let w = CGFloat(image.width)
    let h = CGFloat(image.height)

    // Pad outward so the thumbnail has a little context instead of a tight, claustrophobic cut.
    let padded = box.insetBy(dx: -box.width * padding, dy: -box.height * padding)
    let clamped = padded.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
    guard !clamped.isNull, clamped.width > 0, clamped.height > 0 else { return nil }

    let pixels = CGRect(
      x: (clamped.minX * w).rounded(.down),
      y: (clamped.minY * h).rounded(.down),
      width: max(1, (clamped.width * w).rounded()),
      height: max(1, (clamped.height * h).rounded())
    ).intersection(CGRect(x: 0, y: 0, width: w, height: h))

    // Below minimumCropPixels on either axis this is a sliver, not a photograph: return nil
    // rather than the 1x1 or needle-thin JPEG a naive floor-to-1 would otherwise produce.
    guard
      pixels.width >= CGFloat(minimumCropPixels), pixels.height >= CGFloat(minimumCropPixels)
    else { return nil }

    guard let cropped = image.cropping(to: pixels) else { return nil }
    return jpegData(from: cropped, orientation: .up, maxEdge: maxEdge, quality: quality)
  }

  // MARK: - Frame processor gating

  /// Whether a frame is worth encoding as a keyframe: `wantKeyframe` is JavaScript's slow-moving
  /// half of the gate, and the sharpness/motion comparison is native's fast-moving half.
  ///
  /// Pulled out as a standalone, image-free function so the boolean decision itself is under
  /// test. `KartVisionFrameProcessorPlugin.swift` cannot compile under plain `swiftc` (it
  /// imports Vision and VisionCamera, neither available outside a full Xcode build), so without
  /// this extraction the gate has no coverage at all: an implementation that ignored
  /// `wantKeyframe` and encoded every frame would compile clean and pass every check.
  public static func shouldEncodeKeyframe(
    wantKeyframe: Bool, sharpness: Double, motion: Double, minSharpness: Double, maxMotion: Double
  ) -> Bool {
    wantKeyframe && sharpness >= minSharpness && motion <= maxMotion
  }

  /// Encodes a keyframe, but only when `shouldEncodeKeyframe` agrees.
  ///
  /// `image` is `@autoclosure` so the CVPixelBuffer-to-CGImage bridge the caller supplies is
  /// never evaluated unless the gate actually passes: on the large majority of frames, where
  /// `wantKeyframe` is false, this must cost nothing beyond the boolean check, exactly as it did
  /// before this logic was pulled out of the plugin.
  public static func encodeKeyframeIfGated(
    wantKeyframe: Bool,
    sharpness: Double,
    motion: Double,
    minSharpness: Double,
    maxMotion: Double,
    orientation: CGImagePropertyOrientation,
    quality: Double,
    image: @autoclosure () -> CGImage?
  ) -> Data? {
    guard
      shouldEncodeKeyframe(
        wantKeyframe: wantKeyframe, sharpness: sharpness, motion: motion,
        minSharpness: minSharpness, maxMotion: maxMotion),
      let cgImage = image()
    else { return nil }
    return jpegData(from: cgImage, orientation: orientation, maxEdge: keyframeMaxEdge, quality: quality)
  }

  /// Cuts one thumbnail per requested track out of an already-encoded full-frame JPEG.
  ///
  /// A box that `cropJpeg` rejects (degenerate, fully outside the frame, or a sub-pixel sliver)
  /// is silently omitted rather than represented some other way, so the id list coming out can
  /// be shorter than the one going in. Always encodes at `thumbnailMaxEdge`: bag thumbnails have
  /// exactly one correct size, so that is not a caller-supplied parameter here the way it is on
  /// `cropJpeg` itself.
  public static func trackThumbnails(
    from full: Data, boxes: [(id: String, box: CGRect)], padding: CGFloat, quality: Double
  ) -> [(id: String, jpeg: Data)] {
    var out: [(id: String, jpeg: Data)] = []
    for entry in boxes {
      guard
        let jpeg = cropJpeg(
          full, box: entry.box, padding: padding, maxEdge: thumbnailMaxEdge, quality: quality)
      else { continue }
      out.append((id: entry.id, jpeg: jpeg))
    }
    return out
  }
}
