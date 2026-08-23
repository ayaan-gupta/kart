import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

/**
 * Frame Lab must drive the same session path `scan.tsx` drives.
 *
 * `scan.capturePath.test.ts` next door pins the shipping caller to `onCapture`. Nothing pinned the
 * harness, so the harness drifted the other way: `frame-lab.tsx` kept calling `onKeyframe` long
 * after `scan.tsx` moved, and its `server` mode is the only thing in the app that has ever made a
 * real network call. Every end-to-end claim made through that screen was therefore a claim about
 * a path that does not ship, including "the app reaches the service" and the shape of what came
 * back.
 *
 * The two failure modes are mirror images and this file exists for the second one:
 *
 *   scan.tsx reverts to onKeyframe   -> the product silently gets worse, caught next door
 *   frame-lab.tsx reverts            -> the product is fine and the evidence about it is false
 *
 * The second is harder to notice, because nothing breaks and the screen still fills a bag.
 *
 * Checked statically for the same reason its neighbour is: `frame-lab.tsx` pulls in expo-asset,
 * expo-image and the Frame Lab native module, none of which have a backing under Jest.
 */
const LAB_PATH = path.join(__dirname, '../dev/frame-lab.tsx');

function labSource(): { source: string; ast: ReturnType<typeof parse> } {
  const source = fs.readFileSync(LAB_PATH, 'utf8');
  return { source, ast: parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) };
}

/** Method calls by name, with each call's arguments as source text. */
function callsNamed(name: string): { count: number; argSources: string[] } {
  const { source, ast } = labSource();
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

describe('frame-lab.tsx census wiring', () => {
  it('sends keyframes through onCapture, the same call scan.tsx makes', () => {
    expect(callsNamed('onCapture').count).toBeGreaterThanOrEqual(1);
  });

  it('does not send marks built from the device detector', () => {
    // The whole point of the harness is that what it exercises is what ships. `onKeyframe` sends
    // marks from `AppleInstanceMaskDetector`, which enumerates a cart as roughly one blob; a run
    // through it says nothing about the capture path the product uses.
    expect(callsNamed('onKeyframe').count).toBe(0);
  });

  it('drives occlusion from the session, not a hardcoded false', () => {
    // This screen read `guideVisible({ occluded: false, coverage })` against a setter-less
    // coverage state, so the occluded notice and the capture guide could never appear on it and
    // CLAUDE.md's requirement 3 had no exercise anywhere in the app. The literal is the whole
    // regression: it typechecks, renders, and silently removes a requirement from the harness.
    const { source } = labSource();
    expect(source).not.toContain('occluded: false');
    // The verdict itself is read in `scanStep.ts` now; what this screen must do is apply it.
    expect(source).toMatch(/publishedScanState\(session, current,/);
    expect(source).toMatch(/setOccluded\(next\.occluded\)/);
  });

  it('publishes the same things scan.tsx publishes', () => {
    // A publish that sets identities and the bag only leaves the two screens agreeing about the
    // bag and about nothing else, which is what made the occlusion gap invisible for so long.
    const { source } = labSource();
    for (const call of ['setOccluded', 'setAmberPersists', 'setUnavailable', 'setBag',
                        'freshOcclusionEpisode']) {
      expect(source).toContain(call);
    }
  });

  it('hands onCapture the tracker rather than the frame tracks', () => {
    // Same contract `scan.tsx` honours: onCapture builds tracks from the service's regions and
    // returns an advanced tracker. Passing `result.tracks` instead would typecheck and quietly
    // track the device's blob rather than the products the service found.
    const [args] = callsNamed('onCapture').argSources;
    expect(args).toContain('tracker');
    expect(args).not.toContain('result.tracks');
  });
});
