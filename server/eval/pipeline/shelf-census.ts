/**
 * What the census does when the camera is pointed at a shelf rather than a cart.
 *
 * Four of the ten photographs are the supermarket shelves this trolley was filled from, and
 * nothing has ever run the census on them: `score_kart.py` measures only detection there, and
 * `census-live.ts` skips any frame with no hand count. But rule 13 is explicit that "shelves,
 * displays, other shoppers' carts, the floor and anything held in a hand are not in this cart and
 * must not be counted", and a shopper who lifts the phone too high is pointing at a shelf. If the
 * census names 24 products off a display, the app puts 24 items in their bag that they are not
 * buying, which is a worse failure than missing one.
 *
 * Measured 2026-08-22, and it does exactly that:
 *
 *     IMG_0247   24 badges, 24 called products, 0 refused  ->  15 units in the bag
 *     IMG_0248   20 badges, 20 called products, 0 refused  ->  15 units
 *     IMG_0250   43 badges, 43 called products, 0 refused  ->  41 units
 *     IMG_0251   15 badges, 15 called products, 0 refused  ->  14 units
 *
 * Not one badge refused across 102, on four photographs containing no cart at all. IMG_0250's own
 * occlusion note calls the refrigerated display "the cart shelves". There is no cart-or-not
 * discrimination in this pipeline; rule 13 asks for it and the model does not do it.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx \
 *       server/eval/pipeline/shelf-census.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyCensus, bagLines, createFusionState } from '../../../src/engine/liveVision/fusion';
import { MAX_CANDIDATES } from '../../src/enumerate';
import { runCensus } from '../../src/recognize';
import type { Mark } from '../../src/compositor';

const HERE = join(import.meta.dirname, '..');
const frames = JSON.parse(readFileSync(join(HERE, '.cache/kart/frames-named.json'), 'utf8'));
const ONLY_TROLLEYS = process.argv.includes('--trolleys');
const SHELVES = new Set(ONLY_TROLLEYS
  ? ['IMG_0244', 'IMG_0245', 'IMG_0246', 'IMG_0249', 'IMG_0252', 'IMG_0254']
  : ['IMG_0247', 'IMG_0248', 'IMG_0250', 'IMG_0251']);

for (const frame of frames.frames) {
  if (!SHELVES.has(frame.id)) continue;
  const marks: Mark[] = frame.boxes.map((box: any, i: number) => {
    const mark: Mark = { id: i + 1, box };
    const found = frame.catalog?.[i];
    const alts: string[] = found?.alternatives ?? [];
    if (alts.length > 0) {
      mark.candidates = alts.slice(0, MAX_CANDIDATES).map((sku: string) => ({
        sku, confidence: sku === found?.sku ? (found?.confidence ?? 0) : 0,
      }));
    }
    return mark;
  });
  const image = readFileSync(join(HERE, `.cache/kart/images/${frame.id}.jpg`));
  // Mid-session: the shopper has already scanned their cart, so the bag has names in it, and now
  // the camera is on a shelf. If those names make the census more willing to call a shelf a cart,
  // the gate fails exactly when it is needed.
  const carried = process.argv.includes('--mid-session')
    ? ['Oreo', 'Granny Smith apples', 'Seedtastic bread', 'baguette', 'Mr Lucky cauliflower',
       'brussels sprouts', 'asparagus', 'purple produce bag']
    : [];
  const census: any = await runCensus(image, marks, undefined, carried);
  const products = census.marks.filter((m: any) => m.isProduct).length;
  const notProducts = census.marks.filter((m: any) => !m.isProduct);
  const unmarked = (census.unmarkedItems ?? []).length;

  const trackIds = frame.boxes.map((_: unknown, i: number) => `t${i}`);
  const markToTrack: Record<number, string> = {};
  const liveBoxes: Record<string, any> = {};
  trackIds.forEach((t: string, i: number) => { markToTrack[i + 1] = t; liveBoxes[t] = frame.boxes[i]; });
  const state = applyCensus(createFusionState(), census, markToTrack, trackIds, false, liveBoxes);
  const lines = bagLines(state) as any[];
  const units = lines.reduce((n, l) => n + (l.qty ?? 1), 0);

  console.log(`\n  ${frame.id}: subjectIsCart=${census.subjectIsCart} | ${frame.boxes.length} badges -> ${products} called products, ` +
    `${notProducts.length} refused, ${unmarked} unmarked`);
  console.log(`      bag would hold ${units} units on ${lines.length} lines`);
  console.log(`      occlusion: ${census.occlusion?.severity} (${census.occlusion?.reason ?? ''})`);
  if (notProducts.length > 0) {
    console.log(`      refused: ${notProducts.slice(0, 4).map((m: any) => m.name).join(', ')}`);
  }
  console.log(`      first lines: ${lines.slice(0, 5).map((l) => l.name).join(', ')}`);
}
