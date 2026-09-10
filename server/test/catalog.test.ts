import { describe, expect, it } from "vitest";
import { buildCatalog, resolve, shortlist, type CatalogEntry } from "../src/catalog.js";

/**
 * The text leg of retrieval, against a small stand-in shop.
 *
 * The question this module answers is not "what is this product", which the model already
 * answered, but "which of the things this shop sells is that, if any". The whole value is in the
 * last three words: a resolver that always names its nearest entry has moved a wrong answer from
 * the model into the catalog rather than caught it.
 */
const SHOP: CatalogEntry[] = [
  { sku: "Priano rigatoni", brand: "Priano", name: "rigatoni" },
  { sku: "Priano penne rigate", brand: "Priano", name: "penne rigate" },
  { sku: "Priano fusilli bucati", brand: "Priano", name: "fusilli bucati", aliases: ["bronze cut pasta"] },
  { sku: "Barilla linguine", brand: "Barilla", name: "linguine" },
  { sku: "Barilla spaghetti", brand: "Barilla", name: "spaghetti" },
  { sku: "Barilla thick spaghetti", brand: "Barilla", name: "thick spaghetti" },
  { sku: "Campbell's cream of mushroom condensed soup", brand: "Campbell's", name: "cream of mushroom condensed soup", aliases: ["cream of mushroom soup"] },
  { sku: "Campbell's cream of chicken condensed soup", brand: "Campbell's", name: "cream of chicken condensed soup" },
  { sku: "Savoritz avocado oil crackers sea salt", brand: "Savoritz", name: "avocado oil crackers sea salt" },
  { sku: "Savoritz avocado oil crackers rosemary and sourdough", brand: "Savoritz", name: "avocado oil crackers rosemary and sourdough" },
  { sku: "Kroger roasted salted almonds", brand: "Kroger", name: "roasted salted almonds" },
  { sku: "Benton's chocolate chip cookies", brand: "Benton's", name: "chocolate chip cookies" },
  { sku: "Friendly Farms cottage cheese", brand: "Friendly Farms", name: "cottage cheese" },
  { sku: "Baker's Corner semi sweet chocolate chips", brand: "Baker's Corner", name: "semi sweet chocolate chips" },
  { sku: "Bob's Red Mill organic white quinoa", brand: "Bob's Red Mill", name: "organic white quinoa", aliases: ["quinoa"] },
  { sku: "Happy Farms neufchatel cheese", brand: "Happy Farms", name: "neufchatel cheese" },
  { sku: "Friendly Farms lactose free whole milk", brand: "Friendly Farms", name: "lactose free whole milk" },
  // Several organic lines, because a shop has several and how common a modifier is decides how
  // much weight it carries. A fixture with one organic product makes "organic" the rarest and so
  // the most telling word in the shop, which no real catalog does.
  { sku: "Simply Nature organic black beans", brand: "Simply Nature", name: "organic black beans" },
  { sku: "Simply Nature organic peanut butter", brand: "Simply Nature", name: "organic peanut butter" },
  { sku: "Simple Truth organic sour cream", brand: "Simple Truth", name: "organic sour cream" },
  { sku: "bananas", brand: null, name: "bananas" },
  { sku: "green onions", brand: null, name: "green onions", aliases: ["scallions", "spring onions"] },
];
const shop = buildCatalog(SHOP);

