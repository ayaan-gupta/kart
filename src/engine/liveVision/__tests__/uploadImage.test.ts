import {
  CROP_JPEG_QUALITY,
  CROP_LONG_EDGE,
  CROP_PADDING,
  cropRect,
  prepareCrops,
  prepareUpload,
  uploadSize,
  UPLOAD_JPEG_QUALITY,
  UPLOAD_LONG_EDGE,
  type Manipulator,
} from '../uploadImage';

/**
 * The photograph the phone sends is not the photograph the camera took.
 *
 * A phone photograph is 12 to 48 megapixels and 4 to 15MB. The census reads it at a long edge of
 * 1536 (`CENSUS_LONG_EDGE` in server/src/recognize.ts), so everything above that is uploaded
 * over wifi, base64-encoded through Hermes, and thrown away by the first `sharp().resize` on
 * the server. Measured in a browser on the shipped screen, one basket photograph was a 7.6MB
 * request body. And the service refuses anything over 12MB decoded, which a 48MP phone can
 * produce on its own, so the size of the upload was a correctness problem and not only a slow one.
 */

function fakeManipulator(): Manipulator & {
  calls: { uri: string; size: unknown; quality: number }[];
  crops: { uri: string; box: unknown; padding: number; longEdge: number; quality: number }[];
} {
  const calls: { uri: string; size: unknown; quality: number }[] = [];
  const crops: { uri: string; box: unknown; padding: number; longEdge: number; quality: number }[] = [];
  return {
    calls,
    crops,
    async toJpegBase64(uri, size, quality) {
      calls.push({ uri, size, quality });
      return { base64: 'QUJD', width: 2048, height: 1536 };
    },
    async cropToJpegBase64(uri, box, padding, longEdge, quality) {
      crops.push({ uri, box, padding, longEdge, quality });
      return { base64: `crop-${crops.length}`, width: 600, height: 800 };
    },
  };
}

describe('uploadSize', () => {
  it('bounds the long edge of a portrait photograph by its height', () => {
    expect(uploadSize(3024, 4032)).toEqual({ height: UPLOAD_LONG_EDGE });
  });

  it('bounds the long edge of a landscape photograph by its width', () => {
    expect(uploadSize(4032, 3024)).toEqual({ width: UPLOAD_LONG_EDGE });
  });

  it('leaves a photograph alone when it is already within the bound', () => {
    expect(uploadSize(1600, 1200)).toBeNull();
    expect(uploadSize(UPLOAD_LONG_EDGE, 1000)).toBeNull();
  });

  it('keeps the census long edge: the bound is never below what the server reads at', () => {
    // 1536 is CENSUS_LONG_EDGE. Downscaling below it on the phone would hand the census fewer
    // pixels than the sweep in recognize.ts chose, and the brand reads would go with them.
    expect(UPLOAD_LONG_EDGE).toBeGreaterThanOrEqual(1536);
  });

  it('treats unknown dimensions as needing the bound, never as already small', () => {
    // A picker asset can report 0 by 0 when metadata is unavailable. Skipping the resize there
    // would send the full file, which is the case this module exists to prevent.
    expect(uploadSize(0, 0)).toEqual({ width: UPLOAD_LONG_EDGE });
  });
});

describe('prepareUpload', () => {
  it('resizes a large photograph to the bound and returns the JPEG base64', async () => {
    const manipulator = fakeManipulator();
    const upload = await prepareUpload({ uri: 'file:///tmp/a.jpg', width: 4032, height: 3024 }, { manipulator });
    expect(upload.base64).toBe('QUJD');
    expect(manipulator.calls).toEqual([
      { uri: 'file:///tmp/a.jpg', size: { width: UPLOAD_LONG_EDGE }, quality: UPLOAD_JPEG_QUALITY },
    ]);
  });

  it('still re-encodes a small photograph, so the wire format is always JPEG', async () => {
    // A HEIC from the library, or a PNG screenshot, would otherwise reach the server as-is.
    const manipulator = fakeManipulator();
    await prepareUpload({ uri: 'file:///tmp/small.heic', width: 1200, height: 900 }, { manipulator });
    expect(manipulator.calls[0].size).toBeNull();
    expect(manipulator.calls[0].quality).toBe(UPLOAD_JPEG_QUALITY);
  });

  it('lets a harness sweep the bound without touching the shipped constants', async () => {
    // server/eval/pipeline/clut-photos.ts measures what a bound costs before it is shipped.
    // The sweep has to run through this function, or it measures a different upload.
    const manipulator = fakeManipulator();
    await prepareUpload(
      { uri: 'file:///tmp/a.jpg', width: 4032, height: 3024 },
      { manipulator, bound: { longEdge: 3072, quality: 0.9 } },
    );
    expect(manipulator.calls).toEqual([{ uri: 'file:///tmp/a.jpg', size: { width: 3072 }, quality: 0.9 }]);
  });

  it('returns the upload\'s own oriented size, which is the frame every box the server returns is in', async () => {
    const manipulator = fakeManipulator();
    const upload = await prepareUpload({ uri: 'file:///tmp/a.jpg', width: 4032, height: 3024 }, { manipulator });
    expect(upload.width).toBe(2048);
    expect(upload.height).toBe(1536);
  });

  it('rejects an empty result rather than uploading nothing', async () => {
    const manipulator: Manipulator = {
      toJpegBase64: async () => ({ base64: '', width: 0, height: 0 }),
      cropToJpegBase64: async () => ({ base64: '', width: 0, height: 0 }),
    };
    await expect(
      prepareUpload({ uri: 'file:///tmp/a.jpg', width: 100, height: 100 }, { manipulator }),
    ).rejects.toThrow(/empty/);
  });
});

