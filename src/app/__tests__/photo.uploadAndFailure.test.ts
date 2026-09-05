import fs from 'fs';
import path from 'path';

/**
 * Two things the photograph screen must do that its unit-tested modules cannot do for it.
 *
 * Asserted statically for the reason `photo.occlusionNotice.test.ts` gives: photo.tsx pulls in
 * PhotoCameraCapture and therefore VisionCamera, which has no native module under Jest, so the
 * screen cannot be rendered here. `uploadImage.test.ts` proves the bound is right and
 * `scanFailure.test.ts` proves the line is right; this proves the screen uses them.
 */

const PHOTO = fs.readFileSync(path.join(__dirname, '../photo.tsx'), 'utf8');
const CAPTURE = fs.readFileSync(path.join(__dirname, '../../components/PhotoCameraCapture.tsx'), 'utf8');

describe('photo.tsx sends a bounded JPEG, not the file the camera wrote', () => {
  it('routes both the camera and the library through prepareUpload', () => {
    expect(PHOTO).toContain('prepareUpload(');
    // The picker must hand over a uri and its dimensions, not a base64 of the full file: asking
    // it for base64 is asking for the 7.6MB body this exists to stop.
    expect(PHOTO).not.toMatch(/base64:\s*true/);
  });

  it('gives the capture component no base64 work of its own', () => {
    // It used to read the whole file into base64 before the screen ever saw it, which put the
    // resize after the expensive step instead of before it.
    expect(CAPTURE).not.toContain('base64()');
    expect(CAPTURE).not.toContain("from 'expo-file-system'");
  });
});

describe('photo.tsx says why a photograph failed', () => {
  it('renders the failure line with the address that was tried', () => {
    expect(PHOTO).toContain('describeScanFailure(');
    expect(PHOTO).toContain('lastRecognitionEndpoint()');
  });

  it('gives the census the photograph budget, not the live-scan one', () => {
    expect(PHOTO).toContain('PHOTO_REQUEST_TIMEOUT_MS');
  });
});
