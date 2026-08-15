import { File } from 'expo-file-system';
import { deleteHaulThumbnails, saveThumbnail, thumbnailFileName } from '../thumbnails';

describe('thumbnailFileName', () => {
  it('is stable for the same product key', () => {
    expect(thumbnailFileName('::bananas')).toBe(thumbnailFileName('::bananas'));
  });

  it('differs for different products', () => {
    expect(thumbnailFileName('::bananas')).not.toBe(thumbnailFileName('::apples'));
  });

  it('contains no path separators or characters a filesystem would reject', () => {
    // A productKey is built from a model-supplied name and can contain anything, including "/".
    // Writing that straight into a path would escape the directory or fail to open.
    const name = thumbnailFileName('brand/../..::name with spaces & symbols');
    expect(name).not.toContain('/');
    expect(name).not.toContain('.');
    expect(name).toMatch(/^[a-z0-9_]+$/);
  });

  it('does not collide for keys that differ only in a stripped character', () => {
    expect(thumbnailFileName('a/b')).not.toBe(thumbnailFileName('a_b'));
  });
});

describe('saveThumbnail', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes a file and returns a uri that resolves to it', async () => {
    const uri = await saveThumbnail('::bananas', 'AAAA');
    expect(uri).not.toBeNull();
    expect(new File(uri as string).exists).toBe(true);
  });

  it('never reuses a file already saved for the same product key', () => {
    // The old behavior reused an existing file for a repeated key. That let two different
    // hauls that both contain bananas point at the same file on disk, so deleting the older
    // haul silently deleted the newer haul's picture too.
    return Promise.all([
      saveThumbnail('::bananas', 'AAAA'),
      saveThumbnail('::bananas', 'BBBB'),
    ]).then(([first, second]) => {
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first).not.toBe(second);
      expect(new File(first as string).exists).toBe(true);
      expect(new File(second as string).exists).toBe(true);
    });
  });

  it('returns null instead of throwing when the write rejects', async () => {
    // Task 8 added a catch at every orchestrator entry point specifically because this call is
    // a filesystem write that can reject on a full disk or a permissions problem in production.
    // The orchestrator's own tests mock saveThumbnail away entirely, so nothing else exercises
    // this function's own catch block.
    jest.spyOn(File.prototype, 'write').mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });
    await expect(saveThumbnail('::bananas', 'AAAA')).resolves.toBeNull();
  });
});

describe('deleteHaulThumbnails', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('deletes every uri it is given', async () => {
    const uri = await saveThumbnail('::bananas', 'AAAA');
    await deleteHaulThumbnails([uri]);
    expect(new File(uri as string).exists).toBe(false);
  });

  it('ignores null entries', async () => {
    await expect(deleteHaulThumbnails([null, null])).resolves.toBeUndefined();
  });

  it('does not throw when a uri no longer points at a file', async () => {
    await expect(deleteHaulThumbnails(['file:///does/not/exist.jpg'])).resolves.toBeUndefined();
  });

  it('swallows a delete failure instead of throwing', async () => {
    // Same reasoning as saveThumbnail's failure test: a thumbnail that will not delete must
    // not take down deleting a haul.
    const uri = await saveThumbnail('::bananas', 'AAAA');
    jest.spyOn(File.prototype, 'delete').mockImplementation(() => {
      throw new Error('EPERM');
    });
    await expect(deleteHaulThumbnails([uri])).resolves.toBeUndefined();
  });
});
