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
