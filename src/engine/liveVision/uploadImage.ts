/**
 * What the phone sends is a bounded JPEG, not the photograph the camera took.
 *
 * A phone photograph is 12 to 48 megapixels and 4 to 15MB. The census reads it at a long edge of
 * 1536 (`CENSUS_LONG_EDGE` in server/src/recognize.ts), so every pixel above that is base64
 * encoded through Hermes, uploaded over wifi, and discarded by the server's first resize. On the
 * shipped screen, measured in a browser, one basket photograph made a 7.6MB request body. And the
 * service refuses anything over 12MB decoded, which a 48MP phone produces on its own, so the size
 * was a way for a photograph to be rejected, not only a way for it to be slow.
 *
 * Deliberately free of Expo. The resize is native and is injected as `Manipulator`, so the rule
 * about what to send can be tested without a device, and the screen holds no sizing rule of its
 * own. `deviceManipulator.ts` is the one real implementation.
 */

/**
 * The long edge the phone sends. Above the census's 1536, so nothing the server reads at is lost
 * to double resizing, and small enough that the body is under a megabyte rather than eight.
 */
export const UPLOAD_LONG_EDGE = 2048;

/** JPEG quality on the wire. The server re-encodes at 88 after its own resize. */
export const UPLOAD_JPEG_QUALITY = 0.85;

export interface SourcePhoto {
  uri: string;
  width: number;
  height: number;
}

/**
 * One edge to bound, or null to leave the pixels alone. Only one edge is ever given, so the
 * other follows the image's own ratio. That also makes it safe against a camera reporting the
 * sensor's landscape dimensions for a photograph that is portrait once its EXIF turn is applied:
 * bounding the wrong edge still keeps the long edge at or above the census's 1536.
 */
export type UploadSize = { width: number } | { height: number } | null;

/** A JPEG as base64, with its own pixel size after every rotation and resize has been applied. */
export interface EncodedJpeg {
  base64: string;
  width: number;
  height: number;
}

/** A rectangle in the oriented image, as fractions of its width and height, origin top left. */
export interface NormalizedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Manipulator {
  /** Re-encodes the image at `uri` as JPEG, resized to `size` when one is given. */
  toJpegBase64(uri: string, size: UploadSize, quality: number): Promise<EncodedJpeg>;
  /**
   * Cuts `box`, widened by `padding` of its own size on every side, out of the oriented image
   * at `uri`, bounds its long edge to `longEdge`, and re-encodes it as JPEG. The rectangle in
   * pixels is `cropRect`'s, so the device and the harness cut the same pixels.
   */
  cropToJpegBase64(uri: string, box: NormalizedBox, padding: number, longEdge: number, quality: number): Promise<EncodedJpeg>;
}

export function uploadSize(width: number, height: number, longEdge = UPLOAD_LONG_EDGE): UploadSize {
  // Unknown dimensions are bounded rather than trusted. A picker asset reports 0 by 0 when it
  // could not read the metadata, and treating that as "already small" sends the whole file.
  if (!(width > 0) || !(height > 0)) return { width: longEdge };
  if (Math.max(width, height) <= longEdge) return null;
  return width >= height ? { width: longEdge } : { height: longEdge };
}

export interface UploadDeps {
  manipulator: Manipulator;
  /**
   * For the eval harness only, so a bound can be measured before it is shipped
   * (`server/eval/pipeline/clut-photos.ts --long-edge --quality`). The app passes nothing and
   * gets the constants above.
   */
  bound?: { longEdge?: number; quality?: number };
}

/**
 * The upload, with its own size. The size is the frame every box the server returns is in, and
 * the review draws this very JPEG with those boxes on it, so the two cannot disagree by an EXIF
 * rotation the way the original file and the model's answer could.
 */
