/**
 * Why does the wide pass sometimes give every product in a photograph the same rectangle?
 *
 * It is not rare and it is not random. Over the saved clut runs, clut7 does it on every run and
 * both passes, and clut10, clut12 and clut1 have each done it at least once. In the shipped-path
 * run of 2026-09-12 (`clut-photos-units.json`) it cost ten of eighty-two items their crop: five
 * products on each pass of clut7 were all cut from the same rectangle, so the close read saw one
 * picture five times and could confirm none of them.
 *
 * A repeated box is worse than no box. A missing box is honest and the shopper is asked to
 * photograph the item again; a repeated box sends a confident wrong crop to the one stage that
 * exists to catch a wrong reading.
 *
 * The hypothesis this harness tests is that the request is at fault, not the model. The schema
 * asks for the label first and the rectangle last, so by the time the model places a box it has
 * already committed to a name and the box is an afterthought; and it asks for x, y, width and
 * height as percentages, which is not the form Qwen3-VL was trained to ground in (it emits
 * `bbox_2d`, two corners on a 0 to 1000 scale). `photoBox` in schemas.ts already exists because
 * the model keeps answering in corners regardless of what it was asked for.
 *
 * Four arms, the wide pass only, same photographs and same image bytes for each:
 *
 *   percent    what the request said until 2026-09-13: x, y, a width and a height in whole
 *              percentages, last in the item
 *   shipped    what it says now: `bbox_2d`, two corners on a 0 to 1000 scale, last in the item
 *   boxfirst   percentages, moved to the front of the item
 *   native     corners, moved to the front of the item
 *
 * Measured on 2026-09-13, the fifteen photographs, one pass each:
 *
 *                  items   boxed   items sharing a rectangle   photographs with one rectangle
 *     percent          82      72                          10                              2
 *     shipped         109     109                           0                              0
 *
 * The percent row is the two passes of `clut-photos-units.json`, the last saved run of the old
 * request, read back rather than paid for again. The shipped row is this harness.
 *
 * A fifth arm, `perpackage`, asked for one entry per package instead of one per product, to see
 * whether clut4's two identical touching rigatoni bags would come apart when the request stopped
 * telling the model to put one rectangle around both. They did not: one entry, one rectangle
 * across both bags, on clut4 and clut5 alike. It is kept here as a recorded negative and is not
 * in the default arms.
 *
 * The other two arms answered the question of whether the position or the format was at fault.
 * `boxfirst` returns null for every product on every photograph: asked for a rectangle before it
 * has looked at what it is pointing at, the model declines. `native` places them as well as
 * `shipped` does, which is what settled it: the format is the fix and the position is not, so the
 * rectangle stays last, where `salvage.ts` needs it to read an answer the provider cut off.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx \
 *       server/eval/pipeline/box-arms.ts --arms percent,shipped
 *
 *     --only <ids>     comma-separated image ids (default: all fifteen)
 *     --arms <names>   comma-separated arm names (default: percent,shipped)
 *     --repeat <n>     ask each arm n times per photograph (default 1)
 *     --model <id>     default MODELS.photo, the shipped one
 *     --out <path>     result JSON (default server/eval/box-arms.json)
 *     --draw           write the boxes onto the photographs under .cache/box-arms/<arm>/
 *
 * What comes out is one number per arm that decides the change: `repeatedItems`, how many items
 * were handed a rectangle another item in the same photograph already had. Items found and brands
 * read are reported beside it, because an arm that fixes the boxes by finding fewer products has
 * not fixed anything. Naming accuracy itself is not scored here: that needs the labels and the
 * whole corpus, which is `clut-photos.ts`, and this harness exists to choose what is worth paying
 * for a run of that.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type OpenAI from "openai";
import { clientFor, MODELS } from "../../src/openai.js";
import { orientedSize } from "../../src/compositor.js";
import { PHOTO_SYSTEM_PROMPT, censusUserText } from "../../src/prompts.js";
import { photoJsonSchema } from "../../src/schemas.js";
import { PRICES_PER_MTOK } from "../../src/usage.js";

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}
const MODEL = arg("model", MODELS.photo);
const REPEAT = Math.max(1, Number(arg("repeat", "1")));
const OUT = arg("out", join(import.meta.dirname, "../box-arms.json"));
const DRAW = argv.includes("--draw");
const only = arg("only", "");
const armNames = arg("arms", "percent,shipped").split(",").map((s) => s.trim()).filter(Boolean);

const IMAGES = join(import.meta.dirname, "../.cache/clut");
const ids = (only ? only.split(",") : Array.from({ length: 15 }, (_, i) => `clut${i + 1}`)).map((s) => s.trim());

/** The bound the service reads the wide pass at (PHOTO_LONG_EDGE in recognize.ts). */
const LONG_EDGE = 2048;

