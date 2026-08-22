import { describe, expect, it } from "vitest";
import { scoreImage, scoreCounts, type TruthItem, type PredictedCount } from "../eval/score.js";

const truth: TruthItem[] = [
  { name: "Bananas", brand: null, qty: 1, occluded: false },
  { name: "Froot Loops", brand: "Kellogg's", qty: 1, occluded: false },
];

describe("scoreImage", () => {
  it("scores a perfect prediction as 1 and 1", () => {
    const s = scoreImage(
      [
        { name: "Bananas", brand: null },
        { name: "Froot Loops", brand: "Kellogg's" },
      ],
      truth,
    );
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(1);
  });

  it("penalises a miss in recall but not precision", () => {
    const s = scoreImage([{ name: "Bananas", brand: null }], truth);
    expect(s.recall).toBe(0.5);
    expect(s.precision).toBe(1);
  });

  it("penalises a hallucination in precision but not recall", () => {
    const s = scoreImage(
      [
        { name: "Bananas", brand: null },
        { name: "Froot Loops", brand: "Kellogg's" },
        { name: "Motor Oil", brand: "Castrol" },
      ],
      truth,
    );
    expect(s.recall).toBe(1);
    expect(s.precision).toBeCloseTo(2 / 3);
  });

  it("matches despite capitalisation and punctuation differences", () => {
    const s = scoreImage([{ name: "froot loops", brand: "kelloggs" }], truth);
    expect(s.matched).toContain("kelloggs::froot loop");
  });

  it("returns zero recall and zero precision for an empty prediction", () => {
    const s = scoreImage([], truth);
    expect(s.recall).toBe(0);
    expect(s.precision).toBe(0);
  });

  it("treats a brand-only mismatch as both a miss and a hallucination, not a partial match", () => {
    const s = scoreImage([{ name: "Froot Loops", brand: "Store Brand" }], truth);
    expect(s.recall).toBe(0);
    expect(s.precision).toBe(0);
    expect(s.hallucinated).toContain("store brand::froot loop");
    expect(s.missed).toContain("kelloggs::froot loop");
  });

  it("treats a name-only mismatch as both a miss and a hallucination, not a partial match", () => {
    const s = scoreImage(
      [
        { name: "Bananas", brand: null },
        { name: "Rice Krispies", brand: "Kellogg's" },
      ],
      truth,
    );
    expect(s.recall).toBe(0.5);
    expect(s.precision).toBe(0.5);
    expect(s.hallucinated).toContain("kelloggs::rice krispy");
    expect(s.missed).toContain("kelloggs::froot loop");
  });

  it("collapses two ground-truth items that key identically into one requirement", () => {
    const dupTruth: TruthItem[] = [
      { name: "Bananas", brand: null, qty: 1, occluded: false },
      { name: "bananas", brand: null, qty: 1, occluded: false },
    ];
    const s = scoreImage([{ name: "Bananas", brand: null }], dupTruth);
    expect(s.recall).toBe(1);
    expect(s.precision).toBe(1);
  });

  it("collapses two predicted items that key identically into one claim", () => {
    const s = scoreImage(
      [
        { name: "Bananas", brand: null },
        { name: "bananas", brand: null },
      ],
      truth,
    );
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(0.5);
  });

  it("ignores qty entirely: over-counting or under-counting a matched product is neither a miss nor a hallucination", () => {
    const s = scoreImage(
      [
        { name: "Bananas", brand: null },
        { name: "Froot Loops", brand: "Kellogg's" },
      ],
      [
        { name: "Bananas", brand: null, qty: 3, occluded: false },
        { name: "Froot Loops", brand: "Kellogg's", qty: 1, occluded: false },
      ],
    );
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(1);
    expect(s.missed).toEqual([]);
    expect(s.hallucinated).toEqual([]);
  });

  it("does not treat occluded truth items specially: an unreported occluded item is still a miss", () => {
    const occludedTruth: TruthItem[] = [
      { name: "Bananas", brand: null, qty: 1, occluded: false },
      { name: "Froot Loops", brand: "Kellogg's", qty: 1, occluded: true },
    ];
    const s = scoreImage([{ name: "Bananas", brand: null }], occludedTruth);
    expect(s.recall).toBe(0.5);
    expect(s.missed).toContain("kelloggs::froot loop");
  });

  it("returns zero, not one, when both predicted and truth are empty", () => {
    const s = scoreImage([], []);
    expect(s.precision).toBe(0);
    expect(s.recall).toBe(0);
  });
});

