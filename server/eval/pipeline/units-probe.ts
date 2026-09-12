/**
 * Does asking a second, separate question at each box find the packages the count misses, and
 * what does it cost in packages that are not there?
 *
 * Two of the fifteen clut photographs fail on the number of packages, and both survive the gate
 * because both readings make the same mistake. On clut4 two bags of Priano rigatoni lean against
 * each other and every saved scan says one. On clut9 a box of rosemary sourdough crackers stands
 * behind a box of sea salt and both readings say "2 x sea salt", the right number of the wrong
 * product.
 *
 * What was tried first and does not work (2026-09-12, all on the crops the phone actually sends):
 *
 *   - adding a `units` array to the shipped close read, so the points ride in a call already
 *     being made. It answers one unit on both failures. The close read opens "You are looking at
 *     a close crop of one grocery product" and is handed the first pass's name for it, and under
 *     that framing the model reports the one product it was told about.
 *   - asking the same call for the tight region first and pointing inside it. Three times out of
 *     three on clut4, one unit.
 *   - re-cutting at that region and asking again. On clut9 the region shrank onto the front box
 *     and the evidence went with it.
 *   - Grounding DINO, the detector `server/enumerator` already runs for the live scan, on the
 *     same crop with the wide pass's own words: one box over both bags at its shipped threshold,
 *     and at 0.10 six boxes on a single jar of Nutella.
 *   - SAM's automatic masks (facebook/sam-vit-base): no mask on either bag, masks on the counter
 *     and the worksheet behind them.
 *
 * What does work is asking on its own, with nothing said about what the crop is supposed to be.
 * The same crop that answers "one" inside the close read answers with both cracker boxes, named
 * apart, as a bare question. So this is a separate call, and the arms are how it is asked:
 *
 *   neutral   the crop, and "report one entry per package", naming nothing.
 *   anchored  the same, plus the wide pass's words for the product, and the instruction that a
 *             package of anything else is not an entry.
 *
 * The crop goes out at 768 pixels on its long edge, where clut9 still separates and labels both
 * varieties: about 550 input tokens, or two hundredths of a cent a call.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx \
 *       server/eval/pipeline/units-probe.ts server/eval/clut-photos-salvage.json
 *
 *       --pass <n>        which pass of the saved run to replay, 0 for every pass, default 1
 *       --only <ids>      comma-separated image ids
 *       --arm <names>     comma-separated: neutral, anchored, named. Default "neutral,anchored".
 *                         `named` anchors on the wide pass's name without its brand.
 *       --long-edge <n>   what the crop goes out at, default 768
 *       --gate-count      ask only where the close read counted more than one package
 *       --variety-only    act only on a crop holding more than one variety, never on a count
 *       --confirm-counts  assert a count the gate is holding back when the units agree with it
 *       --from <paths>    comma-separated earlier runs of this harness: the points are read back
 *                         and no model call is made, so a policy is re-measured for nothing
 *       --out <path>      result JSON, default server/eval/units-probe.json
 *       --out-dir <dir>   re-verdicted copies of each run, default .cache/units-probe
 *       --write-crops     write every crop asked about to .cache/clut/units/
 *
 * The copies are the saved run with the stage applied, so the four requirements are scored by the
 * scorer every other number in CLUT.md comes from:
 *
 *     node server/node_modules/.bin/tsx server/eval/pipeline/clut-rescore.ts \
 *       server/eval/clut-photos-salvage.json \
 *       server/eval/.cache/units-probe/anchored-gated-variety-confirmed-sure/clut-photos-salvage.json
 *
 * Two copies per arm. In `-sure` a split line keeps the certainty the line it came from had; in
 * `-unsure` every split line is held back for the shopper to check. The pair brackets what
 * trusting the second question would be worth and what it would cost.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import OpenAI from 'openai';
import { MODELS } from '../../src/openai';
import { PRICES_PER_MTOK } from '../../src/usage';
import { orientedSize } from '../../src/compositor';
import { norm, type ScoreLine } from './clut-scoring';
import { sharpManipulator } from './sharp-manipulator';

const { prepareCrops } = await import('../../../src/engine/liveVision/uploadImage');

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}
const takesValue = new Set(['--pass', '--only', '--out', '--out-dir', '--arm', '--long-edge', '--from']);
const files = argv.filter((a, i) => !a.startsWith('--') && !takesValue.has(argv[i - 1] ?? ''));
const wantedPass = Number(arg('pass', '1'));
const only = arg('only', '');
const out = arg('out', join(import.meta.dirname, '../units-probe.json'));
const outDir = arg('out-dir', join(import.meta.dirname, '../.cache/units-probe'));
const longEdge = Number(arg('long-edge', '768'));
const writeCrops = argv.includes('--write-crops');
const from = arg('from', '');
const varietyOnly = argv.includes('--variety-only');
/**
 * Ask only where the close read already says there is more than one package. That is the case a
 * hidden variety can be in, and it is 21 of the 133 crops of two passes over the fifteen
 * photographs, so the stage costs a sixth of what asking at every box costs.
 */
