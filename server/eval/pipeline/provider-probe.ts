/**
 * One census call per OpenRouter upstream, on one real cart photograph.
 *
 * OpenRouter serves `qwen/qwen3-vl-235b-a22b-instruct` from five upstreams and the service pins
 * one of them (`OPENROUTER_PROVIDER` in recognize.ts). The pin is not cosmetic: an upstream
 * serving at a lower `max_pixels` reads a smaller photograph, and two of them have answered
 * `items: []` with no error and a billed call. So a provider cannot be swapped on a latency
 * table; it has to be probed on the real thing first, and only then is a full scoring run worth
 * paying for.
 *
 * This is the cheap first half of that: one photograph, one census, per provider. It answers
 * three questions for a few tenths of a cent each.
 *
 *   1. does this upstream answer at all, or does it return an empty cart silently
 *   2. how long does the wide pass take, which is the half of the wait the shopper feels first
 *   3. how big is the image it read, in input tokens: Qwen bills 32x32 px per visual token, so
 *      fewer tokens on the same upload means a downscaled photograph and a brand read off it
 *
 * It does not score accuracy. Nothing here decides a provider on its own; it decides which one is
 * worth a `clut-photos.ts` run, and that run is the result.
 *
 * The pin is read once when `recognize.ts` is imported, so one process probes one provider:
 *
 *     for p in Parasail Venice Alibaba Novita DeepInfra; do
 *       KART_OPENROUTER_PROVIDER=$p node --env-file=server/.env.local \
 *         server/node_modules/.bin/tsx server/eval/pipeline/provider-probe.ts --append
 *     done
 *
 *     --image <id>    which photograph in server/eval/.cache/clut, default clut7
 *     --out <path>    where to write the result JSON, default server/eval/provider-probe.json
 *     --append        keep the rows already in --out, replacing any for the same provider
 */
import '../replay/rn-globals';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}

const { runCensus } = await import('../../src/recognize');
const { PRICES_PER_MTOK, resetUsage, usageTotals } = await import('../../src/usage');
const { orientedSize } = await import('../../src/compositor');
const { prepareUpload } = await import('../../../src/engine/liveVision/uploadImage');
const { sharpManipulator } = await import('./sharp-manipulator');
const { default: sharp } = await import('sharp');

const provider = process.env.KART_OPENROUTER_PROVIDER?.trim() || 'Parasail';
const image = arg('image', 'clut7');
const out = arg('out', join(import.meta.dirname, '../provider-probe.json'));
const file = join(import.meta.dirname, '../.cache/clut', `${image}.jpg`);
if (!existsSync(file)) {
  console.log(`${image}: absent from the cache; nothing to probe.`);
  process.exit(0);
}

// The phone sends `prepareUpload`'s bounded JPEG, not the file, and the bound is what decides how
// many visual tokens the upstream is billed for. Probing the raw file would measure an upload the
// phone never makes, which is the mistake `--as-phone` exists to stop in clut-photos.ts.
const { width, height } = orientedSize(await sharp(file).metadata());
const upload = await prepareUpload({ uri: file, width, height }, { manipulator: sharpManipulator });

resetUsage();
const started = Date.now();
let row: Record<string, unknown>;
try {
  const census = await runCensus(Buffer.from(upload.base64, 'base64'), []);
  const items = census.unmarkedItems ?? [];
  row = {
    provider,
    ok: true,
    seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
    items: items.length,
    subjectKind: census.subjectKind ?? null,
    occlusion: census.occlusion.severity,
    named: items.map((item) => {
      const count = census.inViewCounts.find((seen) => seen.productKey === item.productKey)?.count ?? 1;
      return `${item.description}${count > 1 ? ` x${count}` : ''}`;
    }),
  };
} catch (error) {
  row = {
    provider,
    ok: false,
    seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
    error: String(error instanceof Error ? error.message : error).slice(0, 200),
  };
}

// Cost is priced from the model's row in `usage.ts`, which is one price for the model rather than
// one per upstream, so treat it as the order of magnitude and read the token counts for the rest.
let usd = 0;
let inputTokens = 0;
let outputTokens = 0;
for (const [model, use] of Object.entries(usageTotals())) {
  const price = PRICES_PER_MTOK[model];
  inputTokens += use.inputTokens;
  outputTokens += use.outputTokens;
  if (price === undefined) continue;
  const uncached = use.inputTokens - use.cachedInputTokens;
  usd += (uncached * price.input + use.cachedInputTokens * price.cached + use.outputTokens * price.output) / 1e6;
}
row = { ...row, inputTokens, outputTokens, usd: Number(usd.toFixed(4)) };

const kept: Record<string, unknown>[] =
  argv.includes('--append') && existsSync(out)
    ? ((JSON.parse(readFileSync(out, 'utf8')) as { rows?: Record<string, unknown>[] }).rows ?? []).filter(
        (existing) => existing.provider !== provider,
      )
    : [];
const rows = [...kept, row];
writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), image, rows }, null, 1)}\n`);
console.log(JSON.stringify(row));
