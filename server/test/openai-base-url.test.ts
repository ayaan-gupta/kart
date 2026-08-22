import { describe, expect, it, vi } from "vitest";

/**
 * `OPENAI_BASE_URL` is read at module load, so each case needs a fresh module registry rather than
 * a re-import of the cached one.
 */
async function loadWith(value: string | undefined) {
  const before = process.env.OPENAI_BASE_URL;
  const beforeKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  if (value === undefined) delete process.env.OPENAI_BASE_URL;
  else process.env.OPENAI_BASE_URL = value;
  vi.resetModules();
  try {
    return await import("../src/openai");
  } finally {
    if (before === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = before;
    if (beforeKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = beforeKey;
  }
}

describe("OPENAI_BASE_URL points the client at an OpenAI-compatible endpoint", () => {
  it("leaves the SDK's own default in place when unset", async () => {
    const mod = await loadWith(undefined);
    expect(mod.openai.baseURL).toContain("openai.com");
  });

  it("is ignored when set to whitespace, rather than becoming an empty base URL", async () => {
    const mod = await loadWith("   ");
    expect(mod.openai.baseURL).toContain("openai.com");
  });

  it("uses a valid override", async () => {
    const mod = await loadWith("https://example.test/v1");
    expect(mod.openai.baseURL).toBe("https://example.test/v1");
  });

  it("names the variable when the value is not a URL, instead of failing on the first request", async () => {
    // Without this the typo surfaces as a connection error several layers down, which reads like
    // the network being off, with redactSecrets between the reader and the detail.
    await expect(loadWith("not a url")).rejects.toThrow(/OPENAI_BASE_URL is not a valid URL/);
  });
});
