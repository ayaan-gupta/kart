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

export interface Manipulator {
  /** Re-encodes the image at `uri` as JPEG, resized to `size` when one is given, as base64. */
  toJpegBase64(uri: string, size: UploadSize, quality: number): Promise<string>;
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

export async function prepareUpload(photo: SourcePhoto, deps: UploadDeps): Promise<string> {
  // Always through the manipulator, even when no resize is needed, so the wire format is always
  // JPEG. A HEIC from the library or a PNG screenshot would otherwise be sent as-is.
  const base64 = await deps.manipulator.toJpegBase64(
    photo.uri,
    uploadSize(photo.width, photo.height, deps.bound?.longEdge ?? UPLOAD_LONG_EDGE),
    deps.bound?.quality ?? UPLOAD_JPEG_QUALITY,
  );
  if (base64.length === 0) throw new Error('the photograph re-encoded to an empty image');
  return base64;
}
