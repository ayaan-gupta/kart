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

const SCAN_PATH = path.join(__dirname, '../scan.tsx');

describe('scan.tsx keyframe pacing wiring', () => {
  it('passes the pipeline keyframe verdict as wantsKeyframe\'s second argument', () => {
    const source = fs.readFileSync(SCAN_PATH, 'utf8');
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

    if (call === null) throw new Error('session.wantsKeyframe(...) call not found in scan.tsx');
    const found = call as { argCount: number; secondArgSource: string };

    // A single-argument call is exactly the pre-fix bug: the pipeline's pacing verdict is
    // computed (see pipeline.ts's evaluateKeyframe) and never reaches this call at all.
    expect(found.argCount).toBeGreaterThanOrEqual(2);
    // A literal `true` would pass the argCount check while still discarding the real verdict.
    // The second argument must read from the keyframe verdict pipeline.ts's processFrame
    // returns, not a constant.
    expect(found.secondArgSource).toMatch(/keyframe/);
    expect(found.secondArgSource).toMatch(/fire/);
    expect(found.secondArgSource).not.toBe('true');
  });
});
