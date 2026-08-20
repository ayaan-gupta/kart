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

  it("CENSUS_SYSTEM_PROMPT gives every required field, including category, for a badge with nothing identifiable in it", () => {
    // Fix round 2, Finding A: marks[].category is required and non-nullable, so the rule
    // covering an empty/non-product badge must pin a literal value, not leave it improvised.
    expect(CENSUS_SYSTEM_PROMPT).toContain('category to "other"');
  });

  it("CENSUS_SYSTEM_PROMPT gives explicit brand guidance for a genuinely brandless item, distinct from the illegible-packaging case", () => {
    // Fix round 2, Finding B: loose produce (bananas) has no brand at all, which is a
    // different situation from rule 2's "brand is present but illegible". The prompt must
    // cover this case by name, with a concrete value, not leave it to be inferred.
    expect(CENSUS_SYSTEM_PROMPT).toMatch(/genuinely has no brand/);
    expect(CENSUS_SYSTEM_PROMPT).toContain("set brand to null");
    expect(CENSUS_SYSTEM_PROMPT).toContain("bananas");
    // And it must be reconcilable with rule 12's "" convention for the same case in the
    // productKey string, not merely present in isolation.
    expect(CENSUS_SYSTEM_PROMPT).toMatch(/productKey brand segment/);
  });
});

describe("censusUserText offers the catalog's shortlist", () => {
  const mark = (id: number, candidates?: { sku: string; confidence: number }[]) => ({
    id,
    box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    ...(candidates ? { candidates } : {}),
  });

  it("adds no catalog line when no catalog was consulted", () => {
    // An empty "catalog:" line would read as the catalog having considered this region and
    // rejected every product it sells, which is a far stronger claim than not being asked.
    expect(censusUserText([mark(1)])).not.toContain("catalog:");
  });

  it("lists the candidates for a region that has them, in order", () => {
    const text = censusUserText([
      mark(1, [
        { sku: "Froot Loops", confidence: 0.9 },
        { sku: "Apple Jacks", confidence: 0 },
      ]),
    ]);
    expect(text).toContain("catalog: Froot Loops, Apple Jacks");
  });

  it("keeps each region's candidates on that region's own row", () => {
    const text = censusUserText([
      mark(1, [{ sku: "Froot Loops", confidence: 0.9 }]),
      mark(2),
      mark(3, [{ sku: "Whole Milk", confidence: 0.8 }]),
    ]);
    const lines = text.split("\n");
    const rowOf = (id: number) => lines.findIndex((l) => l.trim().startsWith(`${id}:`));
    expect(lines[rowOf(1) + 1]).toContain("Froot Loops");
    // Region 2 has none, so the line after it is region 3's row, not a stray catalog line.
    expect(lines[rowOf(2) + 1].trim()).toMatch(/^3:/);
    expect(lines[rowOf(3) + 1]).toContain("Whole Milk");
  });

  it("tells the model it may reject every candidate", () => {
    // Without this the model picks the closest of a bad set, which is precisely the failure a
    // shortlist introduces: it makes a wrong answer look sanctioned by the store's own records.
    expect(CENSUS_SYSTEM_PROMPT).toContain("do not pick the closest");
    expect(CENSUS_SYSTEM_PROMPT).toContain("catalogSku to null");
  });
});
