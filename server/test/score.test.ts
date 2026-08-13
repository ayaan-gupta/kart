import { describe, expect, it } from "vitest";
import { scoreImage, type TruthItem } from "../eval/score.js";

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
    expect(s.matched).toContain("kelloggs::froot loops");
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
    expect(s.hallucinated).toContain("store brand::froot loops");
    expect(s.missed).toContain("kelloggs::froot loops");
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
    expect(s.hallucinated).toContain("kelloggs::rice krispies");
    expect(s.missed).toContain("kelloggs::froot loops");
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
    expect(s.missed).toContain("kelloggs::froot loops");
  });

  it("returns zero, not one, when both predicted and truth are empty", () => {
    const s = scoreImage([], []);
    expect(s.precision).toBe(0);
    expect(s.recall).toBe(0);
  });
});
