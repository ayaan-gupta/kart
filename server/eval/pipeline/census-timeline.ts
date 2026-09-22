/**
 * When each product becomes croppable during the census, rather than when the census finishes.
 *
 * The photograph path waits for the whole census before it cuts a single crop, so the close read
 * of the first product starts only after the last product has been written. The census streams
 * already (`streamPhotoText`), and the schema puts `bbox_2d` last in every item, so a product's
 * rectangle is known the moment its own entry closes. If the first entries close early, the close
 * reads could run against the census's own tail and most of that stage would cost no wall time at
 * all.
 *
 * This measures the gap that idea lives in: time to the first token, time to each product's box,
 * and time to the end. One census call, on one photograph.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx \
 *       server/eval/pipeline/census-timeline.ts
 *
 *     --image <id>    which photograph in server/eval/.cache/clut, default clut7
 *     --out <path>    where to write the result JSON
 *
 * The call is the shipped one: the same model, prompt, schema, image bound and provider pin. It is
 * read here with the OpenAI stream directly rather than through `runCensus`, because what is being
 * timed is when each token arrives, which `runCensus` deliberately hides from its callers.
 */
import '../replay/rn-globals';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}

const { clientFor, MODELS } = await import('../../src/openai');
const { PHOTO_SYSTEM_PROMPT, censusUserText } = await import('../../src/prompts');
const { photoJsonSchema } = await import('../../src/schemas');
const { orientedSize } = await import('../../src/compositor');
const { prepareUpload } = await import('../../../src/engine/liveVision/uploadImage');
const { sharpManipulator } = await import('./sharp-manipulator');
const { default: sharp } = await import('sharp');

const image = arg('image', 'clut7');
const out = arg('out', join(import.meta.dirname, '../census-timeline.json'));
const file = join(import.meta.dirname, '../.cache/clut', `${image}.jpg`);
if (!existsSync(file)) {
  console.log(`${image}: absent from the cache; nothing to time.`);
  process.exit(0);
}

const { width, height } = orientedSize(await sharp(file).metadata());
const upload = await prepareUpload({ uri: file, width, height }, { manipulator: sharpManipulator });

const client = clientFor(MODELS.photo);
const started = Date.now();
const since = (): number => Number(((Date.now() - started) / 1000).toFixed(2));

const stream = await client.responses.create({
  model: MODELS.photo,
  prompt_cache_key: 'kart-photo',
  max_output_tokens: 3000,
  input: [
    { role: 'system', content: PHOTO_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'input_text', text: censusUserText([], [], [], []) },
        { type: 'input_image', image_url: `data:image/jpeg;base64,${upload.base64}`, detail: 'high' },
      ],
    },
  ],
  text: { format: { type: 'json_schema', name: 'photo_census', strict: true, schema: photoJsonSchema } },
  stream: true,
  provider: { order: [process.env.KART_OPENROUTER_PROVIDER?.trim() || 'Parasail'], allow_fallbacks: false },
} as never);

let text = '';
let firstToken: number | null = null;
let closed = 0;
const items: { at: number; wrote: string }[] = [];
for await (const event of stream as unknown as AsyncIterable<{ type: string; delta?: string }>) {
  if (event.type !== 'response.output_text.delta' || typeof event.delta !== 'string') continue;
  if (firstToken === null) firstToken = since();
  text += event.delta;
  // An item is croppable once its own entry closes, which the schema guarantees is after its
  // `bbox_2d`: everything the crop needs (the name to hint with, the rectangle to cut at) is
  // written by then.
  const whole = text.split(/\}\s*(?=,|\])/).length - 1;
  while (closed < whole) {
    closed += 1;
    const entry = text.split(/\}\s*(?=,|\])/)[closed - 1] ?? '';
    items.push({ at: since(), wrote: (/"name"\s*:\s*"([^"]{0,40})/.exec(entry)?.[1] ?? '').trim() });
  }
}

const total = since();
const result = {
  ranAt: new Date().toISOString(),
  image,
  firstTokenSeconds: firstToken,
  totalSeconds: total,
  characters: text.length,
  items,
  // What the overlap is worth: today every close read starts at `totalSeconds`; streaming would
  // start each one at its own `at`, so the stage stops costing wall time once the last box lands
  // early enough for its own read to finish inside the census's tail.
  lastBoxSeconds: items.at(-1)?.at ?? null,
};
writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
console.log(JSON.stringify({ ...result, items: items.map((i) => `${i.at}s ${i.wrote}`) }));
