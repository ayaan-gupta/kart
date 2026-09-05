import { describe, expect, it } from "vitest";
import { norm, scoreImage, type ScoreLabel, type ScoreLine } from "../eval/pipeline/clut-scoring.js";

/**
 * The clut scorer used to hand every matching line to the first label that matched it. Two
 * labels sharing a generic phrase ("cracker", "milk") could then never both be found: the first
 * claimed both lines and was scored with a doubled quantity, and the second was scored as a
 * miss. Measured across five model arms on 2026-09-05, every arm "missed" the second Savoritz
 * box and "over-counted" the first, when every arm had listed two boxes of crackers.
 */

const label = (partial: Partial<ScoreLabel> & { label: string; match: string[] }): ScoreLabel => ({
  brand: null,
  qty: 1,
  brandMatch: null,
  hidden: false,
  legible: true,
  ...partial,
});
const line = (name: string, brand: string | null = null, qty = 1): ScoreLine => ({ name, brand, qty, confidence: 0.9 });

describe("norm", () => {
  it("folds accents, so Neufchâtel matches neufchatel", () => {
    expect(norm("Neufchâtel cheese")).toBe("neufchatel cheese");
  });
});

describe("scoreImage", () => {
  it("gives two labels sharing a generic phrase one line each", () => {
    const products = [
      label({ label: "Savoritz crackers, sea salt", match: ["cracker"], brandMatch: ["savoritz"] }),
      label({ label: "Savoritz crackers, rosemary", match: ["cracker"], brandMatch: ["savoritz"] }),
    ];
    const lines = [line("Avocado oil crackers", "Savoritz"), line("Avocado oil crackers", "Savoritz")];
    const s = scoreImage(lines, { products, ignoreMatch: [] });
    expect(s.found).toBe(2);
    expect(s.qtyRight).toBe(2);
    expect(s.misses).toEqual([]);
  });

  it("sends a specific line to its specific label even when a generic label came first", () => {
    const products = [
      label({ label: "crackers, sea salt", match: ["cracker"] }),
      label({ label: "crackers, rosemary", match: ["rosemary", "cracker"] }),
    ];
    const lines = [line("Rosemary sourdough crackers"), line("Sea salt crackers")];
    const s = scoreImage(lines, { products, ignoreMatch: [] });
    expect(s.found).toBe(2);
    expect(s.assigned.get(1)).toEqual([0]);
    expect(s.assigned.get(0)).toEqual([1]);
  });

  it("does not double a count with a line the photograph's ignore list covers", () => {
    // A pantry with one Barilla box and a jar of loose spaghetti: the model lists both, the box
    // is the product and the jar is on the ignore list. The label gets one, not two.
    const products = [label({ label: "Barilla thick spaghetti", match: ["spaghetti"], brandMatch: ["barilla"] })];
    const lines = [line("Thick spaghetti", "Barilla"), line("Dry spaghetti in a storage jar")];
    const s = scoreImage(lines, { products, ignoreMatch: ["storage jar", "spaghetti"] });
    expect(s.found).toBe(1);
    expect(s.qtyRight).toBe(1);
    expect(s.ignoredLines).toHaveLength(1);
    expect(s.unmatchedLines).toHaveLength(0);
  });

  it("still finds a product whose only line is on the ignore list", () => {
    const products = [label({ label: "Barilla thick spaghetti", match: ["spaghetti"] })];
    const lines = [line("Dry spaghetti")];
    const s = scoreImage(lines, { products, ignoreMatch: ["spaghetti"] });
    expect(s.found).toBe(1);
  });

  it("scores the brand off the first line it assigned, and only when the label is legible", () => {
    const products = [
      label({ label: "Priano rigatoni", match: ["rigatoni"], brandMatch: ["priano"] }),
      label({ label: "soup, brand not legible", match: ["soup"], brandMatch: null }),
    ];
    const lines = [line("Rigatoni", "Primo"), line("Condensed soup", "Campbell's")];
    const s = scoreImage(lines, { products, ignoreMatch: [] });
    expect(s.brandScored).toBe(1);
    expect(s.brandRight).toBe(0);
    expect(s.brandWrong).toEqual([{ label: "Priano rigatoni", expected: "priano", actual: "Primo" }]);
  });

  it("reports a quantity range as satisfied anywhere inside it", () => {
    const products = [label({ label: "apples", match: ["apple"], qty: [1, 6] })];
    const s = scoreImage([line("Red apples", null, 4)], { products, ignoreMatch: [] });
    expect(s.qtyRight).toBe(1);
  });

  it("keeps a line that answers to nothing as invented, and one on the ignore list as ignored", () => {
    const products = [label({ label: "milk", match: ["milk"] })];
    const lines = [line("Milk"), line("Iced tea pitcher"), line("Chocolate bar")];
    const s = scoreImage(lines, { products, ignoreMatch: ["pitcher"] });
    expect(s.ignoredLines.map((l) => l.name)).toEqual(["Iced tea pitcher"]);
    expect(s.unmatchedLines.map((l) => l.name)).toEqual(["Chocolate bar"]);
  });
});
