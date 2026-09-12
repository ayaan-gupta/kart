import { describe, expect, it } from "vitest";
import { UNSURE_BELOW, reconcile, splitByUnits, unitGroups, type WideReading } from "../src/reconcile.js";
import type { VerifyResponse } from "../src/schemas.js";
import { buildCatalog } from "../src/catalog.js";

/**
 * The rule that decides whether a line is shown green or amber. Two readings of one product, a
 * wide one from the whole photograph and a close one from a crop of it, and the question is
 * whether they agree well enough to assert the line to the shopper. Everything the shopper sees
 * as "Not sure" comes from here, so every branch is pinned.
 */
const wide: WideReading = { description: "Rigatoni", brand: "Priano", count: 1, confidence: 0.9 };
const close = (over: Partial<VerifyResponse> = {}): VerifyResponse => ({
  name: "Rigatoni", brand: "Priano", count: 1, confidence: 0.95, legible: true, matchesHint: true, catalogSku: null, ...over,
});

describe("reconcile: two readings that agree", () => {
  it("is sure, with the mean confidence and the wide reading's words", () => {
    const line = reconcile(wide, close());
    expect(line.sure).toBe(true);
    expect(line.confidence).toBeCloseTo((0.9 + 0.95) / 2);
    expect(line.description).toBe("Rigatoni");
    expect(line.brand).toBe("Priano");
    expect(line.count).toBe(1);
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

/**
 * The close read is cut from the same pixels the wide pass counted, so a count above one that
 * both agree on has had one witness. On clut9 on 2026-09-11 Qwen read a box of rosemary
 * sourdough crackers standing behind a box of sea salt as a second box of sea salt, in the wide
 * pass and the close read alike, and "2 x sea salt" was asserted (server/eval/CLUT.md).
 */
describe("reconcile: a count above one", () => {
  it("is not sure when both readings agree on more than one", () => {
    expect(reconcile({ ...wide, count: 2 }, close({ count: 2 })).sure).toBe(false);
  });

  it("keeps the count the two readings agreed on, for the shopper to check", () => {
    expect(reconcile({ ...wide, count: 3 }, close({ count: 3 })).count).toBe(3);
  });

  it("reports it below the unsure line, so a client that only reads confidence flags it", () => {
    expect(reconcile({ ...wide, count: 2 }, close({ count: 2 })).confidence).toBeLessThan(UNSURE_BELOW);
  });

  it("is not sure of more than one even when the shop sells exactly this", () => {
    expect(reconcile({ ...wide, count: 2 }, close({ count: 2 }), shop).sure).toBe(false);
  });

  it("keeps the brand the close read took off the label", () => {
    expect(reconcile({ ...wide, brand: null, count: 2 }, close({ brand: "Priano", count: 2 })).brand).toBe("Priano");
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
    expect(line.count).toBe(1);
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
    expect(line.count).toBe(1);
  });
});

/**
 * The third reading: the store's own catalog.
 *
 * Two model readings agreeing is two answers to "what is this", and they can agree and both be
 * wrong. The catalog answers a different question, "which of the things this shop sells is
 * that", and a line the shop cannot account for is the case the two-reading gate cannot see:
 * measured over the lines of two recorded runs (server/eval/pipeline/catalog-replay.ts), fourteen
 * of the sixteen lines those runs asserted wrongly are lines the catalog declines.
 */
const shop = buildCatalog([
  { sku: "Priano rigatoni", brand: "Priano", name: "rigatoni" },
  { sku: "Priano penne rigate", brand: "Priano", name: "penne rigate" },
  { sku: "Savoritz avocado oil crackers sea salt", brand: "Savoritz", name: "avocado oil crackers sea salt" },
  { sku: "Savoritz avocado oil crackers rosemary and sourdough", brand: "Savoritz", name: "avocado oil crackers rosemary and sourdough" },
  { sku: "bananas", brand: null, name: "bananas" },
]);

describe("reconcile: against the store's catalog", () => {
  it("is sure and carries the sku when the shop sells exactly this", () => {
    const line = reconcile(wide, close(), shop);
    expect(line.sure).toBe(true);
    expect(line.sku).toBe("Priano rigatoni");
  });

  it("is unsure when the shop sells nothing like it, however well the two readings agreed", () => {
    const reading: WideReading = { description: "pull-tab tin", brand: null, count: 1, confidence: 0.95 };
    const line = reconcile(reading, close({ name: "pull-tab tin", brand: null, count: 1 }), shop);
    expect(line.sure).toBe(false);
    expect(line.sku).toBeNull();
    expect(line.catalog).toBe("absent");
  });

  it("is unsure when the reading fits two of the shop's products equally", () => {
    const reading: WideReading = { description: "avocado oil crackers", brand: "Savoritz", count: 1, confidence: 0.95 };
    const line = reconcile(reading, close({ name: "avocado oil crackers", brand: "Savoritz", count: 1 }), shop);
    expect(line.sure).toBe(false);
    expect(line.catalog).toBe("ambiguous");
  });

  it("leaves a line the two readings already doubted alone", () => {
    // The catalog cannot promote anything. A disagreement is unsure whatever the shop stocks.
    const line = reconcile(wide, close({ count: 3 }), shop);
    expect(line.sure).toBe(false);
  });

  it("changes nothing at all when there is no catalog", () => {
    const line = reconcile(wide, close());
    expect(line.sure).toBe(true);
    expect(line.sku).toBeNull();
    expect(line.catalog).toBe("not-consulted");
  });
});

describe("reconcile: the crop chooses from the shortlist", () => {
  const crackers: WideReading = { description: "avocado oil crackers", brand: "Savoritz", count: 1, confidence: 0.95 };
  const closeCrackers = (over: Partial<VerifyResponse> = {}): VerifyResponse =>
    close({ name: "avocado oil crackers", brand: "Savoritz", count: 1, ...over });

  it("settles an ambiguity when the crop names one of the products that were offered", () => {
    // Text cannot separate the shop's two avocado oil crackers, because the reading does not name
    // a variety. The crop can: it is the packaging at the photograph's own resolution, and it was
    // shown the shop's own two rows to choose between.
    const line = reconcile(crackers, closeCrackers({ catalogSku: "Savoritz avocado oil crackers sea salt" }), shop);
    expect(line.sure).toBe(true);
    expect(line.sku).toBe("Savoritz avocado oil crackers sea salt");
    expect(line.catalog).toBe("picked");
  });

  it("ignores a product the shortlist never offered", () => {
    // The shortlist is the whole of what the crop may choose from. A SKU from outside it is the
    // model writing a product name, which is what it was already doing in `name`.
    const line = reconcile(crackers, closeCrackers({ catalogSku: "Priano penne rigate" }), shop);
    expect(line.sure).toBe(false);
    expect(line.sku).toBeNull();
  });

  it("does not let the crop rescue a reading of something the shop sells nothing like", () => {
    const tin: WideReading = { description: "pull-tab tin", brand: null, count: 1, confidence: 0.95 };
    const line = reconcile(tin, close({ name: "pull-tab tin", brand: null, count: 1, catalogSku: "bananas" }), shop);
    expect(line.sure).toBe(false);
  });

  it("still needs the two readings to agree", () => {
    const line = reconcile(crackers, closeCrackers({ count: 3, catalogSku: "Savoritz avocado oil crackers sea salt" }), shop);
    expect(line.sure).toBe(false);
  });
});

/**
 * The third question at the same crop: one entry per package, anchored on the product by name.
 * Measured on 2026-09-12 over both passes of the fifteen clut photographs (server/eval/CLUT.md,
 * "Something else to separate the packages"), where it splits one line into the two varieties it
 * was hiding and confirms two counts the gate was holding back, and asserts nothing wrong.
 */
const unit = (label: string, x = 500, y = 500) => ({ label, x, y });

describe("units: a count both readings agree on, counted again a different way", () => {
  const two: WideReading = { ...wide, count: 2 };

  it("is asserted when the units agree with the count", () => {
    const line = reconcile(two, close({ count: 2 }), null, [unit("Rigatoni", 300), unit("Rigatoni", 700)]);
    expect(line.sure).toBe(true);
    expect(line.count).toBe(2);
  });

  it("stays unsure when the units find fewer packages than the two readings counted", () => {
    expect(reconcile(two, close({ count: 2 }), null, [unit("Rigatoni")]).sure).toBe(false);
  });

  it("stays unsure when nothing asked the question", () => {
    expect(reconcile(two, close({ count: 2 })).sure).toBe(false);
    expect(reconcile(two, close({ count: 2 }), null, []).sure).toBe(false);
  });

  it("stays unsure when the packages are not all the same product", () => {
    const line = reconcile(two, close({ count: 2 }), null, [unit("with Sea Salt", 300), unit("with Rosemary Sourdough", 700)]);
    expect(line.sure).toBe(false);
  });

  it("does not let the units rescue a line the readings themselves disagreed on", () => {
    const line = reconcile(two, close({ count: 2, brand: "Barilla" }), null, [unit("Rigatoni", 300), unit("Rigatoni", 700)]);
    expect(line.sure).toBe(false);
  });
});

describe("unitGroups: two wordings of one package, and two varieties of one range", () => {
  it("folds a label whose words are all inside another's", () => {
    const groups = unitGroups([unit("Rigatoni Authentic Italian"), unit("Priano Rigatoni Authentic Italian")]);
    expect(groups).toEqual([{ label: "Priano Rigatoni Authentic Italian", count: 2 }]);
  });

  it("keeps two varieties apart, each keeping a word the other lacks", () => {
    const groups = unitGroups([unit("Crackers with Sea Salt"), unit("Crackers with Rosemary Sourdough")]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.count)).toEqual([1, 1]);
  });

  it("ignores case, accents and punctuation, as the bag's own keys do", () => {
    expect(unitGroups([unit("Neufchâtel"), unit("neufchatel!")])).toHaveLength(1);
  });
});

describe("splitByUnits: one line becomes one line per variety", () => {
  const parent = reconcile({ ...wide, description: "crackers with sea salt", count: 2 }, close({ name: "crackers", count: 2 }));
  const box = { x: 0.4, y: 0.4, w: 0.4, h: 0.4 };

  it("gives nothing to split when the packages are all one product", () => {
    expect(splitByUnits(parent, [unit("sea salt", 300), unit("sea salt", 700)], box)).toBeNull();
    expect(splitByUnits(parent, [], box)).toBeNull();
  });

  it("names each line from the package it read and counts one each", () => {
    const split = splitByUnits(parent, [unit("with Sea Salt", 250), unit("with Rosemary Sourdough", 750)], box);
    expect(split).not.toBeNull();
    expect(split!.map((l) => l.description)).toEqual(["with Sea Salt", "with Rosemary Sourdough"]);
    expect(split!.map((l) => l.count)).toEqual([1, 1]);
  });

  it("never asserts a split line: nothing read the crop twice under that name", () => {
    const split = splitByUnits(parent, [unit("with Sea Salt", 250), unit("with Rosemary Sourdough", 750)], box);
    expect(split!.every((l) => l.sure === false)).toBe(true);
  });

  it("draws each line its own share of the box, along the axis the packages are spread on", () => {
    const split = splitByUnits(parent, [unit("left", 250, 500), unit("right", 750, 500)], box)!;
    expect(split[0].box!.w).toBeCloseTo(0.2);
    expect(split[0].box!.h).toBeCloseTo(0.4);
    expect(split[0].box!.x).toBeLessThan(split[1].box!.x);
  });

  it("splits the other way when the packages are stacked rather than side by side", () => {
    const split = splitByUnits(parent, [unit("top", 500, 200), unit("bottom", 500, 800)], box)!;
    expect(split[0].box!.h).toBeCloseTo(0.2);
    expect(split[0].box!.w).toBeCloseTo(0.4);
    expect(split[0].box!.y).toBeLessThan(split[1].box!.y);
  });

  it("keeps every share inside the box it came from", () => {
    const split = splitByUnits(parent, [unit("edge", 0, 0), unit("far", 1000, 1000)], box)!;
    for (const line of split) {
      expect(line.box!.x).toBeGreaterThanOrEqual(box.x);
      expect(line.box!.y).toBeGreaterThanOrEqual(box.y);
      expect(line.box!.x + line.box!.w).toBeLessThanOrEqual(box.x + box.w + 1e-9);
      expect(line.box!.y + line.box!.h).toBeLessThanOrEqual(box.y + box.h + 1e-9);
    }
  });
});
