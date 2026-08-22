/**
 * Why `unmarkedItems` comes back empty.
 *
 * The census asks two different things at once. Naming a badged region is perception: look at
 * the pixels under the badge and read them. Listing what has no badge is a search: sweep the
 * frame, subtract everything already accounted for, and report the remainder. `runCensus` sends
 * `reasoning: { effort: "none" }`, which is right for the first job and is the obvious suspect
 * for the second.
 *
 * Measured with the catalog shortlist attached, on the two loaded trolleys, `unmarkedItems` was
 * empty on every one of six photographs, including a sixteen-product trolley with eleven
 * badges. `applyCensus` is built on the opposite assumption: enumeration recall is 38%, so the
 * whole-frame answer is meant to be the main channel.
 *
 * Everything here is the shipped request. Only the effort changes.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx server/eval/pipeline/census-effort.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compositeMarks } from '../../src/compositor';
import type { Mark } from '../../src/compositor';
import { MAX_CANDIDATES } from '../../src/enumerate';
import { openai, MODELS } from '../../src/openai';
import { CENSUS_SYSTEM_PROMPT, censusUserText } from '../../src/prompts';
import { censusJsonSchema } from '../../src/schemas';

const HERE = join(import.meta.dirname, '..');
const frames = JSON.parse(readFileSync(join(HERE, '.cache/kart/frames-named.json'), 'utf8'));
const truth = JSON.parse(readFileSync(join(HERE, 'corpus/kart/counts.json'), 'utf8'));
const counted = new Map<string, any>(truth.counted.map((c: any) => [c.id, c]));

// The same long edge runCensus composites at.
const LONG_EDGE = 1024;
const EFFORTS = ['none', 'low', 'medium'] as const;
const SUBJECTS = ['IMG_0249', 'IMG_0252', 'IMG_0254'];

const rows: any[] = [];
for (const id of SUBJECTS) {
  const frame = frames.frames.find((f: any) => f.id === id);
  const real = counted.get(id)?.products ?? null;
  const marks: Mark[] = frame.boxes.map((box: any, i: number) => {
    const mark: Mark = { id: i + 1, box };
    const found = frame.catalog?.[i];
    const alternatives: string[] = found?.alternatives ?? [];
    if (alternatives.length > 0) {
      mark.candidates = alternatives.slice(0, MAX_CANDIDATES).map((sku: string) => ({
        sku, confidence: sku === found?.sku ? (found?.confidence ?? 0) : 0,
      }));
    }
    return mark;
  });
  const image = readFileSync(join(HERE, `.cache/kart/images/${id}.jpg`));
  const composited = await compositeMarks(image, marks, LONG_EDGE);

  for (const effort of EFFORTS) {
    const response = await openai.responses.create({
      model: MODELS.census,
      reasoning: { effort },
      input: [
        { role: 'system', content: CENSUS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: censusUserText(marks) },
            { type: 'input_image', image_url: `data:image/jpeg;base64,${composited.toString('base64')}`, detail: 'auto' },
          ],
        },
      ],
      text: { format: { type: 'json_schema', name: 'cart_census', strict: true, schema: censusJsonSchema } },
    } as any);
    const parsed = JSON.parse((response as any).output_text);
    const unmarked = parsed.unmarkedItems ?? [];
    const products = (parsed.marks ?? []).filter((m: any) => m.isProduct).length;
    const total = (parsed.inViewCounts ?? []).reduce((n: number, c: any) => n + (c.count ?? 1), 0);
    rows.push({ id, effort, badges: marks.length, products, unmarked: unmarked.length, inView: total, real });
    console.log(`  ${id}  effort ${effort.padEnd(6)} ${products} badged products, ` +
      `${String(unmarked.length).padStart(2)} unmarked, inViewCounts sums to ${String(total).padStart(2)}, ` +
      `${real} real`);
    if (unmarked.length) {
      console.log(`      ${unmarked.map((u: any) => u.description).join(', ')}`);
    }
  }
  console.log('');
}
writeFileSync(join(HERE, 'kart-census-effort.json'), JSON.stringify(rows, null, 1));