describe("resolve: what the shop sells", () => {
  it("names the sku when the reading is the entry", () => {
    const verdict = resolve({ name: "rigatoni", brand: "Priano" }, shop);
    expect(verdict.status).toBe("matched");
    expect(verdict.status === "matched" && verdict.sku).toBe("Priano rigatoni");
  });

  it("names the sku when the reading words it differently", () => {
    const verdict = resolve({ name: "cream of mushroom soup", brand: "Campbell's" }, shop);
    expect(verdict.status === "matched" && verdict.sku).toBe("Campbell's cream of mushroom condensed soup");
  });

  it("names the sku through an alias", () => {
    const verdict = resolve({ name: "bronze cut pasta", brand: "Priano" }, shop);
    expect(verdict.status === "matched" && verdict.sku).toBe("Priano fusilli bucati");
  });

  it("names the sku for loose produce, which has no brand to check", () => {
    expect(resolve({ name: "bananas", brand: null }, shop).status).toBe("matched");
    const onions = resolve({ name: "scallions", brand: null }, shop);
    expect(onions.status === "matched" && onions.sku).toBe("green onions");
  });

  it("survives one wrong letter, which is what reading a label at distance costs", () => {
    const verdict = resolve({ name: "linguini", brand: "Barilla" }, shop);
    expect(verdict.status === "matched" && verdict.sku).toBe("Barilla linguine");
  });

  it("reads the brand out of the name when the reading did not separate it", () => {
    const verdict = resolve({ name: "Barilla thick spaghetti", brand: null }, shop);
    expect(verdict.status === "matched" && verdict.sku).toBe("Barilla thick spaghetti");
  });
});

describe("resolve: reading a label imperfectly", () => {
  it("matches a word to the word it is an inflection of", () => {
    // "creamed mushrooms" for "cream of mushroom soup". One is a prefix of the other and the
    // shared part is long enough to be the word rather than a coincidence of two short ones.
    const verdict = resolve({ name: "creamed mushrooms", brand: "Campbells" }, shop);
    expect(verdict.status === "matched" && verdict.sku).toBe("Campbell's cream of mushroom condensed soup");
  });

  it("corrects a misread brand to the one the shop stocks", () => {
    // A stylised PRIANO reads as "Piano". The shop sells no Piano, sells Priano, and the two are
    // one letter apart, so the catalog is better evidence than the reading.
    const verdict = resolve({ name: "rigatoni", brand: "Piano" }, shop);
    expect(verdict.status === "matched" && verdict.sku).toBe("Priano rigatoni");
  });

  it("reads a brand with its apostrophe gone as the same brand", () => {
    // The reader writes "Bobs Red Mill" and "Campbells" for packaging that prints an apostrophe.
    // Folding the apostrophe to a space instead of away splits the first word off the brand.
    const verdict = resolve({ name: "organic quinoa", brand: "Bobs Red Mill" }, shop);
    expect(verdict.status === "matched" && verdict.sku).toBe("Bob's Red Mill organic white quinoa");
  });

  it("does not treat two of the shop's brands as one because they share a word", () => {
    // Happy Farms and Friendly Farms are both this shop's own labels. "Farms" is what they have
    // in common and is exactly the part that carries no identity.
    const verdict = resolve({ name: "neufchatel cheese", brand: "Friendly Farms" }, shop);
    expect(verdict.status).not.toBe("matched");
  });

  it("keeps loose produce when the reading put a packer's name on it", () => {
    // Rule 3 of the census prompt forbids inventing a distributor for loose produce and the model
    // does it anyway. The shop's catalog has no brand on bananas; that is a reason to doubt the
    // brand, not to doubt that these are bananas.
    const verdict = resolve({ name: "organic bananas", brand: "Robinson Fresh" }, shop);
    expect(verdict.status === "matched" && verdict.sku).toBe("bananas");
  });
});

describe("resolve: what the shop does not sell", () => {
  it("declines a product that is not in the catalog rather than naming the nearest one", () => {
    const verdict = resolve({ name: "unlabelled pull-tab tin", brand: null }, shop);
    expect(verdict.status).toBe("absent");
  });

  it("declines when the brand is a brand this shop stocks and the pairing is not", () => {
    // The shop sells rigatoni, and it sells Kroger products. It sells no Kroger rigatoni, and
    // answering "Priano rigatoni" here would launder a misread brand into a confident SKU.
    const verdict = resolve({ name: "rigatoni", brand: "Kroger" }, shop);
    expect(verdict.status).not.toBe("matched");
  });

  it("declines a plausible product from a range the shop does not carry", () => {
    expect(resolve({ name: "gnocchi", brand: "Priano" }, shop).status).toBe("absent");
  });
});

