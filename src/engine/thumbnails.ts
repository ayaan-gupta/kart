import { Directory, File, Paths } from 'expo-file-system';

/**
 * Photos of the user's own groceries, one per product, cut from the camera frame that
 * identified it.
 *
 * These live in the document directory rather than the cache directory on purpose: a saved
 * haul references them, and the system evicts cache files whenever it likes, which would leave
 * old hauls full of broken images.
 */
const DIR_NAME = 'kart-thumbnails';

function directory(): Directory {
  const dir = new Directory(Paths.document, DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/**
 * A filesystem-safe, collision-free name for a product key.
 *
 * A productKey is built from a model-supplied product name and can contain anything at all,
 * including slashes and dots. Stripping the unsafe characters alone would let "a/b" and "a_b"
 * collide, so a short hash of the original is appended.
 */
export function thumbnailFileName(key: string): string {
  // FNV-1a. Small, dependency-free, and more than good enough to separate a few dozen keys.
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const safe = key.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 32).replace(/^_+|_+$/g, '');
  return `${safe || 'item'}_${hash.toString(36)}`;
}

/** Writes a base64 JPEG and returns its URI, or null if it could not be written. */
export async function saveThumbnail(key: string, base64: string): Promise<string | null> {
  try {
    const file = new File(directory(), `${thumbnailFileName(key)}.jpg`);
    if (file.exists) return file.uri;
    file.create();
    file.write(base64, { encoding: 'base64' });
    return file.uri;
  } catch {
    // A full disk or a permissions problem must not take down a scan. The bag falls back to
    // showing the item without a picture.
    return null;
  }
}

/** Removes the photos a deleted haul owned, so they do not accumulate forever. */
export async function deleteHaulThumbnails(uris: (string | null)[]): Promise<void> {
  for (const uri of uris) {
    if (!uri) continue;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // A thumbnail that will not delete is a few kilobytes, not a failure worth surfacing.
    }
  }
}
