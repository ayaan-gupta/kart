/**
 * Scores one photograph's bag lines against its labels. Shared by `clut-photos.ts`, which scores
 * the shipped pipeline, and `plain-baseline.ts`, which scores a bare model call, so a number
 * from either means the same thing.
 *
 * The first version of this lived inline in `clut-photos.ts` and handed every matching line to
 * the first label that matched it. Two labels sharing a generic phrase ("cracker", "milk",
 * "beef") could then never both be found: the first claimed every line, was scored with a
 * doubled quantity, and the second was scored as a miss. Five model arms on 2026-09-05 all
 * "missed" the second Savoritz box, all "over-counted" the first, and all had listed two boxes
 * of crackers. It also compared accented text raw, so "Neufchâtel" never matched "neufchatel".
 *
 * Lines are now assigned one label each:
 *   1. a line whose best-matching label is strictly more specific than any other goes there;
 *   2. a line tied between labels goes to the tied label with the fewest lines so far;
 *   3. a line the photograph's ignore list also covers (a jar of loose spaghetti beside the
 *      Barilla box) goes to a label only if that label has nothing yet, otherwise it is ignored;
 *   4. a line matching no label is ignored if the ignore list covers it, else counted as invented.
 */

export interface ScoreLabel {
  label: string;
  brand: string | null;
  qty: number | [number, number];
  match: string[];
  brandMatch: string[] | null;
  hidden: boolean;
  legible: boolean;
}

export interface ScoreLine {
  name: string;
  brand: string | null;
  qty: number;
  confidence?: number;
}

export interface ScoreImage {
  products: ScoreLabel[];
  ignoreMatch: string[];
}

export interface ImageScore {
  found: number;
  qtyRight: number;
  brandRight: number;
  brandScored: number;
  misses: string[];
  qtyWrong: { label: string; expected: string; actual: number }[];
  brandWrong: { label: string; expected: string; actual: string | null }[];
  unmatchedLines: ScoreLine[];
  ignoredLines: ScoreLine[];
  /** Label index to the indexes of the lines assigned to it. */
  assigned: Map<number, number[]>;
}

/** Lowercase ASCII words: accents folded, punctuation dropped, whitespace collapsed. */
export const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function qtyOk(actual: number, expected: number | [number, number]): boolean {
  return Array.isArray(expected) ? actual >= expected[0] && actual <= expected[1] : actual === expected;
}

export const qtyText = (expected: number | [number, number]): string =>
  Array.isArray(expected) ? `${expected[0]}-${expected[1]}` : String(expected);

const hayOf = (line: ScoreLine): string => `${norm(line.brand ?? '')} ${norm(line.name)}`;

/** How specifically a label's phrases match a line: the longest matching phrase, or 0. */
function specificity(hay: string, label: ScoreLabel): number {
  let best = 0;
  for (const m of label.match) {
    const phrase = norm(m);
    if (phrase.length > best && hay.includes(phrase)) best = phrase.length;
  }
  return best;
}

export function scoreImage(lines: ScoreLine[], image: ScoreImage): ImageScore {
  const { products, ignoreMatch } = image;
  const assigned = new Map<number, number[]>();
  const give = (label: number, line: number) => assigned.set(label, [...(assigned.get(label) ?? []), line]);
  const count = (label: number) => assigned.get(label)?.length ?? 0;

  const hays = lines.map(hayOf);
  const ignorable = hays.map((hay) => ignoreMatch.some((m) => hay.includes(norm(m))));
  const specs = hays.map((hay) => products.map((p) => specificity(hay, p)));

  /** The labels this line matches best, and whether that best is unique. */
  const bestOf = (i: number): { labels: number[]; unique: boolean } => {
    const best = Math.max(0, ...specs[i]);
    if (best === 0) return { labels: [], unique: false };
    const labels = specs[i].map((s, l) => (s === best ? l : -1)).filter((l) => l >= 0);
    return { labels, unique: labels.length === 1 };
  };
  const fewest = (labels: number[]): number =>
    labels.reduce((keep, l) => (count(l) < count(keep) ? l : keep), labels[0]);

  const pending: number[] = [];
  const ignoredLines: ScoreLine[] = [];
  const unmatchedLines: ScoreLine[] = [];

  // Passes 1 and 2: lines the ignore list does not cover, specific ones first.
  const plain = lines.map((_, i) => i).filter((i) => !ignorable[i]);
  for (const i of plain) {
    const { labels, unique } = bestOf(i);
    if (labels.length === 0) unmatchedLines.push(lines[i]);
    else if (unique) give(labels[0], i);
    else pending.push(i);
  }
  for (const i of pending) give(fewest(bestOf(i).labels), i);

  // Pass 3: lines the ignore list covers reach a label only when it has nothing yet.
  for (let i = 0; i < lines.length; i += 1) {
    if (!ignorable[i]) continue;
    const { labels } = bestOf(i);
    const empty = labels.filter((l) => count(l) === 0);
    if (empty.length > 0) give(fewest(empty), i);
    else ignoredLines.push(lines[i]);
  }

  const misses: string[] = [];
  const qtyWrong: ImageScore['qtyWrong'] = [];
  const brandWrong: ImageScore['brandWrong'] = [];
  let found = 0;
  let qtyRight = 0;
  let brandRight = 0;
  let brandScored = 0;
  products.forEach((product, l) => {
    const mine = assigned.get(l) ?? [];
    if (mine.length === 0) {
      misses.push(product.label);
      return;
    }
    found += 1;
    const qty = mine.reduce((sum, i) => sum + lines[i].qty, 0);
    if (qtyOk(qty, product.qty)) qtyRight += 1;
    else qtyWrong.push({ label: product.label, expected: qtyText(product.qty), actual: qty });

    // Scored separately from the name, and only where the packaging is legible, because the
    // brand is the field the catalog resolves on: a bag line reading "Primo" for a bag that says
    // PRIANO looks right to a shopper skimming their bag and matches no SKU at all.
    if (product.brandMatch !== null) {
      brandScored += 1;
      const actual = lines[mine[0]].brand;
      const ok = actual !== null && product.brandMatch.some((b) => norm(actual).includes(norm(b)));
      if (ok) brandRight += 1;
      else brandWrong.push({ label: product.label, expected: product.brandMatch[0], actual });
    }
  });

  return { found, qtyRight, brandRight, brandScored, misses, qtyWrong, brandWrong, unmatchedLines, ignoredLines, assigned };
}