describe("resolve: what the shop sells two of", () => {
  it("declines when the reading fits two varieties equally", () => {
    // "avocado oil crackers" is both entries and neither. The photograph settles it or nothing does.
    const verdict = resolve({ name: "avocado oil crackers", brand: "Savoritz" }, shop);
    expect(verdict.status).toBe("ambiguous");
    expect(verdict.status === "ambiguous" && verdict.candidates.length).toBeGreaterThan(1);
  });

  it("picks the variety when the reading carries it", () => {
    const verdict = resolve({ name: "avocado oil crackers, sea salt", brand: "Savoritz" }, shop);
    expect(verdict.status === "matched" && verdict.sku).toBe("Savoritz avocado oil crackers sea salt");
  });

  it("does not treat a longer entry name as a tie with the shorter one it contains", () => {
    const verdict = resolve({ name: "spaghetti", brand: "Barilla" }, shop);
    expect(verdict.status === "matched" && verdict.sku).toBe("Barilla spaghetti");
  });
});

describe("resolve: no catalog", () => {
  it("says it was not consulted, which is not the same as finding nothing", () => {
    expect(resolve({ name: "rigatoni", brand: "Priano" }, null).status).toBe("not-consulted");
  });

  it("says the same for a catalog with no entries in it", () => {
    expect(resolve({ name: "rigatoni", brand: "Priano" }, buildCatalog([])).status).toBe("not-consulted");
  });
});

describe("shortlist", () => {
  it("is ordered best first and bounded", () => {
    const candidates = shortlist({ name: "avocado oil crackers", brand: "Savoritz" }, shop, 3);
    expect(candidates.length).toBeLessThanOrEqual(3);
    expect(candidates[0].sku).toContain("avocado oil crackers");
    for (let i = 1; i < candidates.length; i += 1) expect(candidates[i - 1].score).toBeGreaterThanOrEqual(candidates[i].score);
  });

  it("does not offer a product whose brand contradicts the one that was read", () => {
    // The shortlist exists so a crop can settle which variety of a range it is looking at, not so
    // it can be handed a different brand to choose. Offered "Benton's chocolate chip cookies" for
    // a box both readings called Baker's Corner, the close read copied it back and the line was
    // asserted under a brand nothing had read (clut8, 2026-09-09).
    const offered = shortlist({ name: "chocolate chip cookies", brand: "Baker's Corner" }, shop);
    expect(offered.map((c) => c.sku)).not.toContain("Benton's chocolate chip cookies");
  });

  it("still offers a brand when none was read, which is what a crop can settle", () => {
    expect(shortlist({ name: "chocolate chip cookies", brand: null }, shop).map((c) => c.sku))
      .toContain("Benton's chocolate chip cookies");
  });

  it("offers nothing the text would not have accepted on its own", () => {
    // A crop is shown the shop's rows so it can choose between products the text could not
    // separate. It is not shown them so it can be talked into a near miss: offered "Friendly
    // Farms cottage cheese" for a tub both readings called Friendly Farms neufchatel, the close
    // read copied it back and the shopper got cottage cheese (clut12, 2026-09-09).
    const offered = shortlist({ name: "neufchatel cheese", brand: "Friendly Farms" }, shop);
    expect(offered.map((c) => c.sku)).not.toContain("Friendly Farms cottage cheese");
  });

  it("offers nothing for a reading that resembles nothing in the shop", () => {
    expect(shortlist({ name: "motor oil", brand: "Castrol" }, shop, 5)).toEqual([]);
  });

  it("puts every entry's own name at the top of its own shortlist", () => {
    for (const entry of SHOP) {
      const top = shortlist({ name: entry.name, brand: entry.brand }, shop, 1)[0];
      expect(top?.sku, entry.sku).toBe(entry.sku);
    }
  });
});
