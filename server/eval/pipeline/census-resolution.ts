/**
 * What the census cannot see at 1024 pixels.
 *
 * Two defects showed up together on the real trolleys and they have the same shape. The model
 * reads a legible brand wrong, calling one Mr. Lucky cauliflower "ducky", "misty lick",
 * "pinnacle lucky" and "goodlife" across four runs while reporting confidence 0.95 and
 * needsCloserLook false. And `unmarkedItems` comes back empty on every photograph, including a
 * sixteen-product trolley with eleven badges, where `applyCensus` is built to expect it to be
 * the main channel.
 *
 * Reasoning effort is not the cause: none, low and medium all return an empty list on the two
 * loaded trolleys, and one item on the fullest.
 *
 * The photographs are 5712 by 4284. `CENSUS_LONG_EDGE` is 1024, a 5.6x downscale, which puts
 * the brand on a cauliflower wrapper at roughly forty pixels wide and an unbadged jar behind
 * the bread at almost nothing. This sweeps that one number and leaves everything else alone.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx server/eval/pipeline/census-resolution.ts
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

const EDGES = [1024, 1536, 2048];
const REPEATS = 2;
const SUBJECTS = ['IMG_0249', 'IMG_0252', 'IMG_0254'];

const marksFor = (frame: any): Mark[] => frame.boxes.map((box: any, i: number) => {
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

const out: any[] = [];
for (const id of SUBJECTS) {
  const frame = frames.frames.find((f: any) => f.id === id);
  const marks = marksFor(frame);
  const image = readFileSync(join(HERE, `.cache/kart/images/${id}.jpg`));
  const real = counted.get(id)?.products ?? null;

  for (const edge of EDGES) {
    const composited = await compositeMarks(image, marks, edge);
    for (let run = 0; run < REPEATS; run += 1) {
      const response = await openai.responses.create({
        model: MODELS.census,
        reasoning: { effort: 'none' },
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
      const unmarked = (parsed.unmarkedItems ?? []).map((u: any) => u.description);
      const inView = (parsed.inViewCounts ?? []).reduce((n: number, c: any) => n + (c.count ?? 1), 0);
      out.push({ id, edge, run, real, marks: parsed.marks, unmarked, inView,
        tokens: (response as any).usage?.input_tokens ?? null });
      console.log(`  ${id}  ${String(edge).padStart(4)}px run${run}  ` +
        `${String(unmarked.length).padStart(2)} unmarked, inView ${String(inView).padStart(2)} of ${real}, ` +
        `${(response as any).usage?.input_tokens ?? '?'} input tokens`);
      if (unmarked.length) console.log(`      ${unmarked.join(', ')}`);
    }
  }
  console.log('');
}
writeFileSync(join(HERE, 'kart-census-resolution.json'), JSON.stringify(out, null, 1));
