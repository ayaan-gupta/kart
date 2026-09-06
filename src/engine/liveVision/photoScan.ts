/**
 * One photograph into the shopper's bag.
 *
 * This is the capture path reduced to its smallest honest form: the shopper frames a photograph
 * themselves, presses a button, and what the census names goes in the bag. Everything the live
 * path does to decide *which* frame to spend a call on has no job here, because the shopper
 * already decided. No sharpness gate, no motion gate, no keyframe pacing, no call ceiling, no
 * tracker.
 *
 * None of that machinery is removed or bypassed on the live path. `scan.tsx` and the modules it
 * drives are untouched; this is a second, simpler caller of the same recognition service and the
 * same fusion. When live scanning comes back to the front, it is still there and still wired.
 *
 * Since 2026-09-06 a photograph is read twice. The census reads the whole upload and places a
 * box on every product; each box is cut out of the original photograph on the device and read
 * again on its own, and the server reconciles the two readings into one line that is sure only
 * when they agree (docs/superpowers/specs/2026-09-06-photo-verification-design.md). A line the
 * two readings disagreed on, or that nothing read twice, is unsure, and the review shows it in
 * amber and asks for a better photograph of it.
 *
 * Deliberately free of React and of the camera. It takes a base64 image and the functions that
 * talk to the service and the device, so a test can drive a whole multi-photograph session with
 * no device, and the screen above it holds no counting rules of its own.
 */
import {
  applyCensus,
  bagLines,
  brandFromKey,
  containment,
  createFusionState,
  foldedName,
  NESTED_CONTAINMENT,
  productKey,
  UNSURE_BELOW,
  type BagLine,
  type FusionState,
} from './fusion';
import type {
  CensusPayload,
  CensusRequest,
  ClientFailure,
  ClientResult,
  OcclusionReport,
  UnmarkedItem,
  VerifyPayload,
  VerifyRequest,
} from './recognitionClient';
import type { Box } from './types';

/**
 * A photograph session. Held across shutter presses so the second photograph of one orange is
 * still one orange.
 *
 * The fusion state is the whole of it. Quantity, aliasing and the name fold all live in there
 * already, and reusing it is what makes accumulation work without this module owning any
 * counting rule of its own.
 */
export interface PhotoScanState {
  fusion: FusionState;
}

export interface PhotoScanDeps {
  requestCensus: (request: CensusRequest) => Promise<ClientResult<CensusPayload>>;
  /**
   * Cuts one box out of the original photograph, as a base64 JPEG, or null when it cannot. With
   * `requestVerify`, this is what turns the census into two readings; without both, the census
   * stands on its own and every line is what it read.
   */
  crop?: (box: Box) => Promise<string | null>;
  requestVerify?: (request: VerifyRequest) => Promise<ClientResult<VerifyPayload>>;
}

export interface PhotoScanOptions {
  /** Names the review showed in amber, which this photograph was taken to confirm. */
  confirming?: string[];
  /**
   * Called as soon as the census answers, before the close read, with every item and its box, so
   * the review can draw the photograph at once and colour the boxes when the close read lands.
   */
  onCensus?: (items: PhotoItem[]) => void;
}

/** What one photograph showed: one entry per product, with where it is and whether it is sure. */
export interface PhotoItem {
  id: string;
  key: string;
  name: string;
  brand: string | null;
  qty: number;
  confidence: number;
  /** `checking` only between the census answering and the close read landing. */
  status: 'checking' | 'sure' | 'unsure';
  box: Box | null;
}

export type PhotoScanOutcome =
  | {
      ok: true;
      state: PhotoScanState;
      /** The whole bag after this photograph, not just what it added. */
      lines: BagLine[];
      /** How many products this photograph put in the bag that were not already in it. */
      added: number;
      /** What this photograph showed, for the review. This photograph only, not the session. */
      items: PhotoItem[];
      /**
       * Set when the close read could not be made at all. The census still filled the bag, but
       * nothing read it twice, so every line of it is unsure and the screen should say why.
       */
      verifyFailure?: ClientFailure;
      /**
       * Whether the census thinks this photograph has products buried under other products.
       *
       * Returned rather than folded away because it is the whole of CLAUDE.md's third
       * requirement, and the bag cannot carry it: an item nobody can see has no line. The
       * screen turns it into the one notice `CoachNotice` already holds the wording for,
       * which asks the shopper to move what is on top and photograph it again.
       *
       * It describes this photograph, not the session, so it is replaced on every shutter
       * press rather than accumulated. A second photograph taken after moving the bag is
       * the shopper answering it, and must be able to clear it.
       */
      occlusion: OcclusionReport;
    }
  | { ok: false; failure: ClientFailure; state: PhotoScanState };

