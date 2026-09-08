import { describe, expect, it, vi, beforeEach } from "vitest";
import sharp from "sharp";

// Same reason as recognize.test.ts: the real ./openai.ts wants a key to build a client, which
// tests never set. One double serves every tier, since routing is client-routing.test.ts's job.
// MODELS is mutable so a case can put an OpenRouter model in the photo tier.
const { create, models } = vi.hoisted(() => ({
  create: vi.fn(),
  models: { census: "gpt-5.4-mini", identify: "gpt-5.4", photo: "gpt-5.6-sol", escalate: "gpt-5.5" },
}));
vi.mock("../src/openai.js", () => ({
  clientFor: () => ({ responses: { create } }),
  MODELS: models,
}));

async function blankJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 200, height: 150, channels: 3, background: { r: 180, g: 180, b: 180 } } })
    .jpeg()
    .toBuffer();
}

const photoAnswer = {
  subjectKind: "product",
  items: [{ name: "oat milk", brand: "Friendly Farms", count: 1, confidence: 0.9, isProduct: true, box: null }],
  occlusion: { severity: "none", reason: "" },
};

/** Re-imports recognize.ts so its module-level env reads happen again under `env`. */
async function runCensusWith(env: Record<string, string | undefined>, model = "gpt-5.6-sol") {
  const before = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  models.photo = model;
  vi.resetModules();
  const { runCensus } = await import("../src/recognize.js");
  create.mockResolvedValueOnce({ output_text: JSON.stringify(photoAnswer) });
  await runCensus(await blankJpeg(), []);
  process.env = before;
  return create.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

const QWEN = "qwen/qwen3-vl-235b-a22b-instruct";

describe("the OpenRouter provider pin", () => {
  beforeEach(() => create.mockReset());

  it("is absent on an OpenAI model, which has no such field and rejects unknown ones", async () => {
    const params = await runCensusWith({ KART_OPENROUTER_PROVIDER: undefined }, "gpt-5.6-sol");
    expect(params).not.toHaveProperty("provider");
  });

  it("defaults to a provider that answers, because an unpinned one silently empties the cart", async () => {
    const params = await runCensusWith({ KART_OPENROUTER_PROVIDER: undefined }, QWEN);
    expect(params.provider).toEqual({ order: ["Parasail"], allow_fallbacks: false });
  });

  it("pins the named provider with fallbacks off, so a run is reproducible", async () => {
    const params = await runCensusWith({ KART_OPENROUTER_PROVIDER: "DeepInfra" }, QWEN);
    expect(params.provider).toEqual({ order: ["DeepInfra"], allow_fallbacks: false });
  });

  it("ignores a whitespace-only override rather than pinning a provider named nothing", async () => {
    const params = await runCensusWith({ KART_OPENROUTER_PROVIDER: "   " }, QWEN);
    expect(params.provider).toEqual({ order: ["Parasail"], allow_fallbacks: false });
  });
});
