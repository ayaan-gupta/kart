import { describe, expect, it } from "vitest";
import { reconcile, type WideReading } from "../src/reconcile.js";
import type { VerifyResponse } from "../src/schemas.js";

/**
 * The rule that decides whether a line is shown green or amber. Two readings of one product, a
 * wide one from the whole photograph and a close one from a crop of it, and the question is
 * whether they agree well enough to assert the line to the shopper. Everything the shopper sees
 * as "Not sure" comes from here, so every branch is pinned.
 */
const wide: WideReading = { description: "Rigatoni", brand: "Priano", count: 2, confidence: 0.9 };
const close = (over: Partial<VerifyResponse> = {}): VerifyResponse => ({
  name: "Rigatoni", brand: "Priano", count: 2, confidence: 0.95, legible: true, matchesHint: true, ...over,
});

describe("reconcile: two readings that agree", () => {
  it("is sure, with the mean confidence and the wide reading's words", () => {
    const line = reconcile(wide, close());
    expect(line.sure).toBe(true);
    expect(line.confidence).toBeCloseTo((0.9 + 0.95) / 2);
    expect(line.description).toBe("Rigatoni");
    expect(line.brand).toBe("Priano");
    expect(line.count).toBe(2);
    expect(line.agreed).toBe(true);
  });

  it("takes the close pass's brand when the wide pass had none and the close pass read one", () => {
    const line = reconcile({ ...wide, brand: null }, close({ brand: "Priano" }));
    expect(line.sure).toBe(true);
    expect(line.brand).toBe("Priano");
  });

  it("compares brands without case, accents or punctuation", () => {
    const line = reconcile({ ...wide, brand: "Kellogg's" }, close({ brand: "KELLOGGS" }));
    expect(line.sure).toBe(true);
  });

  it("is not sure when either reading is below the unsure line, even in agreement", () => {
    expect(reconcile({ ...wide, confidence: 0.5 }, close()).sure).toBe(false);
    expect(reconcile(wide, close({ confidence: 0.55 })).sure).toBe(false);
  });
});

describe("reconcile: two readings that disagree", () => {
  it("is not sure when the close pass says the crop is not what the wide pass described, and becomes what the close pass read", () => {
    const line = reconcile(wide, close({ name: "Baking soda", brand: "Baker's Corner", count: 1, matchesHint: false }));
    expect(line.sure).toBe(false);
    expect(line.agreed).toBe(false);
    expect(line.confidence).toBeLessThan(0.6);
    expect(line.description).toBe("Baking soda");
    expect(line.brand).toBe("Baker's Corner");
    expect(line.count).toBe(1);
  });

  it("keeps the wide reading when the close pass says it is something else but could not read what", () => {
    const line = reconcile(wide, close({ name: "eggs", brand: null, count: 1, legible: false, confidence: 0.4, matchesHint: false }));
    expect(line.sure).toBe(false);
    expect(line.description).toBe("Rigatoni");
    expect(line.brand).toBe("Priano");
    // The count is still the close read's: it counted what is in the crop.
    expect(line.count).toBe(1);
  });

  it("is not sure when the brands differ, and shows the close pass's brand, since it read the label", () => {
    const line = reconcile({ ...wide, brand: "Piano" }, close({ brand: "Priano" }));
    expect(line.sure).toBe(false);
    expect(line.brand).toBe("Priano");
  });

  it("keeps the wide brand when the close pass could not read the label", () => {
    const line = reconcile({ ...wide, brand: "Piano" }, close({ brand: null, legible: false, confidence: 0.4 }));
    expect(line.sure).toBe(false);
    expect(line.brand).toBe("Piano");
  });

  it("is not sure when the counts differ, and keeps the wide count on the line", () => {
    const line = reconcile(wide, close({ count: 3 }));
    expect(line.sure).toBe(false);
    expect(line.count).toBe(2);
  });

  it("is not sure when the close pass could not read packaging that carries a brand", () => {
    const line = reconcile(wide, close({ legible: false }));
    expect(line.sure).toBe(false);
  });

  it("is sure of loose produce the close pass called illegible, since there is nothing to read", () => {
    const produce: WideReading = { description: "green onions", brand: null, count: 1, confidence: 0.9 };
    const line = reconcile(produce, close({ name: "green onions", brand: null, count: 1, legible: false, confidence: 0.88 }));
    expect(line.sure).toBe(true);
  });

  it("caps confidence below the unsure line so a client that only reads confidence still flags it", () => {
    const line = reconcile({ ...wide, confidence: 0.99 }, close({ confidence: 0.99, matchesHint: false }));
    expect(line.confidence).toBeLessThan(0.6);
  });
});

describe("reconcile: no close reading", () => {
  it("is not sure when the item had no box or its crop failed", () => {
    const line = reconcile(wide, null);
    expect(line.sure).toBe(false);
    expect(line.agreed).toBe(false);
    expect(line.confidence).toBeLessThan(0.6);
    expect(line.description).toBe("Rigatoni");
    expect(line.count).toBe(2);
  });
});