export function createPhotoScanState(): PhotoScanState {
  return { fusion: createFusionState() };
}

/** The canonical key for an unmarked item, the way fusion will key it, from its raw "brand::name". */
function canonicalKey(item: { description: string; productKey: string }): string {
  const raw = item.productKey.trim();
  const split = raw.indexOf('::');
  const brand = split >= 0 ? raw.slice(0, split).trim() : '';
  const name = split >= 0 ? raw.slice(split + 2).trim() : raw;
  return productKey(name.length > 0 ? name : item.description, brand.length > 0 ? brand : null);
}

/** The line below which a wide reading on its own is shown as unsure; the bag's own line. */
function statusOf(confidence: number): PhotoItem['status'] {
  return confidence >= UNSURE_BELOW ? 'sure' : 'unsure';
}

/** Whether two names describe one thing: at least half the shorter name's words are in the other. */
function namesOverlap(a: string, b: string): boolean {
  const wordsA = new Set(foldedName(a).split(' ').filter((w) => w.length > 0));
  const wordsB = new Set(foldedName(b).split(' ').filter((w) => w.length > 0));
  const [shorter, longer] = wordsA.size <= wordsB.size ? [wordsA, wordsB] : [wordsB, wordsA];
  if (shorter.size === 0) return false;
  let shared = 0;
  for (const w of shorter) if (longer.has(w)) shared += 1;
  return shared * 2 >= shorter.size;
}

/**
 * One object listed twice. The wide pass named a package of beef ribs twice, under two names
 * with two boxes on the same package, and each close read confirmed its own hint, so the bag
 * held two units of one thing and both were sure. Two boxes one inside the other, on two names
 * that share their words, are one object: the more confident entry stays, the other is dropped,
 * and the survivor is unsure, because a listing that described one thing twice was not sure of
 * it. A cheese block sitting on an egg carton nests too and shares no words, so it stays two.
 */
function foldNestedDuplicates(products: UnmarkedItem[]): { products: UnmarkedItem[]; doubted: Set<number> } {
  const kept: number[] = [];
  const doubted = new Set<number>();
  const order = products.map((_, i) => i).sort((a, b) => products[b].confidence - products[a].confidence);
  for (const i of order) {
    const box = products[i].box;
    const twin = box === null
      ? undefined
      : kept.find((k) => {
          const other = products[k].box;
          return other !== null
            && containment(box, other) >= NESTED_CONTAINMENT
            && namesOverlap(products[i].description, products[k].description);
        });
    if (twin === undefined) kept.push(i);
    else doubted.add(twin);
  }
  kept.sort((a, b) => a - b);
  const survivors = kept.map((i) => products[i]);
  const doubtedIndexes = new Set<number>();
  kept.forEach((original, position) => { if (doubted.has(original)) doubtedIndexes.add(position); });
  return { products: survivors, doubted: doubtedIndexes };
}

