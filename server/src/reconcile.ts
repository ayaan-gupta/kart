/**
 * Two readings of one product, and whether they agree well enough to assert it.
 *
 * The wide reading is what the photo census said about the whole photograph. The close reading
 * is what the same model said about a crop of just this product, cut at the box the wide pass
 * gave, at the photograph's own resolution. A line is shown to the shopper as sure only when
 * the two agree on the product, the brand and the count, neither would bet against itself, and
 * the count is one: agreement on more than one is not a second witness (see below).
 * Everything else is unsure, which the app shows in amber and asks for a better photograph of.
 *
 * Since 2026-09-12 a count above one can be asserted after all, by a fourth question asked only
 * where the close read counted more than one package: the same crop again, anchored on the
 * product by name, one entry per package with a point and a few words read off each. A count it
 * agrees with has been counted twice by two methods rather than once by two readings. The same
 * answer separates two varieties of one range that both readings called two of the first, and
 * `splitByUnits` turns that into one line each. Measured in server/eval/CLUT.md, "Something else
 * to separate the packages".
 *
 * Measured reason for the rule (server/eval/CLUT.md, "Read wide, then read close"): the wide
 * pass's own confidence does not separate its right lines from its wrong ones. It read a
 * stylised PRIANO as "Piano" at 0.97 and a jar of Simply Nature marinara as "Murphy's Naturals"
 * at 0.9. What does separate them is a second reading that disagrees.
 *
 * Since 2026-09-09 a third reading is consulted when the shop's catalog is configured: the two
 * readings say what the product is, and the catalog says which of the things this shop sells that
 * is, if any. It can only take a line's certainty away, never grant it. A line the two readings
 * agreed on that the shop cannot account for, or that fits two of its products equally, is unsure.
 *
 * Measured reason for the rule, over the lines of two recorded runs on the fifteen clut
 * photographs (server/eval/pipeline/catalog-replay.ts): of the sixteen lines those runs asserted
 * that were wrong, the catalog declines fourteen. It costs eleven of the fifty-nine right lines,
 * each of which is a shopper asked for a second photograph of something already correct. The two
 * it does not catch are quantity errors, which are outside what a text catalog can see: both read
 * one box of Priano rigatoni where there were two, and one box of Priano rigatoni is a thing the
 * shop sells.
 *
 * Pure, so every branch is pinned in reconcile.test.ts without a model call.
 */
import type { Box } from "./compositor.js";
import { resolve, shortlist, type Catalog } from "./catalog.js";
import type { VerifyResponse } from "./schemas.js";

/** The same line the bag draws: below this a line is unsure. Mirrors UNSURE_BELOW in fusion.ts. */
export const UNSURE_BELOW = 0.6;

/** What a disagreement is reported at: below the line, with room under it for "no reading at all". */
const DISAGREED_CONFIDENCE = 0.5;

export interface WideReading {
  description: string;
  brand: string | null;
  count: number;
  confidence: number;
}

export interface ReconciledLine {
  description: string;
  brand: string | null;
  count: number;
  /** Reconciled: the mean of the two when they agree, capped below the unsure line when they do not. */
  confidence: number;
  /** True exactly when `confidence` is at or above the unsure line. */
  sure: boolean;
  /** Whether a close reading existed and agreed with the wide one. */
  agreed: boolean;
  /** The store product this line resolved to, or null when it resolved to none. */
  sku: string | null;
  /**
   * What the catalog said. "matched" is the text of the two readings resolving to one product;
   * "picked" is the close read choosing between products the text could not separate;
   * "not-consulted" is a deployment with no catalog, where this whole leg is inert.
   */
  catalog: "matched" | "picked" | "ambiguous" | "absent" | "not-reached" | "not-consulted";
}

/**
 * Whether a count the two readings agreed on still needs the shopper to check it: any count above
 * one, for the reason given where `reconcile` asks. Exported so that count-replay.ts replays the
 * rule that ships rather than a copy of it.
 */
export function countNeedsCheck(count: number): boolean {
  return count > 1;
}

/**
 * One package the unit pass pointed at: a few words read off it, and where it is in the crop on
 * the [0, 1000] scale Qwen3-VL's grounding is trained on.
 */
export interface UnitReading {
  label: string;
  x: number;
  y: number;
}

/** A line the unit pass separated out of another, with its own share of the parent's box. */
export type SplitLine = ReconciledLine & { box: Box };