type Box = { x: number; y: number; w: number; h: number };
type Item = { name: string; brand: string | null; count: number; confidence: number; isProduct: boolean; box: Box | null };

/**
 * Surgery on the shipped prompt rather than a second copy of it, so that a later edit to
 * PHOTO_SYSTEM_PROMPT cannot leave this harness quietly measuring last month's baseline against
 * itself. Every cut asserts it found what it was looking for.
 */
function cut(text: string, marker: string): [string, string] {
  const at = text.indexOf(marker);
  if (at === -1) throw new Error(`box-arms: PHOTO_SYSTEM_PROMPT no longer contains ${JSON.stringify(marker)}`);
  return [text.slice(0, at), text.slice(at)];
}

const ONE_ENTRY_AT = "items has one entry per distinct product";
const COUNT_AT = "  count       how many units";
const CONFIDENCE_AT = "  confidence  your real confidence";
const FIELDS_AT = "  name        a short product name";
const BOX_AT = "  bbox_2d     where it is:";
const AFTER_FIELDS_AT = "\nInclude a product that is partly hidden";

/** The rectangle moved to the front of the item. */
function boxFirstPrompt(boxParagraph: string): string {
  const [head, rest] = cut(PHOTO_SYSTEM_PROMPT, FIELDS_AT);
  const [fields, tail] = cut(rest, BOX_AT);
  const [, afterFields] = cut(tail, AFTER_FIELDS_AT);
  return head + boxParagraph + fields + afterFields;
}

/** The rectangle left where it is, with only its wording replaced. */
function boxLastPrompt(boxParagraph: string): string {
  const [head, rest] = cut(PHOTO_SYSTEM_PROMPT, BOX_AT);
  const [, afterFields] = cut(rest, AFTER_FIELDS_AT);
  return head + boxParagraph + afterFields;
}

/** What the shipped prompt said until 2026-09-13, word for word. */
const PERCENT_BOX = `  box         where it is: the smallest rectangle that encloses every visible unit of this
              product, as x, y, w and h in whole percentages of the image width and height, 0 to
              100, with the origin at the top-left corner. Tight to the product, not to the shelf
              or basket around it. Give a box for every product you list. The box is cut out of
              the photograph and read again close up, and that second reading is the only thing
              that can confirm a product; one with no box cannot be checked, so it is shown to the
              shopper as unsure and they are asked to photograph it again. A roughly right
              rectangle is far better than none. Use null only when the product is so scattered or
              so buried that no rectangle contains it.
`;

/** The shipped corner paragraph, as it reads when it is asked for first. */
const NATIVE_BOX = cut(cut(PHOTO_SYSTEM_PROMPT, BOX_AT)[1], AFTER_FIELDS_AT)[0]
  .replace("where it is:", "where it is, and find it before you name it:");

