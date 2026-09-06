/**
 * Can the photo model place a box on each product, and does a close crop read what the wide pass
 * misread?
 *
 * Two questions that decided the shape of the verification stage (docs/superpowers/specs/
 * 2026-09-06-photo-verification-design.md). The first is answered by looking: every photograph is
 * written back to `.cache/clut/boxes/<id>.jpg` with the boxes drawn, and a person looks at them.
 * The second is answered per item by cutting the box out twice, once from the 2048 upload the
 * phone sends and once from the original file, and asking the same close question of each. On
 * 2026-09-06 the answer was: every item boxed, and the crop of the original reads a label the
 * crop of the upload hallucinates a brand for, which is why the phone cuts from its original.
 *
 *     node --env-file=server/.env.local server/node_modules/.bin/tsx \
 *       server/eval/pipeline/box-probe.ts --only clut4,clut5,clut8,clut11,clut13
 *
 *     --only <ids>     comma-separated image ids (default: all fifteen)
 *     --model <id>     the model for both passes (default gpt-5.6-sol)
 *     --close-model    the model for the close pass only
 *     --no-close       boxes only, no crop calls
 *     --long-edge <n>  the upload bound to simulate (default 2048, the shipped one)
 *     --out <path>     result JSON (default server/eval/box-probe.json)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import OpenAI from "openai";
import { orientedSize } from "../../src/compositor.js";
import { PHOTO_SYSTEM_PROMPT, VERIFY_SYSTEM_PROMPT, censusUserText, verifyUserText } from "../../src/prompts.js";
import { censusFromPhoto, photoJsonSchema, verifyJsonSchema, PhotoResponse, VerifyResponse } from "../../src/schemas.js";
import { PRICES_PER_MTOK } from "../../src/usage.js";

const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}
const MODEL = arg("model", "gpt-5.6-sol");
const CLOSE_MODEL = arg("close-model", MODEL);
const noClose = argv.includes("--no-close");
const only = arg("only", "");
const LONG_EDGE = Number(arg("long-edge", "2048"));

const IMAGES = join(import.meta.dirname, "../.cache/clut");
const OUT_DIR = join(IMAGES, "boxes");
mkdirSync(OUT_DIR, { recursive: true });

const ids = (only ? only.split(",") : Array.from({ length: 15 }, (_, i) => `clut${i + 1}`)).map((s) => s.trim());
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let inputTokens = 0;
let outputTokens = 0;
async function ask(model: string, system: string, text: string, jpeg: Buffer, schema: Record<string, unknown>, name: string): Promise<string> {
  const response = await openai.responses.create({
    model,
    reasoning: { effort: "none" },
    input: [
      { role: "system", content: system },
      { role: "user", content: [
        { type: "input_text", text },
        { type: "input_image", image_url: `data:image/jpeg;base64,${jpeg.toString("base64")}`, detail: "high" },
      ] },
    ],
    text: { format: { type: "json_schema", name, strict: true, schema } },
  });
  inputTokens += response.usage?.input_tokens ?? 0;
  outputTokens += response.usage?.output_tokens ?? 0;
  return response.output_text;
}

type Box = { x: number; y: number; w: number; h: number };
async function crop(image: Buffer, box: Box, padding = 0.15): Promise<Buffer> {
  const base = sharp(image).rotate();
  const meta = orientedSize(await base.metadata());
  const left = Math.max(0, box.x - box.w * padding);
  const top = Math.max(0, box.y - box.h * padding);
  const right = Math.min(1, box.x + box.w * (1 + padding));
  const bottom = Math.min(1, box.y + box.h * (1 + padding));
  const px = {
    left: Math.floor(left * meta.width),
    top: Math.floor(top * meta.height),
    width: Math.max(1, Math.round((right - left) * meta.width)),
    height: Math.max(1, Math.round((bottom - top) * meta.height)),
  };
  px.width = Math.min(px.width, meta.width - px.left);
  px.height = Math.min(px.height, meta.height - px.top);
  return base.extract(px).jpeg({ quality: 90 }).toBuffer();
}

const results: unknown[] = [];
for (const id of ids) {
  const file = join(IMAGES, `${id}.jpg`);
  if (!existsSync(file)) { console.log(`${id}: absent`); continue; }
  const original = readFileSync(file);
  const upload = await sharp(original).rotate().resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  // The wide pass always reads at 2048, the server's PHOTO_LONG_EDGE; a larger upload only
  // changes what the close crops are cut from.
  const wideImage = LONG_EDGE > 2048
    ? await sharp(upload).resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
    : upload;
  const { width: W, height: H } = orientedSize(await sharp(upload).metadata());

  const t0 = Date.now();
  const wideText = await ask(MODEL, PHOTO_SYSTEM_PROMPT, censusUserText([]), wideImage, photoJsonSchema as unknown as Record<string, unknown>, "photo_census");
  const wide = censusFromPhoto(PhotoResponse.parse(JSON.parse(wideText)));
  const wideSeconds = (Date.now() - t0) / 1000;
  const items = wide.unmarkedItems.filter((u) => u.isProduct !== false);
  const counts = new Map(wide.inViewCounts.map((c) => [c.productKey, c.count]));
  console.log(`\n${id}: ${items.length} items in ${wideSeconds.toFixed(1)}s, ${items.filter((u) => u.box).length} with a box`);

  // Draw the boxes.
  const rects = items.map((u, i) => {
    if (!u.box) return "";
    const x = u.box.x * W, y = u.box.y * H, w = u.box.w * W, h = u.box.h * H;
    const label = `${i + 1} ${u.description}`.replace(/[<>&]/g, "");
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#34C759" stroke-width="6"/>` +
      `<rect x="${x}" y="${Math.max(0, y - 44)}" width="${Math.min(W - x, 24 + label.length * 20)}" height="44" fill="#34C759"/>` +
      `<text x="${x + 10}" y="${Math.max(0, y - 44) + 32}" font-size="32" font-family="Helvetica" fill="#000">${label}</text>`;
  }).join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${rects}</svg>`);
  // Two steps: sharp resizes before it composites, so a one-step pipeline lays a full-size
  // overlay on a downsized image and refuses.
  const drawn = await sharp(upload).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
  await sharp(drawn).resize({ width: 1400 }).jpeg({ quality: 80 }).toFile(join(OUT_DIR, `${id}.jpg`));

  const perItem: unknown[] = [];
  for (const [i, u] of items.entries()) {
    const count = counts.get(u.productKey) ?? 1;
    console.log(`  ${i + 1}. ${u.description} [${u.productKey}] x${count} conf ${u.confidence} box ${u.box ? `${u.box.x.toFixed(2)},${u.box.y.toFixed(2)} ${u.box.w.toFixed(2)}x${u.box.h.toFixed(2)}` : "none"}`);
    if (noClose || !u.box) { perItem.push({ wide: u, count }); continue; }
    const hint = { description: u.description, productKey: u.productKey };
    const [fromUpload, fromOriginal] = await Promise.all([crop(upload, u.box), crop(original, u.box)]);
    const t1 = Date.now();
    const [a, b] = await Promise.all([
      ask(CLOSE_MODEL, VERIFY_SYSTEM_PROMPT, verifyUserText(hint), fromUpload, verifyJsonSchema as unknown as Record<string, unknown>, "verify").then((t) => VerifyResponse.parse(JSON.parse(t))),
      ask(CLOSE_MODEL, VERIFY_SYSTEM_PROMPT, verifyUserText(hint), fromOriginal, verifyJsonSchema as unknown as Record<string, unknown>, "verify").then((t) => VerifyResponse.parse(JSON.parse(t))),
    ]);
    const closeSeconds = (Date.now() - t1) / 1000;
    const metaA = await sharp(fromUpload).metadata();
    const metaB = await sharp(fromOriginal).metadata();
    const show = (v: typeof a) => `${v.brand ?? "-"} / ${v.name} x${v.count} conf ${v.confidence} legible=${v.legible} matches=${v.matchesHint}`;
    console.log(`       upload ${metaA.width}x${metaA.height}: ${show(a)}`);
    console.log(`       orig   ${metaB.width}x${metaB.height}: ${show(b)}   (${closeSeconds.toFixed(1)}s)`);
    perItem.push({ wide: u, count, close: { fromUpload: a, fromOriginal: b, uploadPx: [metaA.width, metaA.height], originalPx: [metaB.width, metaB.height] } });
  }
  results.push({ id, wideSeconds, subjectKind: wide.subjectKind, occlusion: wide.occlusion, items: perItem });
}

const price = PRICES_PER_MTOK[MODEL];
const usd = price ? (inputTokens * price.input + outputTokens * price.output) / 1e6 : null;
console.log(`\ntokens in ${inputTokens} out ${outputTokens}${usd === null ? "" : `, about $${usd.toFixed(3)}`}`);
writeFileSync(arg("out", join(import.meta.dirname, "../box-probe.json")), `${JSON.stringify({ ranAt: new Date().toISOString(), model: MODEL, closeModel: CLOSE_MODEL, results }, null, 1)}\n`);
console.log(`boxes drawn into ${OUT_DIR}`);
