import { describe, expect, it, vi, beforeEach } from "vitest";
import sharp from "sharp";

// Same reason as recognize.test.ts: the real ./openai.ts throws at import when OPENAI_API_KEY is
// unset, which tests never set.
vi.mock("../src/openai.js", () => ({
  openai: { responses: { create: vi.fn() } },
  MODELS: { census: "gpt-5.4-mini", identify: "gpt-5.4", photo: "gpt-5.6-sol", escalate: "gpt-5.5" },
}));

const { openai } = await import("../src/openai.js");
const create = openai.responses.create as unknown as ReturnType<typeof vi.fn>;

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
async function runCensusWith(env: Record<string, string | undefined>) {
  const before = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  const { runCensus } = await import("../src/recognize.js");
  create.mockResolvedValueOnce({ output_text: JSON.stringify(photoAnswer) });
  await runCensus(await blankJpeg(), []);
  process.env = before;
  return create.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

describe("KART_OPENROUTER_PROVIDER", () => {
  beforeEach(() => create.mockReset());

  it("sends no provider field when unset, so the shipped OpenAI call is unchanged", async () => {
    const params = await runCensusWith({ KART_OPENROUTER_PROVIDER: undefined });
    expect(params).not.toHaveProperty("provider");
  });

  it("pins the named provider with fallbacks off, so a run is reproducible", async () => {
    const params = await runCensusWith({ KART_OPENROUTER_PROVIDER: "Alibaba" });
    expect(params.provider).toEqual({ order: ["Alibaba"], allow_fallbacks: false });
  });

  it("ignores whitespace-only values rather than pinning a provider named nothing", async () => {
    const params = await runCensusWith({ KART_OPENROUTER_PROVIDER: "   " });
    expect(params).not.toHaveProperty("provider");
  });
});