/** Words folded the way `foldBrand` and the bag's keys fold them, dropping the very short ones. */
function words(label: string): Set<string> {
  return new Set(
    label
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

/**
 * The packages the unit pass found, folded to one entry per product.
 *
 * One label's words being all of another's is one product written twice: a bag photographed from
 * the side reads "Rigatoni Authentic Italian" and the one behind it reads "Priano Rigatoni
 * Authentic Italian", and those are two of one thing. Two varieties of one range each keep a word
 * the other lacks, "sea salt" against "rosemary sourdough", and stay apart. That distinction is
 * the whole reason this pass exists, so it is drawn here and not by string equality.
 */
export function unitGroups(units: UnitReading[]): { label: string; count: number }[] {
  const groups: { label: string; tokens: Set<string>; count: number }[] = [];
  for (const unit of units) {
    const tokens = words(unit.label);
    const into = groups.find((g) => {
      const [small, big] = g.tokens.size <= tokens.size ? [g.tokens, tokens] : [tokens, g.tokens];
      return small.size > 0 && [...small].every((t) => big.has(t));
    });
    if (into === undefined) groups.push({ label: unit.label, tokens, count: 1 });
    else {
      into.count += 1;
      // The fuller wording wins, since it is the one that names the product rather than a phrase
      // off the side of the packet.
      if (tokens.size > into.tokens.size) {
        into.label = unit.label;
        into.tokens = tokens;
      }
    }
  }
  return groups.map((g) => ({ label: g.label, count: g.count }));
}

/** Whether the unit pass counted the same number of one product that the two readings did. */
function unitsConfirm(units: UnitReading[], count: number): boolean {
  const groups = unitGroups(units);
  return groups.length === 1 && groups[0].count === count;
}

/**
 * One line per variety, when the crop held more than one.
 *
 * Null when there is nothing to separate, which is the ordinary case. A split line is never
 * asserted: the close read confirmed one product under one name, and these are names only this
 * pass has read, so the review shows them amber and asks the shopper to check. Measured on the
 * fifteen clut photographs, the split finds a product the bag was missing and corrects the
 * quantity of the one it was hiding behind.
 *
 * Each line gets its own share of the parent's box so the review does not draw two rectangles on
 * top of each other. The share is cut along the axis the packages are spread on, which for two
 * boxes of crackers side by side is the width and for two tins stacked is the height.
 */
export function splitByUnits(line: ReconciledLine, units: UnitReading[], box: Box): SplitLine[] | null {
  const groups = unitGroups(units);
  if (groups.length < 2) return null;

  const first = (label: string): UnitReading => units.find((u) => u.label === label) ?? units[0];
  const points = groups.map((g) => first(g.label));
  const spread = (get: (u: UnitReading) => number): number =>
    Math.max(...points.map(get)) - Math.min(...points.map(get));
  const horizontal = spread((u) => u.x) >= spread((u) => u.y);
  const share = 1 / groups.length;
  const w = horizontal ? box.w * share : box.w;
  const h = horizontal ? box.h : box.h * share;

  return groups.map((group, i) => {
    const point = points[i];
    const centreX = box.x + (Math.min(1000, Math.max(0, point.x)) / 1000) * box.w;
    const centreY = box.y + (Math.min(1000, Math.max(0, point.y)) / 1000) * box.h;
    return {
      ...line,
      description: group.label,
      count: group.count,
      sure: false,
      box: {
        x: Math.min(box.x + box.w - w, Math.max(box.x, centreX - w / 2)),
        y: Math.min(box.y + box.h - h, Math.max(box.y, centreY - h / 2)),
        w,
        h,
      },
    };
  });
}

/** Brands compared the way `productKey` compares them: no case, accents or punctuation. */
function foldBrand(brand: string | null): string {
  return (brand ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function reconcile(
  wide: WideReading,
  close: VerifyResponse | null,
  catalog: Catalog | null = null,
  units: UnitReading[] = [],
): ReconciledLine {
  const unsure = (over: Partial<ReconciledLine> = {}): ReconciledLine => ({
    description: wide.description,
    brand: wide.brand,
    count: wide.count,
    confidence: Math.min(DISAGREED_CONFIDENCE, wide.confidence, close?.confidence ?? 1),
    sure: false,
    agreed: false,
    sku: null,
    // Reached the catalog or not: a line the two readings already disagreed on never gets that
    // far, and reporting it as "not-consulted" would read as a deployment with no catalog, which
    // is how the whole leg reports itself being off.
    catalog: catalog === null ? "not-consulted" : "not-reached",
    ...over,
  });

  if (close === null) return unsure();

  // A close reading that could actually read the label is the better witness to the brand, so
  // its brand is shown whether or not the two agree. One that could not read it says nothing
  // about the brand, and the wide reading stands.
  const closeReadLabel = close.legible && close.confidence >= UNSURE_BELOW;
  const brand = closeReadLabel ? (close.brand ?? wide.brand) : wide.brand;

  // The crop is not what the wide pass said it was. When the close read could read what it is,
  // the line becomes that, unsure, so the review draws the right name on the box; when it could
  // not, the wide reading stands, unsure. The count is the close read's: it counted what is there.
  if (!close.matchesHint) {
    return closeReadLabel ? unsure({ description: close.name, brand: close.brand, count: close.count }) : unsure({ count: close.count });
  }

  // Unreadable packaging is a reason not to assert a brand, and only that. Loose produce has no
  // text to read, and a close read that calls a bunch of green onions illegible has not doubted
  // that they are green onions.
  const brandInPlay = foldBrand(wide.brand).length > 0 || foldBrand(close.brand).length > 0;
  if (!close.legible && brandInPlay) return unsure({ brand });

  const wideBrand = foldBrand(wide.brand);
  const closeBrand = foldBrand(close.brand);
  // Both read a brand and read different ones: a disagreement. One side null is not: the wide
  // pass may have left the brand out of a description, and the close pass may not see the logo.
  if (wideBrand.length > 0 && closeBrand.length > 0 && wideBrand !== closeBrand) return unsure({ brand });

  // The close read counted on its own and was not told the wide count, so a different count is
  // a real disagreement. Neither count is trusted then: on the fifteen photographs the wide pass
  // was wrong on stacked bags and the close read was wrong on a neighbour of the same brand cut
  // into the crop, about equally. The wide count stays on the line, and the line is unsure, which
  // is what a second photograph of that item settles.
  if (close.count !== wide.count) return unsure({ brand });

  if (wide.confidence < UNSURE_BELOW || close.confidence < UNSURE_BELOW) {
    return unsure({ brand, confidence: Math.min(wide.confidence, close.confidence) });
  }

  // A count above one that both readings agree on has still had one witness, not two: the crop is
  // cut from the same pixels the wide pass counted, and Qwen reads look-alike varieties of one
  // range as the same product in both. On clut9 on 2026-09-11 a box of rosemary sourdough
  // crackers standing behind a box of sea salt became "2 x sea salt" in the wide pass and the close
  // read alike, and was asserted. The count stays on the line and the shopper is asked to check
  // it. Replayed over every saved run (server/eval/pipeline/count-replay.ts) this holds back no
  // line of one and every line of more than one; see CLUT.md for what that costs.
  // Unless a third question at the same crop counted the packages one by one and got the same
  // number. Two readings of a count are one witness because both read the whole crop the same
  // way; a pass that points at each package and is asked what is printed on it is a different
  // method, and a count two methods agree on has been counted twice.
  if (countNeedsCheck(wide.count) && !unitsConfirm(units, wide.count)) return unsure({ brand });

  // The two readings agree. What the shop sells is the last question and the only one that can
  // still take the line back: the close read is asked the same question the wide pass was, so two
  // readings of a jar of Simply Nature marinara can agree on "Murphy's Naturals" and be sure of
  // it. A shop stocking no such product is evidence neither reading holds on its own.
  const agreed = {
    description: wide.description,
    brand,
    count: wide.count,
    confidence: (wide.confidence + close.confidence) / 2,
    agreed: true,
  };
  const verdict = resolve({ name: wide.description, brand }, catalog);
  if (verdict.status === "absent" || verdict.status === "ambiguous") {
    // Text could not settle it, which is not the same as the crop not settling it. The close read
    // was shown the shop's own rows for this product and may copy one back; honouring only a SKU
    // that was actually offered is what keeps this a choice between retrieved rows rather than a
    // second chance to name a product. Nothing was offered when nothing was plausible, and then
    // there is nothing to choose and the line stays unsure.
    const offered = shortlist({ name: wide.description, brand }, catalog);
    const picked = offered.find((c) => c.sku === close.catalogSku);
    if (picked !== undefined) return { ...agreed, sure: true, sku: picked.sku, catalog: "picked" };
    return unsure({ ...agreed, confidence: Math.min(DISAGREED_CONFIDENCE, agreed.confidence), catalog: verdict.status });
  }
  return { ...agreed, sure: true, sku: verdict.status === "matched" ? verdict.sku : null, catalog: verdict.status };
}