const gateCount = argv.includes('--gate-count');
/**
 * Give a held-back count its second witness. Since 2026-09-11 a line whose two readings agree on
 * a count above one is not asserted (`countNeedsCheck` in src/reconcile.ts), because both counted
 * the same pixels in the same way. The unit pass is a different question asked of the same crop
 * and it answers with one entry per package, so a count it agrees with has been counted twice by
 * two methods. This marks such a line sure again, and only when the close read had already
 * reconciled it as sure, so nothing the gate held back for another reason is let through.
 */
const confirmCounts = argv.includes('--confirm-counts');
const arms = arg('arm', 'neutral,anchored').split(',').map((s) => s.trim()).filter((s) => s.length > 0);

const IMAGES = join(import.meta.dirname, '../.cache/clut');
const CROPS = join(IMAGES, 'units');
if (writeCrops) mkdirSync(CROPS, { recursive: true });

interface ImageLabels { id: string }
const labels = JSON.parse(readFileSync(join(import.meta.dirname, '../corpus/clut/labels.json'), 'utf8')) as { images: ImageLabels[] };
const known = new Set(labels.images.map((image) => image.id));

interface Box { x: number; y: number; w: number; h: number }
interface Item { name: string; brand: string | null; qty: number; confidence: number; status?: string; box: Box | null }
interface VerifyEntry { id: string; close?: { count?: number } | null; line?: { sure?: boolean } }
interface Row {
  id: string;
  pass: number;
  tier: string;
  lines?: (ScoreLine & { sure?: boolean })[];
  items?: Item[];
  verify?: { items?: VerifyEntry[] } | null;
}

const unitsJsonSchema = {
  type: 'object',
  properties: {
    units: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          // The [0, 1000] scale Qwen3-VL's grounding is trained on, not the whole percentages the
          // rest of the pipeline uses. Asking in the format the model was taught is the point of
          // the field; converting belongs where a crop would be cut from it.
          x: { type: 'integer', minimum: 0, maximum: 1000 },
          y: { type: 'integer', minimum: 0, maximum: 1000 },
        },
        required: ['label', 'x', 'y'],
        additionalProperties: false,
      },
    },
  },
  required: ['units'],
  additionalProperties: false,
} as const;

const COMMON = `
Locate every separate physical package in the crop and report one entry per package in units:
x and y are the centre of that package on a scale where the left edge of the crop is 0, the right
edge is 1000, the top edge is 0 and the bottom edge is 1000; label is a few words you can actually
read on that package, enough to tell it from the one beside it.

Two packages of one product leaning against each other, or one standing behind another with only
its top showing, are two entries, not one. Two packages of the same range in different flavours or
varieties are two entries, and their labels must say which is which. Two lines of text on one
package are one entry, not two. Something that is not a package of a grocery product is not an
entry at all.

Answer only with the structured object.
`.trim();

const ANCHORED =
  `You are looking at a close crop cut from a photograph of groceries. You are asked about one `
  + `product in it, named in the message. The crop is cut wide and usually shows the edge of a `
  + `neighbour; a package of any other product is not an entry.`;
