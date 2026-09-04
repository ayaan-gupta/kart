import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

/**
 * CLAUDE.md's third requirement, on the screen the shopper actually uses.
 *
 * `COACH_COPY.occluded` is the product owner's own wording, written for exactly this: "We're
 * pretty sure you're missing stuff in your cart. Move items that are covering it and scan those
 * items." The census answers the question it is built on for every photograph. But photo.tsx
 * rendered `<CoachNotice kind={failure === null ? 'none' : 'unavailable'} />`, so the occluded
 * notice was unreachable on this path: the only two values that ternary can produce are the two
 * that are not it. Measured on server/eval/corpus/clut, the census raised the flag on 25 of the
 * 39 scans that have something hidden, and a shopper was told about none of them.
 *
 * Asserted statically for the reason `scan.occlusionExit.test.ts` gives: photo.tsx pulls in
 * PhotoCameraCapture and therefore VisionCamera, which has no native module under Jest, so the
 * screen cannot be rendered here. This closes the gap the unit tests cannot: `photoScan.test.ts`
 * proves the report comes back, and nothing else proves the screen does anything with it.
 */

const PHOTO_PATH = path.join(__dirname, '../photo.tsx');

describe('photo.tsx occlusion notice wiring', () => {
  it('derives the notice from coachKind, so the occluded wording can be reached at all', () => {
    const source = fs.readFileSync(PHOTO_PATH, 'utf8');
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });

    let kindSource: string | null = null;
    traverse(ast, {
      JSXOpeningElement(p) {
        const name = p.node.name;
        if (name.type !== 'JSXIdentifier' || name.name !== 'CoachNotice') return;
        for (const attr of p.node.attributes) {
          if (attr.type !== 'JSXAttribute' || attr.name.name !== 'kind') continue;
          const value = attr.value;
          if (value && value.type === 'JSXExpressionContainer') {
            kindSource = source.slice(value.expression.start ?? 0, value.expression.end ?? 0);
          }
        }
      },
    });

    expect(kindSource).not.toBeNull();
    // `coachKind` is the one place that decides which of the three notices wins, and it already
    // puts "recognition is not answering" above "things are covered". Reimplementing that choice
    // here with a second ternary is how the two screens drift apart.
    expect(kindSource).toContain('coachKind');
    expect(kindSource).toContain('occluded');
    // Not the literal false: passing a constant satisfies "contains occluded" while leaving the
    // notice exactly as unreachable as the ternary it replaced.
    expect(kindSource).not.toMatch(/occluded:\s*false/);
  });

  it('clears what the previous photograph said, so a second one can answer the notice', () => {
    const source = fs.readFileSync(PHOTO_PATH, 'utf8');
    // The remedy the copy asks for is another photograph, so the flag has to be replaced on every
    // shutter press rather than latched. A setter that is only ever called with true would leave
    // the notice on screen after the shopper has done what it asked.
    expect(source).toMatch(/setOccluded\(\s*outcome\.occlusion\.itemsLikelyHidden\s*\)/);
    expect(source).toMatch(/setOccluded\(\s*false\s*\)/);
  });
});
