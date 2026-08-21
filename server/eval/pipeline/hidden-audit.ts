/**
 * How much of each item the covered rule thinks is hidden, on the real trolley.
 *
 * `isInFront` decides that one item occludes another when its box ends lower in the frame. That
 * is a depth cue for a camera pointed forward at a shelf, where lower means nearer. It is not one
 * for a phone held over a trolley looking down, where lower means further along the basket and
 * most items lie in a single layer.
 *
 * Measured on the six trolley photographs, seven regions are drawn as covered. Judged from
 * cropped views of each flagged region rather than from the full frame, which changed the
 * answer: three are real and four are not.
 *
 *     really covered   0.28  0.37  0.91   jar behind the apples, Muenster under an egg
 *                                         carton, salmon under the shopper's tote
 *     not covered      0.21  0.26  0.27  0.27
 *
 * Those separate at 0.28, and raising COVERED_FRACTION would clear all four false flags here.
 * It is not raised, for two reasons. Seven flags is too few to fit a shipped constant on, and
 * the value would be fitted on the same seven it was judged against. And the shelf corpus that
 * produced 0.2 disagrees: there the flagged items are named 7.5 points worse than the rest at
 * 0.2 and only 3 points worse at 0.3, so the signal is strongest exactly where this corpus says
 * it over-fires.
 *
 * The disagreement is the finding. The two corpora photograph from different places. A shelf is
 * shot facing forward, where lower in the frame does mean nearer the camera and `isInFront` is
 * a real depth cue. A trolley is shot from above, where lower in the frame means further along
 * the basket and most items lie in one layer.
 *
 * The fourth false flag shows the cue can be worse than uninformative. It is the shopper's
 * woven tote, drawn as covered because the salmon sits lower in the frame. The tote lies on top
 * of the salmon. In a top-down view the test is sometimes exactly backwards.
 *
 * A rule requiring the occluder to contain the subject's centre was also tried: it clears all
 * the false flags and two of the real ones, trading the direction that matters (an item wrongly
 * cleared never reaches the bag) for the one that does not.
 *
 * Masks do not fix it either, and the reason is worth writing down. A mask covers what can be
 * seen, so SAM never labels the hidden part of an occluded item and mask-against-mask overlap
 * is ~0 even for a real occlusion; measured on all six photographs it is 0.00 everywhere. The
 * silhouette's fill of its own box does carry some signal but not enough: really covered items
 * fill 0.44 to 0.58 of their box and the false ones 0.47 to 0.73.
 *
 * What this needs is a depth cue rather than a better threshold on a geometric proxy.
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
