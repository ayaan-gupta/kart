import { describe, expect, it, vi } from "vitest";

/**
 * `OPENAI_BASE_URL` is read when the OpenAI client is built, which is on first use rather than at
 * import, so each case needs a fresh module registry and then has to ask for a client.
 *
 * Which client a model reaches is `client-routing.test.ts`; this is only whether the value is
 * validated. A typo here used to surface as a connection error several layers down, reading like
 * the network being off, with `redactSecrets` between the reader and the detail.
 */
async function baseUrlFor(value: string | undefined) {
  const before = { ...process.env };
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  if (value === undefined) delete process.env.OPENAI_BASE_URL;
  else process.env.OPENAI_BASE_URL = value;
  vi.resetModules();
  try {
    const { clientFor } = await import("../src/openai");
    return clientFor("gpt-5.6-luna").baseURL;
  } finally {
    process.env = before;
  }
}

describe("OPENAI_BASE_URL points the OpenAI tiers at a compatible endpoint", () => {
  it("leaves OpenAI's own endpoint in place when unset", async () => {
    expect(await baseUrlFor(undefined)).toContain("openai.com");
  });

  it("is ignored when set to whitespace, rather than becoming an empty base URL", async () => {
    expect(await baseUrlFor("   ")).toContain("openai.com");
  });

  it("uses a valid override", async () => {
    expect(await baseUrlFor("https://example.test/v1")).toBe("https://example.test/v1");
  });

  it("names the variable when the value is not a URL, instead of failing on the first request", async () => {
    await expect(baseUrlFor("not a url")).rejects.toThrow(/OPENAI_BASE_URL is not a valid URL/);
  });
});
