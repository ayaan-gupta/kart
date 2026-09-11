import { describe, expect, it } from "vitest";
import { UNSURE_BELOW } from "../src/reconcile.js";
import { loopedProduct, salvagePhoto, stalled } from "../src/salvage.js";

/**
 * The shapes below are the ones Qwen 3 VL 235B actually wrote when it was stopped, taken from the
 * service log of 2026-09-11: clut12 repeating "lactose free milk, Friendly Farms" with the box
 * wandering by a point or two, clut9 repeating "crackers, Savoritz" with tabs inside the box, and
 * an answer that stalled on whitespace inside the first product's box.
 */
const item = (name: string, brand: string | null, x: number, extra: Partial<Record<string, unknown>> = {}) =>
  JSON.stringify({ name, brand, count: 1, confidence: 0.95, isProduct: true, box: { x, y: 18, w: 18, h: 10 }, ...extra });

const head = '{"subjectKind": "product", "items": [';
const milk = (y: number) =>
  `{"name": "lactose free milk", "brand": "Friendly Farms", "count": 1, "confidence": 0.98, "isProduct": true, "box": {"x": 34,  \n\n\n\n"y": ${y}, "w": 18, "h": 18}}`;
const beforeLoop = [item("probiotic drink", null, 5), item("cream cheese", null, 60, { count: 2 })];
const clut12 = `${head}${[...beforeLoop, milk(18), milk(19), milk(18), milk(19)].join(", ")}, {"name": "lactose free milk", "brand": "Friendly Farms", "count`;

describe("salvagePhoto", () => {
  it("keeps every product written before a loop, and the looped one once", () => {
    const answer = salvagePhoto(clut12);
    expect(answer?.items.map((i) => i.name)).toEqual(["probiotic drink", "cream cheese", "lactose free milk"]);
  });

  it("marks only the looped product unsure", () => {
    const answer = salvagePhoto(clut12);
    const [drink, cheese, looped] = answer?.items ?? [];
    expect(looped.confidence).toBeLessThan(UNSURE_BELOW);
    expect(drink.confidence).toBe(0.95);
    expect(cheese.confidence).toBe(0.95);
  });

  it("keeps the looped product's first count and box, not their sum", () => {
    const looped = salvagePhoto(clut12)?.items[2];
    expect(looped?.count).toBe(1);
    expect(looped?.box).toEqual({ x: 34, y: 18, w: 18, h: 18 });
  });

  it("keeps the products written before it untouched", () => {
    const cheese = salvagePhoto(clut12)?.items[1];
    expect(cheese).toEqual(JSON.parse(beforeLoop[1]));
  });

  it("keeps a product cut off inside its box, without the box", () => {
    const text = `{"subjectKind": "product", "items": [{"name": "apples", "brand": null, "count": 10, "confidence": 0.95, "isProduct": true, "box": {"x": 47,${" ".repeat(400)}`;
    expect(salvagePhoto(text)?.items).toEqual([{ name: "apples", brand: null, count: 10, confidence: 0.95, isProduct: true, box: null }]);
  });

  it("drops a product cut off before its fields were all written", () => {
    const text = `${head}${item("crackers", "Savoritz", 29)}, {"name": "crac`;
    expect(salvagePhoto(text)?.items.map((i) => i.name)).toEqual(["crackers"]);
  });

  it("returns nothing when no product was written", () => {
    expect(salvagePhoto('{"subjectKind":"cart","items":[{"name":"Rigatoni","brand":"Priano"')).toBeNull();
    expect(salvagePhoto('{"subjectKind":"cart","items":[')).toBeNull();
    expect(salvagePhoto(`${head}${item("shopping cart", null, 0, { isProduct: false, box: null })}, {"na`)).toBeNull();
  });

  it("returns nothing when it cannot tell what the photograph is of", () => {
    expect(salvagePhoto(`{"items": [${item("crackers", "Savoritz", 29)}, {"na`)).toBeNull();
  });

  it("reports hidden items as possible when the answer stopped before saying", () => {
    expect(salvagePhoto(clut12)?.occlusion.severity).toBe("some");
  });

  it("keeps what it said about hidden items when it got that far", () => {
    const text = `${head}${beforeLoop.join(", ")}], "occlusion": {"severity": "many", "reason": "the crisper is behind the milk, the crisper is behind`;
    expect(salvagePhoto(text)?.occlusion.severity).toBe("many");
    expect(salvagePhoto(text)?.items).toHaveLength(2);
  });

  it("returns a finished answer followed by whitespace as it was written", () => {
    const whole = { subjectKind: "cart", items: [JSON.parse(milk(18)), JSON.parse(milk(19))], occlusion: { severity: "none", reason: "" } };
    expect(salvagePhoto(`${JSON.stringify(whole)}${"\n".repeat(300)}`)).toEqual(whole);
  });

  it("is not misled by braces, brackets or quotes inside a name", () => {
    const text = `${head}${item('minis } of { the ] "best"', "Kind", 5)}, ${item("bars", "Kind", 40)}, {"name": "x`;
    expect(salvagePhoto(text)?.items.map((i) => i.name)).toEqual(['minis } of { the ] "best"', "bars"]);
  });

  it("treats a brand written as the word null as no brand when finding repeats", () => {
    const text = `${head}${item("celery", "Null", 5)}, ${item("celery", null, 6)}, {"na`;
    expect(salvagePhoto(text)?.items).toHaveLength(1);
  });
});

describe("loopedProduct", () => {
  it("names a product written three times", () => {
    expect(loopedProduct(`${head}${[milk(18), milk(19), milk(18)].join(", ")}, {"na`)).toBe("friendly farms::lactose free milk");
  });

  it("allows a product written twice, which can be two packs of one name", () => {
    expect(loopedProduct(`${head}${[milk(18), milk(60)].join(", ")}, {"na`)).toBeNull();
  });

  it("counts only products whose writing is finished", () => {
    expect(loopedProduct(`${head}${[milk(18), milk(19)].join(", ")}, ${milk(18).slice(0, -2)}`)).toBeNull();
  });
});

describe("stalled", () => {
  it("is true once the answer ends in a long run of whitespace", () => {
    expect(stalled(`${head}{"name": "apples", "box": {"x": 47,${" \n\t".repeat(100)}`)).toBe(true);
  });

  it("is false for the short runs a real answer has inside a box", () => {
    expect(stalled(clut12.slice(0, clut12.indexOf('"y"')))).toBe(false);
  });
});
