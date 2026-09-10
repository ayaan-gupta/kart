/**
 * The store's product list, and what a reading of a product resolves to in it.
 *
 * The closed-world assumption in CLAUDE.md says the shop's full catalog is known and is the
 * complete set of things that can be in the cart. Two legs can retrieve against it. The image
 * leg (server/catalog/, server/enumerator/) encodes each region with SigLIP and matches picture
 * against picture; it needs a GPU and a Python environment. This is the other leg: the reader
 * already answers in text, the catalog is text, so the match is text against text and runs
 * wherever the service runs.
 *
 * It is deliberately not a namer. Given a reading it answers one of four things:
 *
 *   matched        exactly one entry fits, and it fits clearly better than the next one
 *   ambiguous      two or more entries fit about equally, and the reading does not separate them
 *   absent         nothing in the shop fits; the reading is of something this shop does not sell
 *   not-consulted  there is no catalog, so this says nothing at all
 *
 * Only the first is evidence. The point of the other three is that a resolver which always names
 * its nearest entry has not caught a wrong reading, it has laundered one: "Kroger rigatoni"
 * becomes "Priano rigatoni" and arrives at the shopper with a SKU attached and no doubt on it.
 * `absent` and `ambiguous` are what make the line unsure instead, which is the whole bar.
 *
 * Pure apart from `loadCatalog`, so every rule is pinned in catalog.test.ts with no file and no
 * model call.
 */
import { readFileSync } from "node:fs";

export interface CatalogEntry {
  /** The shop's own identifier for the product, and the string a model is asked to copy back. */
  sku: string;
  brand: string | null;
  name: string;
  size?: string | null;
  /** Other ways the shop's own records name it. Each is matched as a whole alternative name. */
  aliases?: string[];
}

export interface Candidate {
  sku: string;
  /** 0 to 1. Comparable within one query only; it is not a probability. */
  score: number;
}

export type Verdict =
  | { status: "matched"; sku: string; entry: CatalogEntry; score: number; margin: number }
  | { status: "ambiguous"; candidates: Candidate[] }
  | { status: "absent"; best: Candidate | null }
  | { status: "not-consulted" };

export interface Reading {
  name: string;
  brand: string | null;
}

/**
 * Above this an entry is a real fit. Below it the reading describes something the shop does not
 * sell, and the honest answer is `absent` rather than the nearest row.
 */
const ACCEPT = 0.62;
/**
 * The best entry must beat the second by this much. Two varieties of one range score alike when
 * the reading names the range and not the variety ("avocado oil crackers", when the shop sells
 * them in sea salt and in rosemary), and choosing between them by a thousandth of a score is
 * choosing at random.
 */
const MARGIN = 0.08;
/**
 * Below this an entry is not worth showing a model as a candidate: `ACCEPT`, the same bar the
 * text alone has to clear.
 *
 * A shortlist exists so that a crop can choose between products the text could not separate,
 * each of which the text would have accepted on its own had the others not been there. It is not
 * a second chance for an entry the text rejected. Offered "Friendly Farms cottage cheese" at a
 * score of 0.36 for a tub both readings had called Friendly Farms neufchatel, the close read
 * copied it back and the shopper was shown cottage cheese, asserted (clut12, 2026-09-09).
 *
 * The consequence is that a shortlist is non-empty exactly when the resolution was ambiguous: one
 * entry over the bar and clear of the next is already `matched`, and nothing over the bar is
 * already `absent`.
 */
const SHORTLIST_FLOOR = ACCEPT;
/** What a name scores against an entry of a different brand: near enough to a veto. */
const BRAND_MISMATCH = 0.3;
/** Candidates offered to a model for one reading. Matches SHOWN_CANDIDATES in prompts.ts. */
export const SHORTLIST_SIZE = 5;

/** A fuzzy token match is worth slightly less than an exact one, so exact always wins a tie. */
const FUZZY_QUALITY = 0.85;
/**
 * What a word no entry in the shop uses is worth.
 *
 * Inverse document frequency says a rarer word is a more telling one, and at a frequency of zero
 * it says the most telling word in a reading is one the shop's vocabulary does not contain. That
 * is right for "which entry is this" and wrong for "is this any entry at all", and the two
 * questions are already answered separately here: entry coverage is what rejects a reading of
 * something the shop does not sell, and it is zero for such a reading whatever this number is.
 * So an unknown word is treated as a middling one, and "organic bananas" stays bananas while
 * "unlabelled pull-tab tin" still matches nothing.
 */
const UNKNOWN_WORD_WEIGHT = 0.25;

