/**
 * Verifies the exact Responses API request shape before anything is built on it:
 * structured outputs, image input, and reasoning_effort together.
 *
 * Run: OPENAI_API_KEY=... npm run smoke
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { openai, MODELS } from "../src/openai.js";

const CORPUS = "eval/corpus/images";

function firstImageAsDataUrl(): string {
  const file = readdirSync(CORPUS).find((f) => /\.(jpe?g|png)$/i.test(f));
  if (!file) throw new Error(`No image found in ${CORPUS}`);
  const b64 = readFileSync(join(CORPUS, file)).toString("base64");
  const mime = file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  console.log(`Using ${file}`);
  return `data:${mime};base64,${b64}`;
}

const response = await openai.responses.create({
  model: MODELS.census,
  reasoning: { effort: "none" },
  input: [
    {
      role: "user",
      content: [
        { type: "input_text", text: "List every distinct grocery product you can see." },
        { type: "input_image", image_url: firstImageAsDataUrl(), detail: "auto" },
      ],
    },
  ],
  text: {
    format: {
      type: "json_schema",
      name: "smoke",
      strict: true,
      schema: {
        type: "object",
        properties: {
          items: { type: "array", items: { type: "string" } },
        },
        required: ["items"],
        additionalProperties: false,
      },
    },
  },
});

console.log("\n--- output_text ---");
console.log(response.output_text);
console.log("\n--- usage ---");
console.log(JSON.stringify(response.usage, null, 2));
