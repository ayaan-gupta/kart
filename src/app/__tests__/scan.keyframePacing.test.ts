import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

/**
 * I1 (branch review): `pipeline.ts`'s `evaluateKeyframe` verdict (sharpness, motion, and
 * `minIntervalMs`/scene-change pacing) used to be computed every frame and thrown away, because
 * `scan.tsx` called `session.wantsKeyframe(result.tracks)` with only the tracks. `wantsKeyframe`
 * alone only answers session eligibility (budget, in-flight, anything confirmed), so the only
 * pacing left on device was one-in-flight, and the 8-call census budget could be spent in well
 * under a minute.
 *
 * `RecognitionSession.wantsKeyframe`'s own tests (`orchestrator.test.ts`) cover the method in
 * isolation: passing `paced: false` returns `false`. That alone cannot catch a regression where
 * `scan.tsx` stops passing the verdict at all (or hardcodes `true`), since scan.tsx cannot be
 * rendered under Jest (react-native-vision-camera's Camera, useFrameProcessor,
 * useCameraDevice and useCameraPermission have no native backing here; see the worklet-boundary
 * test's own use of static parsing for the same reason). This test closes that gap the same
 * way: statically confirms scan.tsx's `wantsKeyframe` call site actually threads a second
 * argument through, rather than discarding the pipeline's verdict again.
 */

// `session.wantsKeyframe` is called from `scanStep.ts` now, which both scan.tsx and the Frame Lab
// harness route through; scan.tsx's job is to hand it the real verdict. Both halves are checked
// below, because either one alone can discard the pacing decision.
const SCAN_PATH = path.join(__dirname, '../scan.tsx');
const STEP_PATH = path.join(__dirname, '../../engine/liveVision/scanStep.ts');

describe('scan.tsx keyframe pacing wiring', () => {
  it('hands the pipeline verdict to the shared step rather than a constant', () => {
    // The scan.tsx half. `scanStep.ts` threading its third parameter through is worth nothing if
    // the caller passes `true`, which would typecheck and silently unpace every keyframe.
    const source = fs.readFileSync(SCAN_PATH, 'utf8');
    // `\s*` rather than literal spaces: the call is now wrapped across lines to carry the
    // adaptive blur floor as well, and this test is about which verdict is passed, not about
    // where the formatter chose to break the line.
    expect(source).toMatch(/nextScanRequest\(\s*session,\s*current,\s*result\.keyframe\.fire\s*,/);
  });

  it('passes the pipeline keyframe verdict as wantsKeyframe\'s second argument', () => {
    const source = fs.readFileSync(STEP_PATH, 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });

    let call: { argCount: number; secondArgSource: string } | null = null;
    traverse(ast, {
      CallExpression(p) {
        const callee = p.node.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'wantsKeyframe'
        ) {
          const second = p.node.arguments[1];
          call = {
            argCount: p.node.arguments.length,
            secondArgSource: second ? source.slice(second.start ?? 0, second.end ?? 0) : '',
          };
        }
      },
    });

    if (call === null) throw new Error('session.wantsKeyframe(...) call not found in scanStep.ts');
    const found = call as { argCount: number; secondArgSource: string };

    // A single-argument call is exactly the pre-fix bug: the pipeline's pacing verdict is
    // computed (see pipeline.ts's evaluateKeyframe) and never reaches this call at all.
    expect(found.argCount).toBeGreaterThanOrEqual(2);
    // A literal `true` would pass the argCount check while still discarding the real verdict.
    // The second argument must read from the keyframe verdict pipeline.ts's processFrame
    // returns, not a constant.
    // Case-insensitive because the parameter this arrives as in `scanStep.ts` is `keyframeFire`.
    // What it must not be is a constant; that the *real* verdict reaches the shared step is
    // pinned by the scan.tsx case above, which requires `result.keyframe.fire` literally.
    expect(found.secondArgSource).toMatch(/keyframe/i);
    expect(found.secondArgSource).toMatch(/fire/i);
    expect(found.secondArgSource).not.toBe('true');
  });
});