const SYSTEM: Record<string, string> = {
  neutral: `You are looking at a close crop cut from a photograph of groceries.\n\n${COMMON}`,
  anchored: `${ANCHORED}\n\n${COMMON}`,
  named: `${ANCHORED}\n\n${COMMON}`,
};
/**
 * What the crop is said to be. `anchored` gives the wide pass's brand as well as its name, and
 * that is measurably the wrong thing to hand it: the wide pass stamps one brand across a whole
 * photograph, so eighteen of seventy-one crops were asked about "Barilla walnuts" or "Campbell's
 * chips", found no such thing, and correctly answered with nothing. `named` gives the name alone,
 * which is the field the wide pass gets right.
 */
const userText = (arm: string, item: Item): string => {
  if (arm === 'neutral') return 'Report one entry per package.';
  const said = arm === 'named' ? item.name : [item.brand, item.name].filter((s) => s !== null && s !== '').join(' ');
  return `The product is: ${said}. Report one entry per package of it.`;
};

const model = process.env.KART_VERIFY_MODEL?.trim() || MODELS.photo;
const client = new OpenAI({
  apiKey: process.env.KART_QWEN_KEY,
  baseURL: process.env.KART_OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
});
const provider = model.includes('/')
  ? { provider: { order: [process.env.KART_OPENROUTER_PROVIDER?.trim() || 'Parasail'], allow_fallbacks: false } }
  : {};

let inputTokens = 0;
let outputTokens = 0;
let calls = 0;
interface Unit { label: string; x: number; y: number }

/**
 * A finished run of this harness, read back so the verdicts can be rebuilt under another policy
 * without asking the model again. Every policy question below (act on a count, act only on a
 * split into varieties) is settled by the points already paid for.
 */
const savedUnits: Map<string, Unit[]> = new Map();
for (const path of from.split(',').map((f) => f.trim()).filter((f) => f.length > 0)) {
  const earlier = JSON.parse(readFileSync(path, 'utf8')) as { probes: { id: string; pass: number; index: number; units: Record<string, Unit[]> }[] };
  for (const p of earlier.probes) {
    for (const [arm, units] of Object.entries(p.units)) savedUnits.set(`${arm}:${p.id}:${p.pass}:${p.index}`, units);
  }
}
async function askUnits(arm: string, item: Item, crop: string): Promise<Unit[]> {
  const response = (await client.responses.create({
    model,
    reasoning: { effort: 'none' },
    max_output_tokens: 400,
    input: [
      { role: 'system', content: SYSTEM[arm] },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: userText(arm, item) },
          { type: 'input_image', image_url: `data:image/jpeg;base64,${crop}`, detail: 'high' },
        ],
      },
    ],
    text: { format: { type: 'json_schema', name: 'units', strict: true, schema: unitsJsonSchema } },
    ...provider,
  } as never)) as unknown as { output_text: string; usage?: { input_tokens?: number; output_tokens?: number } };
  inputTokens += response.usage?.input_tokens ?? 0;
  outputTokens += response.usage?.output_tokens ?? 0;
  calls += 1;
  return (JSON.parse(response.output_text) as { units: Unit[] }).units;
}

/**
 * Labels folded the way the scorer folds names, so two wordings of one package group together and
 * two varieties of one range do not. One label's words being all of another's is one product
 * written twice ("rigatoni authentic italian" inside "priano rigatoni authentic italian"); two
 * varieties each keep a word the other lacks ("sea salt", "rosemary sourdough").
 */
function groupUnits(units: Unit[]): { label: string; count: number }[] {
  const groups: { label: string; tokens: Set<string>; count: number }[] = [];
  for (const unit of units) {
    const tokens = new Set(norm(unit.label).split(' ').filter((t) => t.length > 2));
    const into = groups.find((g) => {
      const [small, big] = g.tokens.size <= tokens.size ? [g.tokens, tokens] : [tokens, g.tokens];
      return small.size > 0 && [...small].every((t) => big.has(t));
    });
    if (into === undefined) groups.push({ label: unit.label, tokens, count: 1 });
    else {
      into.count += 1;
      if (tokens.size > into.tokens.size) {
        into.label = unit.label;
        into.tokens = tokens;
      }
    }
  }
  return groups.map((g) => ({ label: g.label, count: g.count }));
}