export async function scanPhoto(
  state: PhotoScanState,
  imageBase64: string,
  deps: PhotoScanDeps,
  options: PhotoScanOptions = {},
): Promise<PhotoScanOutcome> {
  const before = bagLines(state.fusion);

  // What the bag already holds, so the census reuses a phrasing rather than inventing a third.
  // A photograph session asks about one scene repeatedly in exactly the way a live scan does,
  // so it has the same failure: one bag arriving as "packaged apples", then "red apples", then
  // "bag of apples", opening three lines nothing downstream can join.
  const confirming = options.confirming ?? [];
  const result = await deps.requestCensus({
    imageBase64,
    counted: before.map((line) => line.name),
    ...(confirming.length > 0 ? { confirming } : {}),
  });

  if (!result.ok) return { ok: false, failure: result.failure, state };

  const verifying = deps.crop !== undefined && deps.requestVerify !== undefined;
  const census = result.value;
  // Typed through the client's own shape: `CensusPayload` intersects fusion's looser
  // `CensusResult`, and `filter` on the intersection would otherwise pick the looser element.
  const { products, doubted } = foldNestedDuplicates(
    (census.unmarkedItems as UnmarkedItem[]).filter((u) => u.isProduct !== false),
  );
  const counted = new Map(census.inViewCounts.map((c) => [c.productKey, c.count]));

  let items: PhotoItem[] = products.map((u, index) => {
    const key = canonicalKey(u);
    return {
      id: `p${index}`,
      key,
      name: u.description,
      brand: brandFromKey(key),
      qty: Math.max(1, counted.get(key) ?? 1),
      confidence: u.confidence,
      // With a close read coming, a boxed item is being checked and an unboxed one cannot be:
      // nothing will read it twice, so it is unsure now. Without one, the census's own word stands.
      status: verifying ? (u.box ? 'checking' : 'unsure') : statusOf(u.confidence),
      box: u.box,
    };
  });
  options.onCensus?.(items);

  let verifyFailure: ClientFailure | undefined;
  let payload: CensusPayload = census;
  if (verifying && deps.crop && deps.requestVerify) {
    const crops = await Promise.all(items.map((item) => (item.box ? deps.crop!(item.box) : Promise.resolve(null))));
    const sent = items.filter((_, i) => crops[i] !== null);
    const lines = new Map<string, VerifyPayload['items'][number]['line']>();
    if (sent.length > 0) {
      const brands = [...new Set(items.map((item) => item.brand).filter((b): b is string => b !== null))];
      const verified = await deps.requestVerify({
        brands,
        items: sent.map((item) => ({
          id: item.id,
          imageBase64: crops[items.indexOf(item)] as string,
          wide: {
            description: item.name,
            productKey: products[Number(item.id.slice(1))].productKey,
            brand: item.brand,
            count: item.qty,
            confidence: item.confidence,
          },
        })),
      });
      if (verified.ok) for (const entry of verified.value.items) lines.set(entry.id, entry.line);
      else verifyFailure = verified.failure;
    }

    // What fusion is given is the reconciled reading, not the census's. A line nothing read
    // twice is capped below the unsure line, so the bag flags it the same way a disagreement is.
    const unmarkedItems: UnmarkedItem[] = [];
    const inViewCounts: CensusPayload['inViewCounts'] = [];
    items = items.map((item, index) => {
      const line = lines.get(item.id);
      const brand = line ? line.brand : item.brand;
      const qty = line ? Math.max(1, line.count) : item.qty;
      // A line the close read agreed with is still unsure when the wide pass listed the object
      // twice: the listing itself was the doubt.
      const confidence = Math.min(
        line ? line.confidence : Math.min(item.confidence, UNSURE_BELOW - 0.1),
        doubted.has(index) ? UNSURE_BELOW - 0.1 : 1,
      );
      const key = productKey(item.name, brand);
      unmarkedItems.push({ ...products[index], productKey: `${brand ?? ''}::${item.name}`, confidence });
      inViewCounts.push({ productKey: key, count: qty });
      return { ...item, key, brand, qty, confidence, status: confidence >= UNSURE_BELOW && line?.sure ? 'sure' : 'unsure' };
    });
    payload = { ...census, unmarkedItems, inViewCounts };
  } else if (doubted.size > 0) {
    // No close read, but a folded duplicate still carries its doubt into the bag.
    const unmarkedItems = products.map((u, index) => (doubted.has(index) ? { ...u, confidence: Math.min(u.confidence, UNSURE_BELOW - 0.1) } : u));
    items = items.map((item, index) => (doubted.has(index) ? { ...item, confidence: Math.min(item.confidence, UNSURE_BELOW - 0.1), status: 'unsure' } : item));
    payload = { ...census, unmarkedItems };
  }

  // No marks and no tracks: nothing was detected and nothing is being followed, so every product
  // arrives through `unmarkedItems` and the empty track arguments are the honest ones. `applyCensus`
  // already handles that case, which is what the degraded enumeration path has always relied on.
  const fusion = applyCensus(state.fusion, payload, {}, [], false, {});
  const lines = bagLines(fusion);

  const seen = new Set(before.map((line) => line.key));
  return {
    ok: true,
    state: { fusion },
    lines,
    added: lines.filter((line) => !seen.has(line.key)).length,
    items,
    ...(verifyFailure === undefined ? {} : { verifyFailure }),
    occlusion: census.occlusion,
  };
}
