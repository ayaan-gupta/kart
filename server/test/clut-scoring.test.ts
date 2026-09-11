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

/**
 * Per-line verdicts, so a run can say whether a line the app asserted was wrong. That is the
 * number the confidence gate exists to drive to zero, and no per-label total can give it.
 */
describe("scoreImage line outcomes", () => {
  const products = [
    label({ label: "Priano rigatoni", match: ["rigatoni"], brandMatch: ["priano"], qty: 2 }),
    label({ label: "bananas", match: ["banana"] }),
  ];

  it("calls a line right when its label's quantity and brand are right", () => {
    const s = scoreImage([line("Rigatoni", "Priano", 2), line("Bananas")], { products, ignoreMatch: [] });
    expect(s.lineOutcomes).toEqual(["right", "right"]);
  });

  it("calls a line wrong when its brand is wrong, or its label's quantity is", () => {
    const s = scoreImage([line("Rigatoni", "Piano", 2), line("Bananas", null, 3)], { products, ignoreMatch: [] });
    expect(s.lineOutcomes).toEqual(["wrong", "wrong"]);
  });

  it("calls a line that matches nothing invented, and one the ignore list covers ignored", () => {
    const s = scoreImage([line("Rigatoni", "Priano", 2), line("Wallet"), line("Red cup")], { products, ignoreMatch: ["cup"] });
    expect(s.lineOutcomes).toEqual(["right", "invented", "ignored"]);
  });
});

describe("scoreImage gives an ignorable line with the label's brand the label first", () => {
  it("lets the Barilla box take the Barilla label ahead of the household's jar of the same pasta", () => {
    const products = [label({ label: "Barilla thick spaghetti", match: ["spaghetti"], brandMatch: ["barilla"] })];
    // The jar is listed first, as the bag listed it. Both lines are ignorable, since the jar is
    // on the ignore list by the word they share.
    const lines = [line("spaghetti", null), line("thick spaghetti", "Barilla")];
    const s = scoreImage(lines, { products, ignoreMatch: ["spaghetti", "storage jar"] });
    expect(s.found).toBe(1);
    expect(s.brandRight).toBe(1);
    expect(s.lineOutcomes).toEqual(["ignored", "right"]);
  });
});

/**
 * What the shopper is told for sure has to be right on its own. The per-line verdict above sums
 * every line a label was given, sure and unsure together, so a sure "2 x Campbell's cream of
 * mushroom" for two tins was scored wrong on clut7 because an unsure duplicate beside it took the
 * total to three. The unsure line was the mistake, and it was shown as one. `assertedOutcomes`
 * judges each sure line on the sure lines alone, and leaves an unsure line null.
 */
describe("scoreImage asserted outcomes", () => {
  const products = [label({ label: "Priano rigatoni", match: ["rigatoni"], brandMatch: ["priano"], qty: 2 })];
  const sure = (name: string, brand: string | null, qty: number): ScoreLine => ({ ...line(name, brand, qty), sure: true });
  const unsure = (name: string, brand: string | null, qty: number): ScoreLine => ({ ...line(name, brand, qty), sure: false });

  it("does not blame a right sure line for an unsure duplicate beside it", () => {
    const s = scoreImage([sure("Rigatoni", "Priano", 2), unsure("Rigatoni", "Priano", 1)], { products, ignoreMatch: [] });
    expect(s.lineOutcomes).toEqual(["wrong", "wrong"]);
    expect(s.assertedOutcomes).toEqual(["right", null]);
  });

  it("calls a sure line that miscounts wrong", () => {
    const s = scoreImage([sure("Rigatoni", "Priano", 1)], { products, ignoreMatch: [] });
    expect(s.assertedOutcomes).toEqual(["wrong"]);
  });

  it("judges sure lines that split one product on their total", () => {
    expect(scoreImage([sure("Rigatoni", "Priano", 1), sure("Rigatoni", "Priano", 1)], { products, ignoreMatch: [] }).assertedOutcomes)
      .toEqual(["right", "right"]);
    expect(scoreImage([sure("Rigatoni", "Priano", 2), sure("Rigatoni", "Priano", 2)], { products, ignoreMatch: [] }).assertedOutcomes)
      .toEqual(["wrong", "wrong"]);
  });

  it("judges a sure line's brand on its own brand, not the first line's", () => {
    const s = scoreImage([unsure("Rigatoni", "Piano", 2), sure("Rigatoni", "Priano", 2)], { products, ignoreMatch: [] });
    expect(s.assertedOutcomes).toEqual([null, "right"]);
    expect(scoreImage([sure("Rigatoni", "Piano", 2)], { products, ignoreMatch: [] }).assertedOutcomes).toEqual(["wrong"]);
  });

  it("keeps invented and ignored for sure lines that match nothing", () => {
    const s = scoreImage([sure("Wallet", null, 1), sure("Red cup", null, 1)], { products, ignoreMatch: ["cup"] });
    expect(s.assertedOutcomes).toEqual(["invented", "ignored"]);
  });

  it("treats a line with no flag at all as sure, as the rescorer always has", () => {
    const s = scoreImage([line("Rigatoni", "Priano", 2)], { products, ignoreMatch: [] });
    expect(s.assertedOutcomes).toEqual(["right"]);
  });
});
