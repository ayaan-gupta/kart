import { prepareUpload, uploadSize, UPLOAD_JPEG_QUALITY, UPLOAD_LONG_EDGE, type Manipulator } from '../uploadImage';

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

function fakeManipulator(): Manipulator & { calls: { uri: string; size: unknown; quality: number }[] } {
  const calls: { uri: string; size: unknown; quality: number }[] = [];
  return {
    calls,
    async toJpegBase64(uri, size, quality) {
      calls.push({ uri, size, quality });
      return 'QUJD';
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
    const base64 = await prepareUpload({ uri: 'file:///tmp/a.jpg', width: 4032, height: 3024 }, { manipulator });
    expect(base64).toBe('QUJD');
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

  it('rejects an empty result rather than uploading nothing', async () => {
    const manipulator: Manipulator = { toJpegBase64: async () => '' };
    await expect(
      prepareUpload({ uri: 'file:///tmp/a.jpg', width: 100, height: 100 }, { manipulator }),
    ).rejects.toThrow(/empty/);
  });
});
