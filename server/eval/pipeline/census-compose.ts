/**
 * Draws the census's own badged images and writes its own prompt, for a model that is not the
 * shipped one.
 *
 * Set-of-mark prompting is the part of the census nothing has ever exercised on a real
 * photograph, and it has a failure the code comments already worry about: the model answers for
 * badge 7 and the answer lands on badge 8. That cannot be caught by scoring crops one at a time,
 * which is all the earlier isProduct measurement did. It needs the real composite.
 *
 * Everything here is the shipped code: `compositeMarks` draws the badges, `CENSUS_SYSTEM_PROMPT`
 * and `censusUserText` are the frozen strings the service sends.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compositeMarks } from '../../src/compositor';
import { CENSUS_SYSTEM_PROMPT, censusUserText } from '../../src/prompts';
import type { Mark } from '../../src/compositor';

const HERE = join(import.meta.dirname, '..');
const OUT = join(HERE, '.cache/kart/census');
mkdirSync(OUT, { recursive: true });

const frames = JSON.parse(readFileSync(join(HERE, '.cache/kart/frames.json'), 'utf8'));
const CARTS = new Set(['IMG_0244', 'IMG_0245', 'IMG_0246', 'IMG_0249', 'IMG_0252', 'IMG_0254']);

writeFileSync(join(OUT, 'system.txt'), CENSUS_SYSTEM_PROMPT);
for (const frame of frames.frames) {
  if (!CARTS.has(frame.id)) continue;
  const marks: Mark[] = frame.boxes.map((box: any, i: number) => ({ id: i, box }));
  const image = readFileSync(join(HERE, `.cache/kart/images/${frame.id}.jpg`));
  const composed = await compositeMarks(image, marks, 1333);
  writeFileSync(join(OUT, `${frame.id}.png`), composed);
  writeFileSync(join(OUT, `${frame.id}.txt`), censusUserText(marks));
  console.log(`  ${frame.id}: ${marks.length} badges`);
}
console.log(`\n  wrote badged images and prompts to ${OUT}`);
