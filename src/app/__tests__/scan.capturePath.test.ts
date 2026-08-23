import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

/**
 * `scan.tsx` must badge the census from the service's regions, not from the device detector.
 *
 * It used to call `session.onKeyframe(keyframe, result.tracks, now)`. `result.tracks` comes from
 * `processFrame` over `AppleInstanceMaskDetector`, which returns 1 to 2 instances per frame on the
 * corpus scan (mean 1.1, `npm run bench:detector`) and draws one outline around the whole pile
 * rather than one per item. `docs/detector-decision.md` measured that request as dead for
 * enumeration and landed on `onCapture`, which sends no marks so the service enumerates, and
 * `onCapture` was then called from nothing but its own tests for a week.
 *
 * Measured on `server/eval/pipeline/scan-loop.ts`, the difference is 16.3 units and 6.67 of 9
 * products against 8.67 and 8.17 for a nine-product trolley. Reverting this call site would give
 * that back silently: no test fails, no type breaks, and the bag simply fills with descriptions.
 *
 * `scan.tsx` cannot be rendered under Jest, because react-native-vision-camera's `Camera`,
 * `useFrameProcessor`, `useCameraDevice` and `useCameraPermission` have no native backing here.
 * So this checks the call site statically, the same way the keyframe-pacing and worklet-boundary
 * tests do for the same reason.
 */
const SCAN_PATH = path.join(__dirname, '../scan.tsx');

function scanSource(): { source: string; ast: ReturnType<typeof parse> } {
  const source = fs.readFileSync(SCAN_PATH, 'utf8');
  return { source, ast: parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) };
}

function callsNamed(name: string): { count: number; argSources: string[] } {
  const { source, ast } = scanSource();
  let count = 0;
  const argSources: string[] = [];
  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      if (
        callee.type === 'MemberExpression' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === name
      ) {
        count += 1;
        argSources.push(
          p.node.arguments.map((a) => source.slice(a.start ?? 0, a.end ?? 0)).join(' | '),
        );
      }
    },
  });
  return { count, argSources };
}

describe('scan.tsx census wiring', () => {
  it('sends keyframes through onCapture, so the service enumerates them', () => {
    expect(callsNamed('onCapture').count).toBeGreaterThanOrEqual(1);
  });

  it('does not badge the census from the device detector', () => {
    // The regression this exists for: swapping back to onKeyframe costs about nine units and one
    // and a half products on the corpus scan, and nothing else would notice.
    expect(callsNamed('onKeyframe').count).toBe(0);
  });

  it('hands onCapture the tracker rather than the frame tracks', () => {
    // onCapture builds tracks from the service's regions and returns an advanced tracker. Passing
    // `result.tracks` instead would not type-check, but passing the wrong state might.
    const [args] = callsNamed('onCapture').argSources;
    expect(args).toMatch(/tracker/);
  });

  it('writes the advanced tracker back, so the next frame tracks the service regions', () => {
    // Without this the capture's regions are overwritten by the next frame's single blob, which is
    // the interaction scan-loop.ts exists to exercise.
    const { source } = scanSource();
    expect(source).toMatch(/tracker:\s*captured\.tracker/);
  });

  it('reads the capture\'s tracks after a capture, not the frame\'s blob', () => {
    // The defect this exists for, found by reading the diff rather than by any measurement.
    // After a capture landed, setTracks showed the tracks onCapture built from the service's
    // regions while publish() and refreshNextRequest() still read `result.tracks`, the per-frame
    // tracks from the device detector, which is one outline around the whole pile. So
    // tracksNeedingThumbnail would ask for a crop of the blob and never of the products, and
    // thumbnails would stop being made for everything a capture found; persistentAmber would
    // compute the overlay state from one track instead of eight.
    //
    // Invisible to every other check here: the eval harnesses never request a thumbnail and a
    // simulator has no camera to make one with.
    const { source } = scanSource();

    // A per-frame binding that starts as the frame's tracks and becomes the capture's.
    expect(source).toMatch(/let current = result\.tracks;/);
    expect(source).toMatch(/current = captured\.tracks;/);

    // And both readers must receive it. `tracksNeedingThumbnail` and `persistentAmber` moved
    // into `scanStep.ts` so frame-lab.tsx cannot hand-mirror them wrongly a third time, so what
    // scan.tsx has to get right is which tracks it hands over. Passing `result.tracks` here is
    // the same defect wearing a different shape, and still typechecks.
    expect(source).toMatch(/publishedScanState\(session, current,/);
    expect(source).toMatch(/nextScanRequest\(session, current,/);
  });
});