/** A percentage rectangle, read as corners when that is the only reading that is possible. */
function percentBox(raw: Record<string, number> | null): Box | null {
  if (!raw) return null;
  const x = raw.x / 100, y = raw.y / 100;
  let w = raw.w / 100, h = raw.h / 100;
  if (x + w > 1 && raw.w > raw.x) w = raw.w / 100 - x;
  if (y + h > 1 && raw.h > raw.y) h = raw.h / 100 - y;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

function cornerBox(raw: unknown): Box | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const [a, b, c, d] = raw.map((n) => (typeof n === "number" && Number.isFinite(n) ? n / 1000 : NaN));
  if ([a, b, c, d].some((n) => Number.isNaN(n))) return null;
  const x = Math.max(0, Math.min(a, c)), y = Math.max(0, Math.min(b, d));
  const w = Math.min(1, Math.max(a, c)) - x, h = Math.min(1, Math.max(b, d)) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

type Arm = { name: string; system: string; schema: Record<string, unknown>; read: (raw: Record<string, unknown>) => Item };

const itemFields = (photoJsonSchema.properties.items.items as { properties: Record<string, unknown> }).properties;

/** The item schema with its rectangle replaced, at either end of the object. */
function schemaWith(box: Record<string, unknown>, boxKey: string, first: boolean): Record<string, unknown> {
  const { bbox_2d: _drop, ...rest } = itemFields as Record<string, unknown> & { bbox_2d: unknown };
  const properties = first ? { [boxKey]: box, ...rest } : { ...rest, [boxKey]: box };
  return {
    ...photoJsonSchema,
    properties: {
      ...photoJsonSchema.properties,
      items: {
        type: "array",
        items: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
      },
    },
  };
}

const cornerSchemaBox = (itemFields as Record<string, unknown>).bbox_2d as Record<string, unknown>;
const percentSchemaBox = {
  type: ["object", "null"],
  properties: {
    x: { type: "number", minimum: 0, maximum: 100 },
    y: { type: "number", minimum: 0, maximum: 100 },
    w: { type: "number", minimum: 0, maximum: 100 },
    h: { type: "number", minimum: 0, maximum: 100 },
  },
  required: ["x", "y", "w", "h"],
  additionalProperties: false,
};

const readFields = (raw: Record<string, unknown>): Omit<Item, "box"> => ({
  name: String(raw.name ?? ""),
  brand: typeof raw.brand === "string" ? raw.brand : null,
  count: Number(raw.count ?? 0),
  confidence: Number(raw.confidence ?? 0),
  isProduct: raw.isProduct !== false,
});

/**
 * One entry per package rather than one per product.
 *
 * The shipped request asks for corners per product and then, a paragraph earlier, says the same
 * product in two places is one entry with one rectangle around both. clut4's two identical
 * rigatoni bags are that case: the model draws one rectangle across both, says 1, the close read
 * of that crop agrees, and a wrong count is asserted. It is the defect this corpus has never been
 * able to read, and the only thing measured to read it so far is a ten-times-dearer model.
 */
function perPackagePrompt(): string {
  const swap = (text: string, from: string, to: string): string => {
    if (!text.includes(from)) throw new Error(`box-arms: PHOTO_SYSTEM_PROMPT no longer contains ${JSON.stringify(from.slice(0, 40))}`);
    return text.replace(from, to);
  };
  let text = swap(
    PHOTO_SYSTEM_PROMPT,
    "items has one entry per distinct product; the same product in two places is one\nentry with the total count and one rectangle around both:",
    "items has one entry per package. Two identical bags of one pasta are two\nentries, each with its own rectangle and a count of 1, not one entry counting 2:",
  );
  text = swap(
    text,
    "  count       how many units of it are visible: count packages, not pieces. One bunch of bananas\n              is 1, one carton of eggs is 1, two identical bags of chips is 2.",
    "  count       how many units this one entry covers. With one entry per package it is 1: one\n              bunch of bananas is 1, one carton of eggs is 1, and two identical bags of chips\n              are two entries of 1, not one entry of 2. Say more than 1 only where identical\n              units are stacked or nested so that you cannot put a rectangle around each.",
  );
  return text;
}

const ARMS: Record<string, Arm> = {
  /** What the service sends today: corners, last in the item. */
  shipped: {
    name: "shipped",
    system: PHOTO_SYSTEM_PROMPT,
    schema: photoJsonSchema as unknown as Record<string, unknown>,
    read: (raw) => ({ ...readFields(raw), box: cornerBox(raw.bbox_2d) }),
  },
  /** What it sent until 2026-09-13: a position and a size in percentages, last in the item. */
  percent: {
    name: "percent",
    system: boxLastPrompt(PERCENT_BOX),
    schema: schemaWith(percentSchemaBox, "box", false),
    read: (raw) => ({ ...readFields(raw), box: percentBox((raw.box as Record<string, number> | null) ?? null) }),
  },
  /** Percentages asked for first. The dead arm: it answers null for every product. */
  boxfirst: {
    name: "boxfirst",
    system: boxFirstPrompt(PERCENT_BOX),
    schema: schemaWith(percentSchemaBox, "box", true),
    read: (raw) => ({ ...readFields(raw), box: percentBox((raw.box as Record<string, number> | null) ?? null) }),
  },
  /** One entry per package, so two bags of one pasta are two lines the close read can separate. */
  perpackage: {
    name: "perpackage",
    system: perPackagePrompt(),
    schema: photoJsonSchema as unknown as Record<string, unknown>,
    read: (raw) => ({ ...readFields(raw), box: cornerBox(raw.bbox_2d) }),
  },
  /** Corners asked for first. Places them as well as `shipped` and breaks `salvage.ts`. */
  native: {
    name: "native",
    system: boxFirstPrompt(NATIVE_BOX),
    schema: schemaWith(cornerSchemaBox, "bbox_2d", true),
    read: (raw) => ({ ...readFields(raw), box: cornerBox(raw.bbox_2d) }),
  },
};

for (const name of armNames) if (!ARMS[name]) throw new Error(`box-arms: no arm called ${name}`);

let inputTokens = 0;
let outputTokens = 0;

async function ask(arm: Arm, jpeg: Buffer): Promise<{ items: Item[]; seconds: number; subjectKind: string }> {
  const params = {
    model: MODEL,
    input: [
      { role: "system", content: arm.system },
      {
        role: "user",
        content: [
          { type: "input_text", text: censusUserText([]) },
          { type: "input_image", image_url: `data:image/jpeg;base64,${jpeg.toString("base64")}`, detail: "high" },
        ],
      },
    ],
    text: { format: { type: "json_schema", name: "photo_census", strict: true, schema: arm.schema } },
    max_output_tokens: 4000,
  } as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming;
  // The same pin the service uses (OPENROUTER_PROVIDER in recognize.ts). An unpinned call is
  // answered by whichever upstream is free, which puts two configurations in one arm's numbers.
  const sent = String(MODEL).includes("/")
    ? ({ ...params, provider: { order: [process.env.KART_OPENROUTER_PROVIDER?.trim() || "Parasail"], allow_fallbacks: false } } as typeof params)
    : params;
  const t0 = Date.now();
  const response = await clientFor(MODEL).responses.create(sent);
  const seconds = (Date.now() - t0) / 1000;
  inputTokens += response.usage?.input_tokens ?? 0;
  outputTokens += response.usage?.output_tokens ?? 0;
  const parsed = JSON.parse(response.output_text) as { items?: unknown[]; subjectKind?: string };
  const items = (parsed.items ?? []).map((raw) => arm.read(raw as Record<string, unknown>)).filter((i) => i.isProduct);
  return { items, seconds, subjectKind: String(parsed.subjectKind ?? "") };
}

const key = (b: Box): string => [b.x, b.y, b.w, b.h].map((n) => n.toFixed(4)).join(",");

type Row = {
  id: string;
  arm: string;
  pass: number;
  seconds: number;
  subjectKind: string;
  items: number;
  boxed: number;
  distinctBoxes: number;
  repeatedItems: number;
  allOneBox: boolean;
  brands: number;
  names: string[];
  boxes: (Box | null)[];
};
const rows: Row[] = [];

for (const id of ids) {
  const file = join(IMAGES, `${id}.jpg`);
  if (!existsSync(file)) { console.log(`${id}: absent`); continue; }
  const original = readFileSync(file);
  const upload = await sharp(original)
    .rotate()
    .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  const { width: W, height: H } = orientedSize(await sharp(upload).metadata());

  for (let pass = 1; pass <= REPEAT; pass++) {
    for (const name of armNames) {
      const arm = ARMS[name]!;
      let answer: { items: Item[]; seconds: number; subjectKind: string };
      try {
        answer = await ask(arm, upload);
      } catch (err) {
        console.log(`  ${id} ${name} p${pass}: ${(err as Error).message.slice(0, 120)}`);
        continue;
      }
      const boxed = answer.items.filter((i) => i.box);
      const keys = boxed.map((i) => key(i.box!));
      const distinct = new Set(keys);
      const repeatedItems = keys.length - distinct.size;
      const row: Row = {
        id,
        arm: name,
        pass,
        seconds: answer.seconds,
        subjectKind: answer.subjectKind,
        items: answer.items.length,
        boxed: boxed.length,
        distinctBoxes: distinct.size,
        repeatedItems,
        allOneBox: boxed.length > 1 && distinct.size === 1,
        brands: answer.items.filter((i) => i.brand).length,
        names: answer.items.map((i) => i.name),
        boxes: answer.items.map((i) => i.box),
      };
      rows.push(row);
      console.log(
        `${id} p${pass} ${name.padEnd(9)} ${String(row.items).padStart(2)} items, ${String(row.boxed).padStart(2)} boxed, ` +
          `${String(row.distinctBoxes).padStart(2)} distinct, repeated ${row.repeatedItems}${row.allOneBox ? " (ALL ONE BOX)" : ""}, ` +
          `${row.seconds.toFixed(1)}s`,
      );

      if (DRAW) {
        const dir = join(import.meta.dirname, "../.cache/box-arms", name);
        mkdirSync(dir, { recursive: true });
        const rects = answer.items
          .map((u, i) => {
            if (!u.box) return "";
            const x = u.box.x * W, y = u.box.y * H, w = u.box.w * W, h = u.box.h * H;
            const label = `${i + 1} ${u.name}`.replace(/[<>&]/g, "");
            return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#34C759" stroke-width="6"/>` +
              `<text x="${x + 10}" y="${Math.max(24, y - 10)}" font-size="34" font-family="Helvetica" fill="#34C759" stroke="#000" stroke-width="1">${label}</text>`;
          })
          .join("");
        const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${rects}</svg>`);
        const drawn = await sharp(upload).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
        await sharp(drawn).resize({ width: 1400 }).jpeg({ quality: 80 }).toFile(join(dir, `${id}-p${pass}.jpg`));
      }
    }
  }
}

const summary = armNames.map((name) => {
  const mine = rows.filter((r) => r.arm === name);
  const sum = (pick: (r: Row) => number): number => mine.reduce((t, r) => t + pick(r), 0);
  return {
    arm: name,
    photographs: mine.length,
    items: sum((r) => r.items),
    boxed: sum((r) => r.boxed),
    repeatedItems: sum((r) => r.repeatedItems),
    allOneBoxRows: mine.filter((r) => r.allOneBox).length,
    brands: sum((r) => r.brands),
    secondsAvg: mine.length === 0 ? 0 : Number((sum((r) => r.seconds) / mine.length).toFixed(2)),
  };
});

const price = PRICES_PER_MTOK[MODEL];
const usd = price ? (inputTokens * price.input + outputTokens * price.output) / 1e6 : null;

console.log("\narm        photos  items  boxed  repeated  allOneBox  brands  seconds");
for (const s of summary) {
  console.log(
    `${s.arm.padEnd(10)} ${String(s.photographs).padStart(6)} ${String(s.items).padStart(6)} ${String(s.boxed).padStart(6)} ` +
      `${String(s.repeatedItems).padStart(9)} ${String(s.allOneBoxRows).padStart(10)} ${String(s.brands).padStart(7)} ${s.secondsAvg.toFixed(1).padStart(8)}`,
  );
}
console.log(`\ntokens in ${inputTokens} out ${outputTokens}${usd === null ? "" : `, about $${usd.toFixed(3)}`}`);

writeFileSync(
  OUT,
  JSON.stringify({ ranAt: new Date().toISOString(), model: MODEL, ids, repeat: REPEAT, summary, rows, tokens: { inputTokens, outputTokens }, usd }, null, 1),
);
console.log(`wrote ${OUT}`);
