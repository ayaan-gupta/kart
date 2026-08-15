import { Directory, File, Paths } from 'expo-file-system';

/**
 * Photos of the user's own groceries, cut from the camera frame that identified each item.
 *
 * These live in the document directory rather than the cache directory on purpose: a saved
 * haul references them, and the system evicts cache files whenever it likes, which would leave
 * old hauls full of broken images.
 *
 * A thumbnail belongs to the haul that captured it, not to the product. `saveThumbnail` never
 * reuses a file already written for the same product key: two hauls that both contain bananas
 * get two separate files. Sharing one file between them would mean deleting the older haul also
 * deletes the newer haul's picture, breaking the promise that a photo survives exactly as long
 * as the haul referencing it. A JPEG crop is a few kilobytes, so the duplication this costs when
 * the same product recurs across hauls is negligible next to a broken picture.
 */
const DIR_NAME = 'kart-thumbnails';

function directory(): Directory {
  const dir = new Directory(Paths.document, DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/**
 * A filesystem-safe, human-readable prefix for a product key. `saveThumbnail` appends a
 * per-write suffix to this, so it is not by itself the whole file name and two writes for the
 * same key still land on different files; see the module doc for why.
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

let writeCounter = 0;

/**
 * A per-process-run unique token appended to every thumbnail file name.
 *
 * A counter alone would repeat across app restarts; a timestamp alone could repeat for two
 * writes in the same millisecond. Together with a random component they make two writes for the
 * same product key collide only in the sense of theory, never in practice.
 */
function uniqueSuffix(): string {
  writeCounter += 1;
  return `${Date.now().toString(36)}${writeCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Writes a base64 JPEG to a new file and returns its URI, or null if it could not be written.
 *
 * Always creates a fresh file rather than reusing one that already exists for `key`. See the
 * module doc: reuse is what let two hauls end up sharing one file on disk.
 */
export async function saveThumbnail(key: string, base64: string): Promise<string | null> {
  try {
    const file = new File(directory(), `${thumbnailFileName(key)}_${uniqueSuffix()}.jpg`);
    file.create();
    file.write(base64, { encoding: 'base64' });
    return file.uri;
  } catch {
    // A full disk or a permissions problem must not take down a scan. The bag falls back to
    // showing the item without a picture.
    return null;
  }
}

/**
 * Removes the photos a deleted haul owned, so they do not accumulate forever.
 *
 * Safe even when a deleted haul's item names the same product as an item in a haul that is kept:
 * because `saveThumbnail` never shares a file across writes, the kept haul's thumbnail is a
 * different file at a different uri and is never touched here.
 */
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
