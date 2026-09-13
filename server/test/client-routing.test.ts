import { describe, expect, it, vi } from "vitest";

/**
 * The recognition tiers no longer all live at one provider, so the client is chosen per model.
 * `openai.ts` reads its keys at import, so each case sets an environment and re-imports.
 */
async function clientForWith(model: string, env: Record<string, string | undefined>) {
  const before = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  try {
    const { clientFor } = await import("../src/openai.js");
    return clientFor(model);
  } finally {
    process.env = before;
  }
}

const KEYS = { OPENAI_API_KEY: "sk-openai-test", KART_QWEN_KEY: "sk-or-test" };

describe("clientFor", () => {
  it("sends a bare model name to OpenAI on the OpenAI key", async () => {
    const client = await clientForWith("gpt-5.6-luna", { ...KEYS, OPENAI_BASE_URL: undefined });
    expect(client.baseURL).toBe("https://api.openai.com/v1");
    expect(client.apiKey).toBe("sk-openai-test");
  });

  it("sends a vendor-qualified model to OpenRouter on the OpenRouter key", async () => {
    const client = await clientForWith("qwen/qwen3-vl-235b-a22b-instruct", {
      ...KEYS,
      OPENAI_BASE_URL: undefined,
    });
    expect(client.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(client.apiKey).toBe("sk-or-test");
  });

  it("names the missing variable rather than failing on the first request", async () => {
    await expect(
      clientForWith("qwen/qwen3-vl-235b-a22b-instruct", {
        OPENAI_API_KEY: "sk-openai-test",
        KART_QWEN_KEY: undefined,
      }),
    ).rejects.toThrow(/KART_QWEN_KEY/);
  });

  it("still lets OPENAI_BASE_URL redirect the OpenAI tiers, which is what it was for", async () => {
    const client = await clientForWith("gpt-5.6-luna", {
      ...KEYS,
      OPENAI_BASE_URL: "https://gateway.example.com/v1",
    });
    expect(client.baseURL).toBe("https://gateway.example.com/v1");
  });
});

/**
 * Which keys a machine actually needs to serve the tiers it is configured with.
 *
 * `npm run serve` used to demand `OPENAI_API_KEY` whatever the tiers were set to, which was
 * right while every tier was OpenAI's and wrong from 2026-09-07, when the photograph tier moved
 * to Qwen. From 2026-09-13 no tier is OpenAI's and the check asked for a key nothing would have
 * used, on a machine that could serve every request without it.
 */
describe("missingKeys", () => {
  async function load() {
    vi.resetModules();
    return import("../src/openai.js");
  }

  it("routes a vendor-qualified model to the OpenRouter key and a bare one to OpenAI's", async () => {
    const { keyFor } = await load();
    expect(keyFor("qwen/qwen3-vl-235b-a22b-instruct")).toBe("KART_QWEN_KEY");
    expect(keyFor("gpt-5.6-luna")).toBe("OPENAI_API_KEY");
  });

  it("asks for nothing when every configured tier has its key", async () => {
    const { missingKeys } = await load();
    expect(missingKeys({ KART_QWEN_KEY: "k" }, ["qwen/a", "qwen/b"])).toEqual([]);
  });

  it("names the key a tier needs and no other", async () => {
    const { missingKeys } = await load();
    expect(missingKeys({}, ["qwen/a"])).toEqual(["KART_QWEN_KEY"]);
    expect(missingKeys({ KART_QWEN_KEY: "k" }, ["qwen/a", "gpt-5.6-luna"])).toEqual(["OPENAI_API_KEY"]);
  });

  it("names each key once, however many tiers want it", async () => {
    const { missingKeys } = await load();
    expect(missingKeys({}, ["qwen/a", "qwen/b", "qwen/c"])).toEqual(["KART_QWEN_KEY"]);
  });

  it("treats a blank key as missing, which is what an empty line in .env.local leaves", async () => {
    const { missingKeys } = await load();
    expect(missingKeys({ KART_QWEN_KEY: "   " }, ["qwen/a"])).toEqual(["KART_QWEN_KEY"]);
  });

  /** The regression guard on "every tier is Qwen": one key serves the whole service. */
  it("needs only the OpenRouter key for the tiers this service ships with", async () => {
    const { missingKeys } = await load();
    expect(missingKeys({ KART_QWEN_KEY: "k" })).toEqual([]);
    expect(missingKeys({})).toEqual(["KART_QWEN_KEY"]);
  });
});