export async function prepareUpload(photo: SourcePhoto, deps: UploadDeps): Promise<EncodedJpeg> {
  // Always through the manipulator, even when no resize is needed, so the wire format is always
  // JPEG. A HEIC from the library or a PNG screenshot would otherwise be sent as-is.
  const upload = await deps.manipulator.toJpegBase64(
    photo.uri,
    uploadSize(photo.width, photo.height, deps.bound?.longEdge ?? UPLOAD_LONG_EDGE),
    deps.bound?.quality ?? UPLOAD_JPEG_QUALITY,
  );
  if (upload.base64.length === 0) throw new Error('the photograph re-encoded to an empty image');
  return upload;
}

/**
 * The close read's crops are cut from the original photograph, not from the upload.
 *
 * Measured on the owner's photographs (server/eval/CLUT.md, "Read wide, then read close"): a
 * crop of the 2048 upload had the model read a jar of Simply Nature marinara as "Murphy's
 * Naturals", and a crop of a 3072 upload as "Merry Chef", both at confidence above 0.9; the same
 * crop of the original read "Simply Nature". The label is small italic script, and the pixels
 * the upload bound throws away are the ones it is written in.
 *
 * Bounded at 1536 on the long edge. The crops that misread were 640 pixels across and the one
 * that read right was 1117, so 1536 keeps every pixel of a crop that size; above it the model's
 * own 2,500-patch budget at "high" detail would discard the rest, and the tokens sent would
 * cost without being seen. Padded by 12% of the box's own size on every side, because a tight
 * crop that clips the brand mark is measurably harder to read than one with a little of the
 * shelf around it (see `cropToBox` in server/src/recognize.ts), and no more than that, because
 * a neighbour cut into the crop gets counted.
 */
export const CROP_LONG_EDGE = 1536;
export const CROP_JPEG_QUALITY = 0.9;
/**
 * 8%, the same as the server's own crop. It was 12% first, and at 12% a neighbour of the same
 * brand cut into the crop was counted as a second unit of the product on five products of
 * fifteen photographs.
 */
export const CROP_PADDING = 0.08;

export interface PixelRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * The pixels to cut for `box` out of an oriented image of `width` by `height`, padded and clamped
 * to the image. Null when the box has no area, since a crop of nothing reads as nothing.
 */
export function cropRect(width: number, height: number, box: NormalizedBox, padding: number): PixelRect | null {
  if (!(box.w > 0) || !(box.h > 0) || !(width > 0) || !(height > 0)) return null;
  const padX = box.w * padding;
  const padY = box.h * padding;
  const left = Math.max(0, Math.min(1, box.x - padX));
  const top = Math.max(0, Math.min(1, box.y - padY));
  const right = Math.max(0, Math.min(1, box.x + box.w + padX));
  const bottom = Math.max(0, Math.min(1, box.y + box.h + padY));
  // Each edge rounded on its own, so a box whose fraction lands a hair under a pixel boundary
  // (0.3 minus 0.02 is 0.27999999999999997) is not pushed a pixel off by the arithmetic.
  const originX = Math.round(left * width);
  const originY = Math.round(top * height);
  const rect = {
    originX,
    originY,
    width: Math.min(Math.round(right * width), width) - originX,
    height: Math.min(Math.round(bottom * height), height) - originY,
  };
  if (rect.width < 1 || rect.height < 1) return null;
  return rect;
}

/**
 * One crop per box, in order, from the original photograph. A box that is null, or that the
 * device cannot cut, gives null in its place rather than failing the rest: the item it belongs
 * to is then shown as unsure, which is the honest state of a product nothing read twice.
 */
export async function prepareCrops(
  photo: SourcePhoto,
  boxes: (NormalizedBox | null)[],
  deps: UploadDeps,
): Promise<(string | null)[]> {
  return Promise.all(
    boxes.map(async (box) => {
      if (box === null) return null;
      try {
        const crop = await deps.manipulator.cropToJpegBase64(photo.uri, box, CROP_PADDING, CROP_LONG_EDGE, CROP_JPEG_QUALITY);
        return crop.base64.length > 0 ? crop.base64 : null;
      } catch {
        return null;
      }
    }),
  );
}
