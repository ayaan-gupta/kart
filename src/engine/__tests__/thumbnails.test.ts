import { thumbnailFileName } from '../thumbnails';

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
