import { describe, expect, it } from "vitest";
import { CENSUS_SYSTEM_PROMPT, IDENTIFY_SYSTEM_PROMPT, censusUserText } from "../src/prompts.js";
import type { Mark } from "../src/compositor.js";
import {
  MarkIdentification,
  UnmarkedItem,
  InViewCount,
  Occlusion,
  CensusResponse,
  IdentifyResponse,
} from "../src/schemas.js";

const DASHES = /[—–]/;

/**
 * Asserts `field` appears in `prompt` as a standalone token (word-boundary match), not merely
 * as a substring of some unrelated word (e.g. the field "id" must not be satisfied by the
 * prompt merely containing the word "identify").
 */
function expectPromptNamesField(prompt: string, field: string): void {
  const re = new RegExp(`\\b${field}\\b`);
  expect(re.test(prompt), `expected prompt to mention field "${field}" as a standalone token`).toBe(true);
}

describe("censusUserText", () => {
  it("tells the model to use unmarkedItems when no regions were detected", () => {
    expect(censusUserText([])).toBe(
      "No regions were detected. List every grocery product you can see in unmarkedItems.",
    );
  });

  it("renders every mark number exactly once, in order, with no gaps or invented numbers", () => {
    const marks: Mark[] = [
      { id: 1, box: { x: 0, y: 0, w: 0.1, h: 0.1 } },
      { id: 2, box: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } },
      { id: 3, box: { x: 0.8, y: 0.1, w: 0.05, h: 0.05 } },
    ];
    const text = censusUserText(marks);
    const ids = [...text.matchAll(/^ {2}(\d+):/gm)].map((m) => Number(m[1]));
    expect(ids).toEqual([1, 2, 3]);
  });

  it("reports the correct count of numbered regions", () => {
    const marks: Mark[] = [
      { id: 1, box: { x: 0, y: 0, w: 0.1, h: 0.1 } },
      { id: 2, box: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } },
    ];
    expect(censusUserText(marks)).toContain("There are 2 numbered regions.");
  });

  it("produces the expected string for a single mark, with centre and size substituted", () => {
    const marks: Mark[] = [{ id: 7, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }];
    expect(censusUserText(marks)).toBe(
      "There are 1 numbered regions. Their normalized positions, where (0,0) is top-left and (1,1) is bottom-right:\n" +
        "  7: centre (0.25, 0.40), size 0.30 by 0.40\n\n" +
        "Identify the product in each.",
    );
  });

  it("leaves no unsubstituted template placeholder in its output", () => {
    const marks: Mark[] = [{ id: 1, box: { x: 0, y: 0, w: 0.1, h: 0.1 } }];
    expect(censusUserText(marks)).not.toMatch(/\$\{/);
    expect(censusUserText([])).not.toMatch(/\$\{/);
  });

  it("contains no em dash or en dash", () => {
    const marks: Mark[] = [
      { id: 1, box: { x: 0, y: 0, w: 0.1, h: 0.1 } },
      { id: 42, box: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } },
    ];
    expect(censusUserText(marks)).not.toMatch(DASHES);
    expect(censusUserText([])).not.toMatch(DASHES);
  });
});

describe("system prompts", () => {
  it("CENSUS_SYSTEM_PROMPT contains no em dash or en dash", () => {
    expect(CENSUS_SYSTEM_PROMPT).not.toMatch(DASHES);
  });

  it("IDENTIFY_SYSTEM_PROMPT contains no em dash or en dash", () => {
    expect(IDENTIFY_SYSTEM_PROMPT).not.toMatch(DASHES);
  });

  it("both system prompts are trimmed, with no leading or trailing whitespace", () => {
    expect(CENSUS_SYSTEM_PROMPT).toBe(CENSUS_SYSTEM_PROMPT.trim());
    expect(IDENTIFY_SYSTEM_PROMPT).toBe(IDENTIFY_SYSTEM_PROMPT.trim());
  });

  it("CENSUS_SYSTEM_PROMPT names every field the census schema requires, read from schemas.ts at runtime", () => {
    // Union of every required field across the whole census response tree, pulled from the
    // live zod schemas rather than hand-typed here, so a field added, removed, or renamed in
    // schemas.ts changes this list automatically instead of leaving a stale literal behind.
    const fields = new Set<string>([
      ...Object.keys(CensusResponse.shape),
      ...Object.keys(MarkIdentification.shape),
      ...Object.keys(UnmarkedItem.shape),
      ...Object.keys(InViewCount.shape),
      ...Object.keys(Occlusion.shape),
    ]);
    expect(fields.size).toBeGreaterThan(0); // guard against a refactor silently emptying this
    for (const field of fields) {
      expectPromptNamesField(CENSUS_SYSTEM_PROMPT, field);
    }
  });

  it("CENSUS_SYSTEM_PROMPT's occlusion severity values match the schema's enum exactly, read from schemas.ts at runtime", () => {
    const severityValues = Object.keys(Occlusion.shape.severity.def.entries);
    expect(severityValues.length).toBeGreaterThan(0); // guard against a refactor silently emptying this
    for (const value of severityValues) {
      expect(CENSUS_SYSTEM_PROMPT).toContain(`"${value}"`);
    }
  });

  it("IDENTIFY_SYSTEM_PROMPT names every field the identify schema requires, read from schemas.ts at runtime", () => {
    const fields = Object.keys(IdentifyResponse.shape);
    expect(fields.length).toBeGreaterThan(0); // guard against a refactor silently emptying this
    for (const field of fields) {
      expectPromptNamesField(IDENTIFY_SYSTEM_PROMPT, field);
    }
  });
});