interface Probe {
  run: string;
  id: string;
  pass: number;
  index: number;
  wide: { name: string; brand: string | null; qty: number };
  /** What the saved run's close read counted on this same crop: the arm this is measured against. */
  savedCount: number | null;
  savedSure: boolean;
  units: Record<string, Unit[]>;
  error?: string;
}

const probes: Probe[] = [];
/** Per arm and certainty policy, per run file, the rows with the stage applied. */
const rebuilt = new Map<string, Map<string, Row[]>>();
const bucket = (arm: string, policy: 'sure' | 'unsure'): string =>
  `${arm}${gateCount ? '-gated' : ''}${varietyOnly ? '-variety' : ''}${confirmCounts ? '-confirmed' : ''}-${policy}`;
for (const arm of arms) for (const policy of ['sure', 'unsure'] as const) rebuilt.set(bucket(arm, policy), new Map());

for (const file of files.length > 0 ? files : [join(import.meta.dirname, '../clut-photos-salvage.json')]) {
  const run = JSON.parse(readFileSync(file, 'utf8')) as { rows: Row[] };
  const rows = new Map<string, Row[]>();
  for (const key of rebuilt.keys()) rows.set(key, []);

  for (const row of run.rows) {
    const replay =
      (wantedPass === 0 || row.pass === wantedPass) &&
      known.has(row.id) &&
      (only === '' || only.split(',').map((s) => s.trim()).includes(row.id));
    const items = row.items ?? [];
    const lines = row.lines ?? [];
    const photo = join(IMAGES, `${row.id}.jpg`);
    if (!replay || items.length === 0 || !existsSync(photo)) {
      for (const key of rebuilt.keys()) rows.get(key)!.push(row);
      continue;
    }

    const { width, height } = orientedSize(await sharp(photo).metadata());
    const crops = await prepareCrops({ uri: photo, width, height }, items.map((i) => i.box), { manipulator: sharpManipulator });
    /** Per arm, per line index, the lines that replace it. */
    const replacement = new Map<string, Map<number, (ScoreLine & { sure?: boolean; confirmed?: boolean })[]>>();
    for (const arm of arms) replacement.set(arm, new Map());

    for (const [index, item] of items.entries()) {
      const shipped = crops[index];
      if (shipped === null || shipped === undefined) continue;
      const small = await sharp(Buffer.from(shipped, 'base64'))
        .resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
      if (writeCrops) writeFileSync(join(CROPS, `${row.id}-p${row.pass}-${index}.jpg`), small);

      const saved = row.verify?.items?.find((v) => v.id === `p${index}`);
      const probe: Probe = {
        run: basename(file),
        id: row.id,
        pass: row.pass,
        index,
        wide: { name: item.name, brand: item.brand, qty: item.qty },
        savedCount: typeof saved?.close?.count === 'number' ? saved.close.count : null,
        savedSure: saved?.line?.sure === true,
        units: {},
      };
      if (gateCount && (probe.savedCount ?? 0) <= 1) {
        for (const arm of arms) probe.units[arm] = [];
        probes.push(probe);
        continue;
      }
      for (const arm of arms) {
        const earlier = savedUnits.get(`${arm}:${row.id}:${row.pass}:${index}`);
        if (earlier !== undefined) {
          probe.units[arm] = earlier;
          continue;
        }
        try {
          probe.units[arm] = await askUnits(arm, item, small.toString('base64'));
        } catch (err) {
          probe.units[arm] = [];
          probe.error = err instanceof Error ? err.message : String(err);
        }
      }
      probes.push(probe);

      const line = lines[index];
      for (const arm of arms) {
        const groups = groupUnits(probe.units[arm] ?? []);
        if (line === undefined || groups.length === 0) continue;
        if (groups.length === 1) {
          if (confirmCounts && groups[0].count === line.qty && probe.savedSure) {
            replacement.get(arm)!.set(index, [{ ...line, sure: true, confirmed: true }]);
            continue;
          }
          // `--variety-only` acts on a crop holding two different things and never on a count. The
          // count is what the close read already answers, and on the fifteen photographs the
          // second question is worse at it: it read one carton of eggs as three and one bag of
          // quinoa as two. What it is better at is telling one variety of a range from another,
          // which is the question no reading of the whole crop answers.
          if (!varietyOnly && groups[0].count !== line.qty) replacement.get(arm)!.set(index, [{ ...line, qty: groups[0].count }]);
          continue;
        }
        replacement.get(arm)!.set(
          index,
          groups.map((g) => ({ ...line, name: g.label, qty: g.count })),
        );
      }

      const shown = arms.map((arm) => {
        const groups = groupUnits(probe.units[arm] ?? []);
        const detail = groups.length > 1 ? ` [${groups.map((g) => `${g.count}x ${g.label}`).join(' | ')}]` : '';
        return `${arm} ${(probe.units[arm] ?? []).length}${detail}`;
      });
      console.log(`  ${row.id} p${row.pass} #${index} ${item.name}: wide ${item.qty}, close ${probe.savedCount ?? '-'}, ${shown.join(', ')}${probe.error ? ` FAILED ${probe.error}` : ''}`);
    }

    for (const arm of arms) {
      for (const policy of ['sure', 'unsure'] as const) {
        rows.get(bucket(arm, policy))!.push({
          ...row,
          lines: lines.flatMap((line, index) => {
            const next = replacement.get(arm)!.get(index);
            if (next === undefined) return [line];
            return next.map(({ confirmed, ...l }) => ({
              ...l,
              sure: confirmed === true ? true : policy === 'sure' ? line.sure : false,
            }));
          }),
        });
      }
    }
  }
  for (const [key, list] of rows) rebuilt.get(key)!.set(file, list);
}