/** Words that are in the catalog's grammar rather than in any product's identity. */
const STOPWORDS = new Set(["of", "and", "the", "a", "an", "with", "in", "for", "oz", "lb", "ct", "g", "kg", "ml", "count", "pack", "size"]);

export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    // An apostrophe is dropped rather than spaced, the way `productKey` drops it in the app.
    // Spaced, "Bob's Red Mill" becomes four words beginning "bob" and "s", which no reading of
    // that packaging ever writes, and the brand stops matching itself.
    .replace(/['\u2018\u2019\u02bc]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Crude singular. "crackers" and "cracker" are one word; "glass" and "gla" are not. */
function stem(word: string): string {
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function tokens(text: string): string[] {
  return fold(text)
    .split(" ")
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .map(stem);
}

/** Levenshtein, bounded: anything past `max` is reported as `max + 1` without finishing. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost);
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    previous = row;
  }
  return previous[b.length];
}

/**
 * How well one word answers another: 1 the same word, `FUZZY_QUALITY` one or two letters out, 0
 * otherwise. Reading a label across a basket costs a letter ("linguini" for "linguine"); it does
 * not turn one product into another, so the tolerance stays tight and scales with the word.
 */
function wordQuality(a: string, b: string): number {
  if (a === b) return 1;
  const shortest = Math.min(a.length, b.length);
  if (shortest < 5) return 0;
  // One word inflected from the other: "creamed" for "cream", "roasted" for "roast". `stem` only
  // takes a plural off, and the reader writes the packaging's grammar rather than the catalog's.
  // Five shared letters is long enough that this is morphology and not two short words colliding.
  if (a.startsWith(b) || b.startsWith(a)) return FUZZY_QUALITY;
  const allowed = shortest >= 8 ? 2 : 1;
  return distance(a, b, allowed) <= allowed ? FUZZY_QUALITY : 0;
}

interface Variant {
  tokens: string[];
  weight: number;
}

interface Prepared {
  entry: CatalogEntry;
  brand: string;
  variants: Variant[];
}

export interface Catalog {
  entries: Prepared[];
  /** Folded brand strings, longest first, for reading a brand out of a name that ran the two together. */
  brands: string[];
  weightOf: (token: string) => number;
  /** Whether a word of a brand name belongs to only one of the shop's brands. */
  distinctive: (word: string) => boolean;
}

/**
 * Prepares a shop for matching: one document frequency table over every entry, so a word that
 * half the shop shares ("crackers") counts for less than one only two entries carry ("rosemary").
 * A word in no entry at all keeps full weight, which is what makes "unlabelled pull-tab tin"
 * score near zero instead of matching on "tin".
 */
export function buildCatalog(entries: CatalogEntry[]): Catalog {
  const df = new Map<string, number>();
  const prepared: Prepared[] = entries.map((entry) => {
    const variants = [entry.name, ...(entry.aliases ?? [])].map((text) => ({ tokens: tokens(text), weight: 0 }));
    const seen = new Set(variants.flatMap((v) => v.tokens));
    for (const token of seen) df.set(token, (df.get(token) ?? 0) + 1);
    return { entry, brand: fold(entry.brand ?? ""), variants };
  });
  const weightOf = (token: string): number => {
    const seen = df.get(token) ?? 0;
    return seen === 0 ? UNKNOWN_WORD_WEIGHT : 1 / (1 + Math.log(1 + seen));
  };
  for (const p of prepared) {
    for (const variant of p.variants) variant.weight = variant.tokens.reduce((sum, t) => sum + weightOf(t), 0);
  }
  const brands = [...new Set(prepared.map((p) => p.brand).filter((b) => b.length > 0))].sort((a, b) => b.length - a.length);
  // How many of the shop's brands use each word of a brand name. "Farms" belongs to Happy Farms
  // and to Friendly Farms; "Priano" belongs to one brand and so identifies it.
  const brandDf = new Map<string, number>();
  for (const brand of brands) for (const word of new Set(brand.split(" "))) brandDf.set(word, (brandDf.get(word) ?? 0) + 1);
  const distinctive = (word: string): boolean => (brandDf.get(word) ?? 0) <= 1;
  return { entries: prepared, brands, weightOf, distinctive };
}

/**
 * How much of each side the other explains, combined as a harmonic mean.
 *
 * One direction alone is not enough in either direction. Coverage of the reading alone makes
 * "crackers" a perfect match for "avocado oil crackers sea salt"; coverage of the entry alone
 * makes a long reading match a short entry that is only part of it. Both, and a name has to
 * account for the entry as much as the entry accounts for it.
 */
function similarity(queryTokens: string[], queryWeight: number, variant: Variant, weightOf: (t: string) => number): number {
  if (queryTokens.length === 0 || variant.tokens.length === 0) return 0;
  let matchedQuery = 0;
  for (const q of queryTokens) {
    let best = 0;
    for (const e of variant.tokens) best = Math.max(best, wordQuality(q, e));
    matchedQuery += weightOf(q) * best;
  }
  let matchedEntry = 0;
  for (const e of variant.tokens) {
    let best = 0;
    for (const q of queryTokens) best = Math.max(best, wordQuality(e, q));
    matchedEntry += weightOf(e) * best;
  }
  const p = queryWeight > 0 ? matchedQuery / queryWeight : 0;
  const r = variant.weight > 0 ? matchedEntry / variant.weight : 0;
  return p + r > 0 ? (2 * p * r) / (p + r) : 0;
}

/**
 * What the brand does to a name's score.
 *
 * A brand the reading and the entry both carry and agree on confirms; a brand they both carry
 * and disagree on is close to a veto, because the shop selling rigatoni and the shop selling
 * Kroger products does not make it a shop that sells Kroger rigatoni. A brand only one side
 * carries is neither: the wide pass often cannot read a logo, and loose produce has none.
 */
function brandFactor(queryBrand: string, entryBrand: string, catalog: Catalog): number {
  const { distinctive } = catalog;
  if (queryBrand.length === 0 && entryBrand.length === 0) return 1;
  if (queryBrand.length === 0) return 0.8;
  if (entryBrand.length === 0) {
    // A brand the reading put on a product the shop lists without one. Loose produce is the case:
    // the census prompt forbids inventing a grower for it and the model does it anyway, reading
    // "Robinson Fresh" off a banana sticker. In a closed world a name that is not one of the
    // shop's brands cannot be telling us which of the shop's products this is, so it says nothing
    // either way. A name that *is* one of the shop's brands does say something, and costs.
    return catalog.brands.includes(queryBrand) ? 0.7 : 1;
  }
  if (queryBrand === entryBrand) return 1;
  const [qw, ew] = [queryBrand.split(" "), entryBrand.split(" ")];
  // "Piano" for "Priano", "Bobs Red Mill" for "Bob's Red Mill": the same brand misread. Every
  // word of the shorter name has to answer to one of the other's, and at least one of the words
  // that matched has to be a word only this brand uses. Without that last clause two of the
  // shop's own labels merge on the half of the name that carries no identity, and Friendly Farms
  // neufchatel is asserted as Happy Farms neufchatel.
  const [shorter, longer] = qw.length <= ew.length ? [qw, ew] : [ew, qw];
  let identifying = false;
  for (const word of shorter) {
    const partner = longer.find((other) => wordQuality(word, other) > 0);
    if (partner === undefined) return BRAND_MISMATCH;
    if (distinctive(word) || distinctive(partner)) identifying = true;
  }
  return identifying ? 0.95 : BRAND_MISMATCH;
}

/** The reading's brand: what it reported, or a shop brand printed inside the name it reported. */
function readBrand(reading: Reading, catalog: Catalog): { brand: string; nameTokens: string[]; nameWeight: number } {
  let name = fold(reading.name);
  let brand = fold(reading.brand ?? "");
  if (brand.length === 0) {
    const found = catalog.brands.find((b) => name === b || name.startsWith(`${b} `) || name.includes(` ${b} `) || name.endsWith(` ${b}`));
    if (found !== undefined) brand = found;
  }
  // A brand printed inside the name is not also a word of the product's name. Left in, "Barilla
  // thick spaghetti" carries a token no entry name has, which costs every entry the same and
  // flattens the very margin the resolver decides on.
  if (brand.length > 0) name = ` ${name} `.replace(` ${brand} `, " ").trim();
  const nameTokens = tokens(name);
  return { brand, nameTokens, nameWeight: nameTokens.reduce((sum, t) => sum + catalog.weightOf(t), 0) };
}

function scored(reading: Reading, catalog: Catalog): { sku: string; entry: CatalogEntry; score: number; brandClash: boolean }[] {
  const { brand, nameTokens, nameWeight } = readBrand(reading, catalog);
  return catalog.entries
    .map((prepared) => {
      let best = 0;
      for (const variant of prepared.variants) best = Math.max(best, similarity(nameTokens, nameWeight, variant, catalog.weightOf));
      const factor = brandFactor(brand, prepared.brand, catalog);
      return { sku: prepared.entry.sku, entry: prepared.entry, score: best * factor, brandClash: factor === BRAND_MISMATCH };
    })
    .sort((a, b) => b.score - a.score || a.sku.localeCompare(b.sku));
}

/**
 * The best few entries for a reading, best first, with nothing in it that does not fit at all.
 *
 * An entry whose brand contradicts a brand that was actually read is left out however well its
 * name fits. A shortlist is shown to a model so that a crop can settle which variety of a range
 * it is looking at; it is not a list of other brands to consider. Offered "Benton's chocolate
 * chip cookies" for a box both readings had called Baker's Corner, the close read copied it back
 * and the line reached the shopper asserted under a brand nothing had read (clut8, 2026-09-09).
 * A brand nobody could read is not a contradiction, and those entries stay: that is exactly the
 * question a crop is good at.
 */
export function shortlist(reading: Reading, catalog: Catalog | null, k: number = SHORTLIST_SIZE): Candidate[] {
  if (catalog === null || catalog.entries.length === 0) return [];
  return scored(reading, catalog)
    .filter((c) => !c.brandClash && c.score >= SHORTLIST_FLOOR)
    .slice(0, k)
    .map((c) => ({ sku: c.sku, score: Number(c.score.toFixed(4)) }));
}

export function resolve(reading: Reading, catalog: Catalog | null): Verdict {
  if (catalog === null || catalog.entries.length === 0) return { status: "not-consulted" };
  const ranked = scored(reading, catalog);
  const best = ranked[0];
  if (best === undefined || best.score < ACCEPT) {
    const near = best !== undefined && best.score >= SHORTLIST_FLOOR ? { sku: best.sku, score: Number(best.score.toFixed(4)) } : null;
    return { status: "absent", best: near };
  }
  const second = ranked[1]?.score ?? 0;
  const margin = best.score - second;
  if (margin < MARGIN) {
    return {
      status: "ambiguous",
      candidates: ranked.filter((c) => best.score - c.score < MARGIN).slice(0, SHORTLIST_SIZE).map((c) => ({ sku: c.sku, score: Number(c.score.toFixed(4)) })),
    };
  }
  return { status: "matched", sku: best.sku, entry: best.entry, score: Number(best.score.toFixed(4)), margin: Number(margin.toFixed(4)) };
}

/** Every SKU the shop sells, in file order: what a prompt lists when the shop is small enough. */
export function skus(catalog: Catalog | null): string[] {
  return catalog === null ? [] : catalog.entries.map((p) => p.entry.sku);
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * The shop, from the file `CATALOG_FILE` names, or null when it names none.
 *
 * Null is the normal state and must stay harmless: with no catalog the resolver reports
 * `not-consulted`, nothing downstream changes, and the service answers exactly as it did before
 * this module existed. That is the same contract `enumerateRegions` keeps for the image leg, for
 * the same reason: a missing configuration is not a reason to fail a shopper's photograph.
 *
 * Read once and held, because it is a file the deployment ships and not a per-request input.
 */
let cached: { path: string; catalog: Catalog | null } | null = null;

export function loadCatalog(path: string = (process.env.CATALOG_FILE ?? "").trim()): Catalog | null {
  if (path.length === 0) return null;
  if (cached !== null && cached.path === path) return cached.catalog;
  let catalog: Catalog | null = null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { entries?: unknown };
    const raw = Array.isArray(parsed) ? parsed : parsed.entries;
    if (!Array.isArray(raw)) throw new Error("no entries array");
    const entries: CatalogEntry[] = [];
    for (const item of raw) {
      if (item === null || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const name = typeof row.name === "string" ? row.name.trim() : "";
      const sku = typeof row.sku === "string" && row.sku.trim().length > 0 ? row.sku.trim() : name;
      if (name.length === 0 || sku.length === 0) continue;
      entries.push({
        sku,
        name,
        brand: typeof row.brand === "string" && row.brand.trim().length > 0 ? row.brand.trim() : null,
        size: typeof row.size === "string" ? row.size : null,
        ...(Array.isArray(row.aliases) ? { aliases: row.aliases.filter((a): a is string => typeof a === "string") } : {}),
      });
    }
    catalog = entries.length > 0 ? buildCatalog(entries) : null;
    console.log(`[catalog] ${entries.length} products from ${path}`);
  } catch (error) {
    // The same degraded contract the enumerator keeps: a catalog that cannot be read leaves the
    // service answering open-world, which is worse but is not a failed photograph.
    console.warn(`[catalog] ignored ${path}: ${error instanceof Error ? error.message : "unreadable"}`);
    catalog = null;
  }
  cached = { path, catalog };
  return catalog;
}

/** Test seam: forgets the held catalog so a later load re-reads the file. */
export function forgetCatalog(): void {
  cached = null;
}
