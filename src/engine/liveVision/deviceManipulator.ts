import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import { cropRect, type Manipulator } from './uploadImage';

/**
 * The one real `Manipulator`: expo-image-manipulator's contextual API, per
 * https://docs.expo.dev/versions/v57.0.0/sdk/imagemanipulator/
 *
 * `manipulate` loads the file, `resize` with a single edge keeps the ratio, `renderAsync` runs
 * the work off the JS thread, and `saveAsync` writes a JPEG to the cache directory and hands back
 * its base64 in the same call, so the photograph is read from disk exactly once. It applies the
 * EXIF orientation when loading, which is why a portrait photograph arrives portrait.
 *
 * The crops come from the original file too. `manipulate` also accepts the `ImageRef` that
 * `renderAsync` returns, so the original is decoded once per photograph and every crop is cut
 * from that decoded image; its `width` and `height` are the oriented ones, which is what
 * `cropRect` needs and what the camera's own reported size is not guaranteed to be.
 */
let decoded: { uri: string; ref: ImageRef } | null = null;

async function decodedOriginal(uri: string): Promise<ImageRef> {
  if (decoded?.uri === uri) return decoded.ref;
  const ref = await ImageManipulator.manipulate(uri).renderAsync();
  decoded = { uri, ref };
  return ref;
}

export const deviceManipulator: Manipulator = {
  async toJpegBase64(uri, size, quality) {
    const context = ImageManipulator.manipulate(uri);
    if (size !== null) context.resize(size);
    const image = await context.renderAsync();
    const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
    return { base64: result.base64 ?? '', width: result.width, height: result.height };
  },

  async cropToJpegBase64(uri, box, padding, longEdge, quality) {
    const original = await decodedOriginal(uri);
    const rect = cropRect(original.width, original.height, box, padding);
    if (rect === null) throw new Error('box has no area inside the photograph');
    const context = ImageManipulator.manipulate(original).crop(rect);
    if (Math.max(rect.width, rect.height) > longEdge) {
      context.resize(rect.width >= rect.height ? { width: longEdge } : { height: longEdge });
    }
    const image = await context.renderAsync();
    const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
    return { base64: result.base64 ?? '', width: result.width, height: result.height };
  },
};