/**
 * The close read's crops. The phone cuts each product out of its original photograph at the box
 * the census gave, because a crop of the original reads a label that a crop of the 2048 upload
 * misreads (CLUT.md, "Read wide, then read close"). The rectangle is worked out here, once, in
 * pixels of the oriented original, so the device and the harness cut the same pixels.
 */
describe('cropRect', () => {
  it('pads the box on every side and returns whole pixels', () => {
    const rect = cropRect(1000, 2000, { x: 0.2, y: 0.3, w: 0.4, h: 0.2 }, 0.1);
    // 10% of the box's own width (400px) and height (400px) on each side.
    expect(rect).toEqual({ originX: 160, originY: 560, width: 480, height: 480 });
  });

  it('clamps a padded box to the image instead of asking for pixels outside it', () => {
    const rect = cropRect(1000, 1000, { x: 0, y: 0.9, w: 0.5, h: 0.1 }, 0.2);
    expect(rect).not.toBeNull();
    if (rect === null) return;
    expect(rect.originX).toBe(0);
    expect(rect.originY + rect.height).toBeLessThanOrEqual(1000);
    expect(rect.originX + rect.width).toBeLessThanOrEqual(1000);
  });

  it('returns null for a box with no area, rather than a crop of nothing', () => {
    expect(cropRect(1000, 1000, { x: 0.5, y: 0.5, w: 0, h: 0.2 }, 0.1)).toBeNull();
  });
});

describe('prepareCrops', () => {
  const photo = { uri: 'file:///tmp/a.jpg', width: 4032, height: 3024 };

  it('cuts one crop per box from the original, with the shipped padding, bound and quality', async () => {
    const manipulator = fakeManipulator();
    const boxes = [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: 0.5, y: 0.5, w: 0.3, h: 0.3 }];
    const crops = await prepareCrops(photo, boxes, { manipulator });
    expect(crops).toEqual(['crop-1', 'crop-2']);
    expect(manipulator.crops).toHaveLength(2);
    expect(manipulator.crops[0]).toEqual({ uri: photo.uri, box: boxes[0], padding: CROP_PADDING, longEdge: CROP_LONG_EDGE, quality: CROP_JPEG_QUALITY });
  });

  it('gives a box that cannot be cropped null, and still cuts the others', async () => {
    const manipulator = fakeManipulator();
    manipulator.cropToJpegBase64 = async (uri, box) => {
      if ((box as { x: number }).x === 0) throw new Error('bad extract area');
      return { base64: 'ok', width: 1, height: 1 };
    };
    const crops = await prepareCrops(photo, [{ x: 0, y: 0, w: 0.1, h: 0.1 }, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }], { manipulator });
    expect(crops).toEqual([null, 'ok']);
  });

  it('gives a null box null without touching the device', async () => {
    const manipulator = fakeManipulator();
    const crops = await prepareCrops(photo, [null], { manipulator });
    expect(crops).toEqual([null]);
    expect(manipulator.crops).toHaveLength(0);
  });

  it('keeps the crop bound above the size that misread and within the upload bound', () => {
    // The crops that misread a label were 640 pixels across and the one that read it was 1117
    // (CLUT.md); a bound under that would throw away the pixels the close read exists to see.
    expect(CROP_LONG_EDGE).toBeGreaterThanOrEqual(1280);
    expect(CROP_LONG_EDGE).toBeLessThanOrEqual(UPLOAD_LONG_EDGE);
  });
});