for (const [key, perFile] of rebuilt) {
  mkdirSync(join(outDir, key), { recursive: true });
  for (const [file, rows] of perFile) {
    const run = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    writeFileSync(join(outDir, key, basename(file)), `${JSON.stringify({ ...run, rows }, null, 1)}\n`);
  }
}

const summary = Object.fromEntries(
  arms.map((arm) => {
    const seen = probes.filter((p) => p.units[arm] !== undefined);
    const groups = (p: Probe) => groupUnits(p.units[arm] ?? []);
    return [
      arm,
      {
        crops: seen.length,
        split: seen.filter((p) => (p.units[arm] ?? []).length > 1).length,
        splitIntoVarieties: seen.filter((p) => groups(p).length > 1).length,
        countsDiffering: seen.filter((p) => p.savedCount !== null && (p.units[arm] ?? []).length !== p.savedCount).length,
        emptied: seen.filter((p) => (p.units[arm] ?? []).length === 0).length,
      },
    ];
  }),
);
const price = PRICES_PER_MTOK[model];
const cost = price ? (inputTokens * price.input + outputTokens * price.output) / 1e6 : null;

writeFileSync(
  out,
  `${JSON.stringify({ ranAt: new Date().toISOString(), model, pass: wantedPass, longEdge, arms, runs: files, summary, calls, cost: cost === null ? null : Number(cost.toFixed(4)), probes }, null, 1)}\n`,
);

console.log(`\n  ${probes.length} crops`);
for (const arm of arms) {
  const s = summary[arm] as Record<string, number>;
  console.log(`  ${arm}: ${s.split} crops hold more than one package, ${s.splitIntoVarieties} of them more than one variety, ${s.countsDiffering} counts differ from the close read, ${s.emptied} came back empty`);
}
if (cost !== null) console.log(`  ${calls} calls, $${cost.toFixed(4)} (${inputTokens} input, ${outputTokens} output tokens)`);
console.log(`  written to ${out} and ${outDir}/<arm>-{sure,unsure}`);
