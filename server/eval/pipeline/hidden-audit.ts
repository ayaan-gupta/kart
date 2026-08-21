/**
 * How much of each item the covered rule thinks is hidden, on the real trolley.
 *
 * `isInFront` decides that one item occludes another when its box ends lower in the frame. That
 * is a depth cue for a camera pointed forward at a shelf, where lower means nearer. It is not one
 * for a phone held over a trolley looking down, where lower means further along the basket and
 * most items lie in a single layer.
 *
 * Measured on the six trolley photographs, seven regions are drawn as covered. Judged against the
 * rendered overlays, four are real (the Muenster under an egg carton at 0.91 hidden, the purple
 * bag under the shopper's tote) and three are not: brussels sprouts and asparagus lying beside
 * their neighbours, whose boxes overlap while their pixels do not.
 *
 *     really covered   0.27  0.28  0.37  0.91
 *     side by side     0.21  0.26  0.27
 *
 * The ranges overlap at 0.27, so no value of COVERED_FRACTION separates them. A rule requiring
 * the occluder to contain the subject's centre was tried: it removes all three false flags and
 * two of the four real ones, trading the direction that matters (an item wrongly cleared is an
 * item that never reaches the bag) for the one that does not.
 *
 * The measure is wrong rather than the threshold. Two items side by side have overlapping boxes
 * and disjoint pixels; an item underneath another has genuinely overlapping pixels. The service
 * already computes the masks that would tell them apart, in `app.py` via SAM, but `Track` carries
 * only a box, so the masks never reach this rule. That is the fix, and it cannot be verified here
 * because sam2 is not installed locally. Seven flags is in any case too few to tune a replacement
 * on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COVERED_FRACTION } from '../../../src/engine/liveVision/config';
import { hiddenFractions } from '../../../src/engine/liveVision/occlusion';

const HERE = join(import.meta.dirname, '..');
const d = JSON.parse(readFileSync(join(HERE, 'carts-states.json'), 'utf8'));
const carts = new Set(['IMG_0244', 'IMG_0245', 'IMG_0246', 'IMG_0249', 'IMG_0252', 'IMG_0254']);

const flagged: number[] = [];
const clear: number[] = [];
for (const r of d.results) {
  if (!carts.has(r.id)) continue;
  const hidden = hiddenFractions(r.trackBoxes);
  const rows = hidden.map((h: number, i: number) => {
    (r.states[i] === 'covered' ? flagged : clear).push(h);
    return `${i}:${h.toFixed(2)}${r.states[i] === 'covered' ? '*' : ' '}`;
  });
  console.log(`  ${r.id}  ${rows.join('  ')}`);
}
const sorted = (xs: number[]) => xs.slice().sort((a, b) => a - b).map((x) => x.toFixed(2));
console.log(`\n  * = drawn as covered. COVERED_FRACTION is ${COVERED_FRACTION}`);
console.log(`  hidden fraction of the ${flagged.length} flagged: ${sorted(flagged).join(' ')}`);
console.log(`  hidden fraction of the ${clear.length} not flagged: ${sorted(clear).join(' ')}`);
