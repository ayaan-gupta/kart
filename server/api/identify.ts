import { runIdentify } from "../src/recognize.js";
import {
  assertJsonContentType,
  assertJsonObject,
  assertReasonableContentLength,
  assertReasonablePixelDimensions,
  decodeBase64Image,
  fail,
  json,
  withTimeout,
} from "../src/http.js";

export const config = { runtime: "nodejs" };

const MAX_HINT_CHARS = 200;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let crop: Buffer;
  let hint: string | null;
  try {
    assertReasonableContentLength(req);
    assertJsonContentType(req);
    const body = await req.json();
    assertJsonObject(body);
    crop = decodeBase64Image(body.image, "image");
    await assertReasonablePixelDimensions(crop);
    hint =
      typeof body.hint === "string" && body.hint.length > 0
        ? body.hint.slice(0, MAX_HINT_CHARS)
        : null;
  } catch (err) {
    return fail(err, 400);
  }

  try {
    return json({ ok: true, result: await withTimeout(runIdentify(crop, hint)) });
  } catch (err) {
    return fail(err);
  }
}
