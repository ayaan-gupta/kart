import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { Manipulator } from './uploadImage';

/**
 * The one real `Manipulator`: expo-image-manipulator's contextual API, per
 * https://docs.expo.dev/versions/v57.0.0/sdk/imagemanipulator/
 *
 * `manipulate` loads the file, `resize` with a single edge keeps the ratio, `renderAsync` runs
 * the work off the JS thread, and `saveAsync` writes a JPEG to the cache directory and hands back
 * its base64 in the same call, so the photograph is read from disk exactly once. It applies the
 * EXIF orientation when loading, which is why a portrait photograph arrives portrait.
 */
export const deviceManipulator: Manipulator = {
  async toJpegBase64(uri, size, quality) {
    const context = ImageManipulator.manipulate(uri);
    if (size !== null) context.resize(size);
    const image = await context.renderAsync();
    const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
    return result.base64 ?? '';
  },
};