describe("scoreCounts", () => {
  it("scores exact agreement as a match with zero signed error", () => {
    const s = scoreCounts(
      [{ productKey: "::banana", count: 1 }],
      [{ name: "Bananas", brand: null, qty: 1, occluded: false }],
    );
    expect(s.totalCompared).toBe(1);
    expect(s.exactMatches).toBe(1);
    expect(s.meanSignedError).toBe(0);
    expect(s.overCounted).toEqual([]);
    expect(s.underCounted).toEqual([]);
    expect(s.comparisons).toEqual([
      { productKey: "::banana", truthQty: 1, predictedCount: 1, signedError: 0, exactMatch: true },
    ]);
  });

  it("records a positive signed error and overCounted when the model over-counts, this is the shipped bug's exact shape", () => {
    // Ground truth: one bunch of bananas. Model: three. This is the exact regression this
    // function exists to catch.
    const s = scoreCounts(
      [{ productKey: "::banana", count: 3 }],
      [{ name: "Bananas", brand: null, qty: 1, occluded: false }],
    );
    expect(s.totalCompared).toBe(1);
    expect(s.exactMatches).toBe(0);
    expect(s.meanSignedError).toBe(2);
    expect(s.overCounted).toEqual(["::banana"]);
    expect(s.underCounted).toEqual([]);
  });

  it("records a negative signed error and underCounted when the model under-counts", () => {
    const s = scoreCounts(
      [{ productKey: "::banana", count: 1 }],
      [{ name: "Bananas", brand: null, qty: 3, occluded: false }],
    );
    expect(s.totalCompared).toBe(1);
    expect(s.exactMatches).toBe(0);
    expect(s.meanSignedError).toBe(-2);
    expect(s.underCounted).toEqual(["::banana"]);
    expect(s.overCounted).toEqual([]);
  });

  it("reports a truth product with no inViewCounts entry as missingFromPredicted, not as a count of zero", () => {
    const s = scoreCounts(
      [],
      [{ name: "Bananas", brand: null, qty: 1, occluded: false }],
    );
    expect(s.missingFromPredicted).toEqual(["::banana"]);
    expect(s.totalCompared).toBe(0);
    expect(s.meanSignedError).toBe(0);
    expect(s.comparisons).toEqual([
      { productKey: "::banana", truthQty: 1, predictedCount: null, signedError: null, exactMatch: false },
    ]);
  });

  it("reports an inViewCounts entry with no matching ground-truth product as missingFromTruth", () => {
    const s = scoreCounts([{ productKey: "::motor oil", count: 1 }], []);
    expect(s.missingFromTruth).toEqual(["::motor oil"]);
    expect(s.totalCompared).toBe(0);
    expect(s.comparisons).toEqual([
      { productKey: "::motor oil", truthQty: null, predictedCount: 1, signedError: null, exactMatch: false },
    ]);
  });

  it("treats a predicted count of zero as a real, comparable value, not as a missing entry", () => {
    const s = scoreCounts(
      [{ productKey: "::banana", count: 0 }],
      [{ name: "Bananas", brand: null, qty: 1, occluded: false }],
    );
    expect(s.totalCompared).toBe(1);
    expect(s.missingFromPredicted).toEqual([]);
    expect(s.underCounted).toEqual(["::banana"]);
    expect(s.comparisons[0].signedError).toBe(-1);
  });

  it("sums duplicate predicted keys instead of overwriting or rejecting them", () => {
    const s = scoreCounts(
      [
        { productKey: "::banana", count: 1 },
        { productKey: "::banana", count: 2 },
      ],
      [{ name: "Bananas", brand: null, qty: 3, occluded: false }],
    );
    expect(s.totalCompared).toBe(1);
    expect(s.exactMatches).toBe(1);
    expect(s.comparisons[0].predictedCount).toBe(3);
  });

  it("sums duplicate ground-truth keys instead of overwriting or rejecting them", () => {
    const s = scoreCounts(
      [{ productKey: "::banana", count: 3 }],
      [
        { name: "Bananas", brand: null, qty: 1, occluded: false },
        { name: "bananas", brand: null, qty: 2, occluded: false },
      ],
    );
    expect(s.totalCompared).toBe(1);
    expect(s.exactMatches).toBe(1);
    expect(s.comparisons[0].truthQty).toBe(3);
  });

  it("returns zero totals, not NaN, for an empty image on both sides", () => {
    const s = scoreCounts([], []);
    expect(s.totalCompared).toBe(0);
    expect(s.exactMatches).toBe(0);
    expect(s.meanSignedError).toBe(0);
    expect(s.overCounted).toEqual([]);
    expect(s.underCounted).toEqual([]);
    expect(s.missingFromPredicted).toEqual([]);
    expect(s.missingFromTruth).toEqual([]);
  });

  it("averages signed error only over comparable keys, mixing over- and under-counts", () => {
    const predicted: PredictedCount[] = [
      { productKey: "::banana", count: 3 }, // truth 1, error +2
      { productKey: "kelloggs::froot loop", count: 1 }, // truth 1, error 0
    ];
    const truthMixed: TruthItem[] = [
      { name: "Bananas", brand: null, qty: 1, occluded: false },
      { name: "Froot Loops", brand: "Kellogg's", qty: 1, occluded: false },
      { name: "Rice Krispies", brand: "Kellogg's", qty: 5, occluded: false }, // no predicted entry
    ];
    const s = scoreCounts(predicted, truthMixed);
    expect(s.totalCompared).toBe(2);
    expect(s.meanSignedError).toBe(1);
    expect(s.missingFromPredicted).toEqual(["kelloggs::rice krispy"]);
  });
});
