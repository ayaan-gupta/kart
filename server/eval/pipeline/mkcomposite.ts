/**
 * Writes the image the census actually receives, so it can be looked at.
 *
 * Two defects were found by doing this and nothing else. The badges were being drawn twice,
 * once by the harness and again inside `runCensus`. And the frame was landscape when the
 * photograph is portrait: `compositeMarks` sized the resize from `metadata()`, which reports the
 * stored pair rather than the turned one, and `fit: "fill"` squashed the difference out. Boxes
 * are normalized, so they landed on the right products either way and every number downstream
 * looked reasonable.
 *
 *     node server/node_modules/.bin/tsx server/eval/pipeline/mkcomposite.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compositeMarks } from '../../src/compositor';
import type { Mark } from '../../src/compositor';
const HERE = join(import.meta.dirname, '..');
const frames = JSON.parse(readFileSync(join(HERE, '.cache/kart/frames-named.json'), 'utf8'));
for (const id of ['IMG_0252', 'IMG_0254']) {
  const frame = frames.frames.find((f: any) => f.id === id);
  const marks: Mark[] = frame.boxes.map((box: any, i: number) => ({ id: i + 1, box }));
  const image = readFileSync(join(HERE, `.cache/kart/images/${id}.jpg`));
  writeFileSync(`/tmp/composite-${id}-1024.jpg`, await compositeMarks(image, marks, 1024));
}
console.log('done');
