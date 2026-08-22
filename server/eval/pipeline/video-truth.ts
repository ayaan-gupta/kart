/**
 * What is really in the corpus trolley, and how a bag is scored against it.
 *
 * Extracted so `video-census-live.ts` (the census and the bag, on the server's regions) and
 * `scan-loop.ts` (the app's frame loop end to end) score against one definition rather than two
 * that can drift. Both ask the same question of the same trolley and must not answer it
 * differently.
 */
/**
 * What is really in this trolley, and the words a bag line may use for each.
 *
 * A unit count cannot tell a right bag from a lucky one. Run 3 of the six captured answer sets
 * scores nine units against nine products and is still wrong: it holds the Fuji bag twice, once
 * as "Kart purple produce bag" and once as "red apple", and misses the yellow bag and the
 * brussels sprouts. Two errors cancelling is not a correct answer, so the bag is scored by
 * contents here as well as by size.
 *
 * `strong` is a word only this product would use. `weak` is one it shares with another product in
 * this same trolley, which is why both numbers are reported rather than one: "bread" fits the
 * baguette and the Seedtastic loaf, "apple" fits the Granny Smith bag and the Fuji bag, and a
 * scorer that resolves those by itself is inventing the answer it is meant to be checking.
 * Strong matches are assigned first for the same reason.
 */
export const VIDEO_TRUTH: { id: string; strong: string[]; weak: string[] }[] = [
  { id: 'oreo', strong: ['oreo'], weak: [] },
  { id: 'cauliflower', strong: ['cauliflower', 'lucky'], weak: [] },
  { id: 'asparagus', strong: ['asparagus'], weak: [] },
  { id: 'brussels sprouts bag', strong: ['brussels', 'sprout'], weak: ['green leafy', 'lettuce', 'green produce'] },
  { id: 'seedtastic bread', strong: ['seedtastic'], weak: ['bread', 'loaf'] },
  { id: 'baguette', strong: ['baguette'], weak: ['bread'] },
  { id: 'granny smith apple bag', strong: ['granny'], weak: ['green apple', 'apple'] },
  // The purple bag is printed "WEST GROWN FUJI, Sure to please!" and holds red apples.
  { id: 'fuji apple bag', strong: ['fuji', 'purple'], weak: ['red apple', 'apple', 'produce bag'] },
  { id: 'yellow produce bag', strong: ['yellow'], weak: ['produce bag'] },
];

/** Greedy assignment, strong words first, each line used once and each product filled once. */
/**
 * Greedy assignment, unambiguous words first.
 *
 * A line satisfies as many truth entries as its quantity says, and leftover units count as
 * spurious. That matters because a bag line carries a quantity: the shipped path returns
 * "2 x long loaf of bread in clear plastic wrap", which is two units on one line. Counting lines
 * would credit that as one product and, worse, count one spurious unit where there are two. The
 * photograph scorer in `census-live.ts` was fixed the same way after it understated both models;
 * this copy was extracted before that fix and had drifted from it.
 */
export function scoreContents(lines: { name: string; qty: number }[]) {
  const left = lines.map((l) => Math.max(1, l.qty));
  const found = new Map<string, { line: number; tier: 'strong' | 'weak' }>();
  for (const tier of ['strong', 'weak'] as const) {
    for (const product of VIDEO_TRUTH) {
      if (found.has(product.id)) continue;
      const words = product[tier];
      const at = lines.findIndex((l, i) => left[i] > 0 && words.some((w) => l.name.includes(w)));
      if (at >= 0) { left[at] -= 1; found.set(product.id, { line: at, tier }); }
    }
  }
  const strict = [...found.values()].filter((v) => v.tier === 'strong').length;
  // Units left over once every real product is satisfied, so a qty-2 invention counts twice.
  const spurious = lines.flatMap((l, i) => (left[i] > 0 ? [`${l.name}${left[i] > 1 ? ` x${left[i]}` : ''}`] : []));
  return { found, strict, lenient: found.size, spurious };
}
