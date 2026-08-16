import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

/**
 * I3 (branch review): `orchestrator.ts:229` is the only writer of `state.occlusion`, and it
 * only runs from a successful census. Once the census budget is spent (see I1), the occluded
 * notice's required wording ("We're pretty sure you're missing stuff in your cart...") could
 * stick on screen for the rest of the session with no way to clear it.
 *
 * `CoachNotice.test.tsx`'s "I3" describe block proves the fix composes correctly in isolation:
 * `coachKind` fed `guideVisible`'s result, instead of the raw occluded flag, clears even when
 * the underlying verdict is permanently stuck true. That alone cannot catch a regression where
 * scan.tsx stops actually wiring `guide` through (or reverts to the raw `occluded` state), since
 * scan.tsx cannot be rendered under Jest (no native camera module backing it here; see the
 * worklet-boundary and keyframe-pacing tests for the same constraint). This test closes that gap
 * statically, the same way those two do.
 */

const SCAN_PATH = path.join(__dirname, '../scan.tsx');

describe('scan.tsx occlusion notice exit wiring', () => {
  it('feeds coachKind the guide visibility, not the raw occluded flag', () => {
    const source = fs.readFileSync(SCAN_PATH, 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });

    let occludedArgSource: string | null = null;
    traverse(ast, {
      CallExpression(p) {
        const callee = p.node.callee;
        if (callee.type === 'Identifier' && callee.name === 'coachKind') {
          const arg = p.node.arguments[0];
          if (arg && arg.type === 'ObjectExpression') {
            for (const prop of arg.properties) {
              if (
                prop.type === 'ObjectProperty' &&
                prop.key.type === 'Identifier' &&
                prop.key.name === 'occluded'
              ) {
                occludedArgSource = source.slice(prop.value.start ?? 0, prop.value.end ?? 0);
              }
            }
          }
        }
      },
    });

    if (occludedArgSource === null) throw new Error('coachKind(...) call not found in scan.tsx');

    // The pre-fix bug: `occluded: occluded`, the raw session-published flag that orchestrator.ts
    // can stop updating once the census budget is spent, and that has no exit of its own.
    expect(occludedArgSource).not.toBe('occluded');
    // Must instead be (or derive from) `guide`, the same value CaptureGuide's own visibility
    // already uses, which carries the coverage-completion exit.
    expect(occludedArgSource).toMatch(/guide/);
  });
});
