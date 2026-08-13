import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  assertJsonContentType,
  assertJsonObject,
  assertReasonableContentLength,
  assertReasonablePixelDimensions,
  decodeBase64Image,
  fail,
  json,
  REQUEST_TIMEOUT_MS,
  withTimeout,
} from "../src/http.js";

async function tinyJpegBase64(): Promise<string> {
  const buf = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 100, g: 100, b: 100 } },
  })
    .jpeg()
    .toBuffer();
  return buf.toString("base64");
}

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("json", () => {
  it("serializes the body and sets the status and content-type", async () => {
    const res = json({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("defaults to status 200", () => {
    expect(json({}).status).toBe(200);
  });
});

describe("fail", () => {
  it("returns exactly {error:\"Bad request\"} for a 400, regardless of the thrown error", async () => {
    const res = fail(new Error("some internal detail"), 400);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Bad request" });
  });

  it("returns exactly {error:\"Recognition failed\"} for the default status", async () => {
    const res = fail(new Error("boom"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Recognition failed" });
  });

  it("never lets the thrown error's message reach the response body, even if it looks like a secret", async () => {
    const secretLike = "sk-proj-totally-real-looking-key-abcdefghijklmnop";
    const res = fail(new Error(`OpenAI request failed: ${secretLike}`), 500);
    const text = await res.text();
    expect(text).not.toContain(secretLike);
    expect(text).not.toContain("sk-");
  });

  it("treats every non-400 status the same way (generic message), including 502/503-style values", async () => {
    const res = fail(new Error("whatever"), 503);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Recognition failed" });
  });
});

describe("decodeBase64Image", () => {
  it("decodes a well-formed base64 JPEG", async () => {
    const b64 = await tinyJpegBase64();
    const buf = decodeBase64Image(b64, "image");
    expect(buf.length).toBeGreaterThan(0);
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
  });

  it("strips a data: URI prefix before decoding", async () => {
    const b64 = await tinyJpegBase64();
    const buf = decodeBase64Image(`data:image/jpeg;base64,${b64}`, "image");
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
  });

  it("rejects a non-string value", () => {
    expect(() => decodeBase64Image(12345, "image")).toThrow();
    expect(() => decodeBase64Image(null, "image")).toThrow();
    expect(() => decodeBase64Image(undefined, "image")).toThrow();
    expect(() => decodeBase64Image({}, "image")).toThrow();
    expect(() => decodeBase64Image(["a"], "image")).toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => decodeBase64Image("", "image")).toThrow();
  });

  it("rejects a string that decodes to zero bytes", () => {
    // None of these are valid base64 alphabet characters, so Buffer.from silently decodes to
    // an empty buffer rather than throwing.
    expect(() => decodeBase64Image("!!!!", "image")).toThrow();
  });

  it("rejects a base64 string too long to possibly decode within the size budget, without decoding it", () => {
    // 17_000_000 chars comfortably clears the ~16.78M char threshold derived from the 12MB
    // decoded ceiling; this must be rejected on length alone, cheaply, before any decode work.
    const huge = "A".repeat(17_000_000);
    expect(() => decodeBase64Image(huge, "image")).toThrow();
  });

  it("rejects a decoded image over the 12MB ceiling", () => {
    // A buffer starting with valid JPEG magic bytes but padded well past the ceiling.
    const big = Buffer.alloc(13 * 1024 * 1024, 0);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;
    const b64 = big.toString("base64");
    expect(() => decodeBase64Image(b64, "image")).toThrow();
  });

  it("rejects decoded bytes that do not look like any supported image format", () => {
    const notAnImage = Buffer.from(
      "this is plain text padded out so it is at least twelve bytes long",
      "utf8",
    );
    const b64 = notAnImage.toString("base64");
    expect(() => decodeBase64Image(b64, "image")).toThrow();
  });

  it("accepts a PNG signature", () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
    ]);
    expect(() => decodeBase64Image(png.toString("base64"), "image")).not.toThrow();
  });

  it("accepts a WEBP signature", () => {
    const webp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("WEBP", "ascii"),
    ]);
    expect(() => decodeBase64Image(webp.toString("base64"), "image")).not.toThrow();
  });
});

describe("assertReasonableContentLength", () => {
  it("does not throw when the header is absent", () => {
    expect(() => assertReasonableContentLength(new Request("http://x", { headers: headers({}) }))).not.toThrow();
  });

  it("does not throw for a small, honest content-length", () => {
    const req = new Request("http://x", { headers: headers({ "content-length": "1024" }) });
    expect(() => assertReasonableContentLength(req)).not.toThrow();
  });

  it("throws when the declared length exceeds the ceiling", () => {
    const req = new Request("http://x", {
      headers: headers({ "content-length": String(30 * 1024 * 1024) }),
    });
    expect(() => assertReasonableContentLength(req)).toThrow();
  });

  it("throws when the header is not a sane number", () => {
    const req = new Request("http://x", { headers: headers({ "content-length": "not-a-number" }) });
    expect(() => assertReasonableContentLength(req)).toThrow();
  });

  it("throws when the header is negative", () => {
    const req = new Request("http://x", { headers: headers({ "content-length": "-5" }) });
    expect(() => assertReasonableContentLength(req)).toThrow();
  });
});

