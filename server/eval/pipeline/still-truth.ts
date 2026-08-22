/**
 * What is really in each still, and how to score a bag against it.
 *
 * Lifted out of `census-live.ts` unchanged so more than one harness can use it. The immediate
 * reason is `local-census-bag.ts`, which reported units only: a right total is not a right bag, and
 * a detector change that finds one more real product while inventing one more line looks identical
 * to one that invents two, until contents are scored.
 *
 * Two tiers on purpose. `strong` is a word only the real product would produce. `weak` accepts
 * words this trolley shares between two products, or that the photograph genuinely cannot settle;
 * both numbers are reported so neither hides the other.
 */
export type Truth = { id: string; strong: string[]; weak: string[] };
const CAULIFLOWER: Truth = { id: 'Mr Lucky cauliflower', strong: ['cauliflower'], weak: ['lucky'] };
const SPROUTS: Truth = { id: 'brussels sprouts bag', strong: ['brussels', 'sprout'], weak: ['green leafy', 'lettuce'] };
const ASPARAGUS: Truth = { id: 'asparagus bag', strong: ['asparagus'], weak: ['green bean', 'stalk'] };
// The purple bag is printed "WEST GROWN FUJI, Sure to please!" and holds red apples.
const FUJI: Truth = { id: 'Fuji apple bag', strong: ['fuji', 'purple'], weak: ['red apple', 'apple', 'produce bag'] };
const GRANNY: Truth = { id: 'Granny Smith apple bag', strong: ['granny'], weak: ['green apple', 'apple'] };
const SEEDTASTIC: Truth = { id: 'Seedtastic bread', strong: ['seedtastic'], weak: ['bread', 'loaf'] };
const BAGUETTE: Truth = { id: 'baguette', strong: ['baguette'], weak: ['bread'] };
const YELLOW: Truth = { id: 'yellow produce bag', strong: ['yellow'], weak: ['produce bag'] };

export const TRUTH: Record<string, Truth[]> = {
  // The four shelf photographs. Their truth is genuinely empty: a shelf is not a cart, so the
  // right bag holds nothing and every line in it is spurious. Present so `subjectIsCart` is
  // guarded here and not only in `shelf-census.ts` (see corpus/kart/counts.json).
  IMG_0247: [],
  IMG_0248: [],
  IMG_0250: [],
  IMG_0251: [],
  IMG_0244: [CAULIFLOWER],
  IMG_0245: [CAULIFLOWER],
  IMG_0246: [CAULIFLOWER, SPROUTS],
  IMG_0249: [CAULIFLOWER, SPROUTS, ASPARAGUS],
  IMG_0252: [
    { id: 'Oreo party size', strong: ['oreo'], weak: [] },
    BAGUETTE, FUJI, YELLOW, GRANNY, SEEDTASTIC, ASPARAGUS, SPROUTS, CAULIFLOWER,
  ],
  IMG_0254: [
    { id: 'egg carton', strong: ['egg'], weak: [] },
    { id: 'egg carton (second)', strong: ['egg'], weak: [] },
    { id: 'Muenster cheese', strong: ['muenster'], weak: ['cheese'] },
    { id: 'Muenster cheese (second)', strong: ['muenster'], weak: ['cheese'] },
    { id: 'beef pack', strong: ['beef', 'steak'], weak: ['meat'] },
    BAGUETTE,
    { id: 'jar', strong: ['jar'], weak: ['peanut butter', 'sauce', 'spread'] },
    GRANNY, SEEDTASTIC, ASPARAGUS,
    { id: 'Alaskan sockeye salmon', strong: ['salmon', 'sockeye'], weak: ['fish', 'seafood'] },
    CAULIFLOWER, FUJI, YELLOW,
    // counts.json calls this broccoli. Zoomed to native resolution the bag shows green contents
    // behind leaf-print graphics and a 1 LB weight, and no legible product name, so what it holds
    // cannot be read off the photograph. Both models miss "broccoli" on nearly every pass and
    // gpt-5.4 twice answered "brussels sprouts" for it, which the strict tier would score as an
    // invention. The weak tier exists for exactly this: strict still demands the word the truth
    // claims, and the lenient number accepts any bagged green the photograph could support.
    { id: 'broccoli (a bagged green, label not legible)', strong: ['broccoli'],
      weak: ['brussels', 'sprout', 'green bean', 'spring mix', 'romaine', 'lettuce', 'salad', 'greens'] },
  ],
};

export function scoreContents(lines: { name: string; qty: number }[], truth: Truth[]) {
  const left = lines.map((l) => Math.max(1, l.qty));
  const found = new Map<number, 'strong' | 'weak'>();
  for (const tier of ['strong', 'weak'] as const) {
    truth.forEach((product, t) => {
      if (found.has(t)) return;
      const at = lines.findIndex((l, i) => left[i] > 0 && product[tier].some((w) => l.name.includes(w)));
      if (at >= 0) { left[at] -= 1; found.set(t, tier); }
    });
  }
  const strict = [...found.values()].filter((v) => v === 'strong').length;
  return {
    strict,
    lenient: found.size,
    missing: truth.filter((_, t) => !found.has(t)).map((p) => p.id),
    // Units left over after every real product has been satisfied: things in the bag that are not
    // in the trolley, counted in units rather than lines so a qty-2 invention counts twice.
    spurious: lines.flatMap((l, i) => (left[i] > 0 ? [`${l.name}${left[i] > 1 ? ` x${left[i]}` : ''}`] : [])),
  };
}