describe("assertJsonContentType", () => {
  it("accepts application/json", () => {
    const req = new Request("http://x", { headers: headers({ "content-type": "application/json" }) });
    expect(() => assertJsonContentType(req)).not.toThrow();
  });

  it("accepts application/json with a charset parameter", () => {
    const req = new Request("http://x", {
      headers: headers({ "content-type": "application/json; charset=utf-8" }),
    });
    expect(() => assertJsonContentType(req)).not.toThrow();
  });

  it("is case-insensitive", () => {
    const req = new Request("http://x", { headers: headers({ "content-type": "Application/JSON" }) });
    expect(() => assertJsonContentType(req)).not.toThrow();
  });

  it("throws when the header is missing", () => {
    const req = new Request("http://x", { headers: headers({}) });
    expect(() => assertJsonContentType(req)).toThrow();
  });

  it("throws for a different media type", () => {
    const req = new Request("http://x", { headers: headers({ "content-type": "text/plain" }) });
    expect(() => assertJsonContentType(req)).toThrow();
  });
});

describe("assertJsonObject", () => {
  it("does not throw for a plain object", () => {
    expect(() => assertJsonObject({ a: 1 })).not.toThrow();
    expect(() => assertJsonObject({})).not.toThrow();
  });

  it("throws for null", () => {
    expect(() => assertJsonObject(null)).toThrow();
  });

  it("throws for an array", () => {
    expect(() => assertJsonObject([1, 2, 3])).toThrow();
  });

  it("throws for a string, number, or boolean", () => {
    expect(() => assertJsonObject("hello")).toThrow();
    expect(() => assertJsonObject(42)).toThrow();
    expect(() => assertJsonObject(true)).toThrow();
  });
});

describe("assertReasonablePixelDimensions", () => {
  it("does not throw for a realistic small image", async () => {
    const buf = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 100, g: 100, b: 100 } },
    })
      .jpeg()
      .toBuffer();
    await expect(assertReasonablePixelDimensions(buf)).resolves.toBeUndefined();
  });

  it("does not throw at a realistic modern phone camera resolution (48MP, 8064x6048)", async () => {
    const buf = await sharp({
      create: { width: 8064, height: 6048, channels: 3, background: { r: 90, g: 90, b: 90 } },
    })
      .jpeg({ quality: 60 })
      .toBuffer();
    await expect(assertReasonablePixelDimensions(buf)).resolves.toBeUndefined();
  });

  it("throws for a small-byte-size image whose decoded pixel count exceeds the ceiling", async () => {
    // 9000 x 7000 = 63,000,000 pixels, over the 60,000,000 ceiling, compressed to a tiny file:
    // exactly the shape of the reviewer's crafted decompression-bomb attack image.
    const buf = await sharp({
      create: { width: 9000, height: 7000, channels: 3, background: { r: 120, g: 120, b: 120 } },
    })
      .jpeg({ quality: 60 })
      .toBuffer();
    expect(buf.length).toBeLessThan(1 * 1024 * 1024);
    await expect(assertReasonablePixelDimensions(buf)).rejects.toThrow();
  });

  it(
    "throws a generic message, never a raw libvips decode error, for bytes with a valid JPEG signature but corrupt body",
    async () => {
      // Passes decodeBase64Image's magic-byte sniff (starts with FF D8 FF) but is not a real,
      // fully decodable JPEG, so sharp's own metadata parsing fails internally. The point of
      // this test is that whatever libvips says about why stays inside the catch block: the
      // thrown Error's message must not be sharp/libvips's own text, since that internal detail
      // has never been reviewed for being safe to expose and fail() logs it, never echoes it,
      // but this function is a second, independent line of defence for the same property.
      const corrupt = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.from("not actually a valid jpeg body, just garbage bytes after a real signature", "utf8"),
      ]);
      await expect(assertReasonablePixelDimensions(corrupt)).rejects.toThrow("image could not be read");
    },
  );
});

describe("withTimeout", () => {
  it("resolves with the underlying value when it settles before the timeout", async () => {
    await expect(withTimeout(Promise.resolve("done"), 1000)).resolves.toBe("done");
  });

  it("propagates a rejection from the underlying promise when it rejects before the timeout", async () => {
    await expect(withTimeout(Promise.reject(new Error("nope")), 1000)).rejects.toThrow("nope");
  });

  it("rejects once the timeout elapses if the underlying promise never settles", async () => {
    const neverSettles = new Promise<never>(() => {});
    await expect(withTimeout(neverSettles, 20)).rejects.toThrow();
  });

  it("exports a timeout budget comfortably under the 30s function ceiling", () => {
    expect(REQUEST_TIMEOUT_MS).toBeLessThan(30_000);
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
