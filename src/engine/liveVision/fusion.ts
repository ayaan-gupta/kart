export type IdentitySource = 'vlm' | 'barcode';

export interface Identity {
  key: string;
  name: string;
  brand: string | null;
  size: string | null;
  category: string;
  confidence: number;
  needsCloserLook: boolean;
  source: IdentitySource;
  /**
   * True only for a barcode identity whose name is the synthetic "Scanned item" fallback: the
   * UPC decoded but nothing, not Open Food Facts and not a prior model guess, has actually named
   * it yet. The key is still ground truth for counting, but the name carries no information, so
   * unlike a real barcode identity it is not protected: the next census mark is free to replace
   * it outright. Always false for a vlm-sourced identity and for a barcode that did resolve.
   */
  placeholder: boolean;
}

export interface CensusMark {
  id: number;
  name: string;
  brand: string | null;
  size: string | null;
  category: string;
  confidence: number;
  needsCloserLook: boolean;
}

export interface CensusResult {
  marks: CensusMark[];
  inViewCounts: { productKey: string; count: number }[];
}

export interface FusionState {
  /** trackId -> identity. Survives the track's death so the bag keeps the item. */
  identities: Record<string, Identity>;
  /** A VLM-derived key that a barcode later proved is the same product. */
  aliases: Record<string, string>;
  /** productKey -> the most tracks of it ever alive at one instant. This is the quantity. */
  maxSimultaneous: Record<string, number>;
  /** Tracks the in-view clamp folded into another track. They keep their outline but stop counting. */
  merged: string[];
  /**
   * trackId -> the last model key seen on that track while it was already barcode-identified,
   * and how many censuses in a row it has now shown up. A barcode-sourced track only ever gets
   * aliased to a fresh VLM guess once that guess repeats, so one misread on a glare-washed
   * frame leaves no permanent trace on the bag.
   */
  pendingAlias: Record<string, { key: string; count: number }>;
}

export function createFusionState(): FusionState {
  return { identities: {}, aliases: {}, maxSimultaneous: {}, merged: [], pendingAlias: {} };
}

/**
 * Stable key for one product across calls. Must stay character-for-character identical to
 * `productKey` in `server/src/schemas.ts`; the client and the server both compute it and the
 * in-view clamp silently stops matching if they ever diverge.
 */
export function productKey(name: string, brand: string | null): string {
  const norm = (s: string) =>
    s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
      .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return `${brand ? norm(brand) : ''}::${norm(name)}`;
}

/** A resolved barcode keys on the UPC itself, which is ground truth and needs no normalizing. */
export function barcodeKey(payload: string): string {
  return `upc:${payload}`;
}

/**
 * True for any key `barcodeKey` could have produced.
 *
 * A caller that is about to alias a key away needs to know whether that key is currently
 * ground truth (a scanned UPC) rather than a guess, since only the two-in-a-row corroboration
 * path above is allowed to link a fresh vlm name onto a barcode's key, and only after it has
 * repeated. Keeping the `upc:` literal in one place, here, means nothing else has to duplicate it.
 */
export function isBarcodeKey(key: string): boolean {
  return key.startsWith('upc:');
}

/**
 * Follows an alias chain to the surviving key.
 *
 * Bounded rather than recursive: aliases are written from two places and a cycle (A -> B and
 * later B -> A) would otherwise hang the frame handler. A cycle means the last write wins,
 * which is wrong but survivable; a spin is not.
 */
export function resolveKey(state: Pick<FusionState, 'aliases'>, key: string): string {
  let current = key;
  for (let i = 0; i < 8; i++) {
    const next = state.aliases[current];
    if (next === undefined || next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Records that `from` and `to` are the same product, and moves the accumulated quantity over.
 *
 * Migrating `maxSimultaneous` is the whole point. Without it, the moment a barcode read gives an
 * already-counted product a new key, its quantity is stranded under the old key and the item
 * disappears from the bag: the user watches something they already scanned drop out. Both keys
 * describe the same physical items, so the survivor takes the larger high-water mark.
 *
 * `from` can already alias somewhere else, and the new target can differ from the old one: two
 * barcode reads under one generic model name (both cups named "Yogurt" by the VLM, one scanned
 * as strawberry, the other as blueberry) route the same `from` key to two different targets in
 * two calls. Forcing the second call to win would silently fuse two different physical products
 * into one bag line. Instead the redirect is severed outright and both keys' accumulated
 * quantity is dropped, since it was computed while the two were wrongly fused; each re-accumulates
 * on its own from the next census, where every barcode-claimed track keys to its own barcode key.
 */
export function addAlias(state: FusionState, from: string, to: string): FusionState {
  const target = resolveKey(state, to);
  if (from === target) return state;

  const existingResolved = resolveKey(state, from);
  if (existingResolved !== from && existingResolved !== target) {
    const aliases = { ...state.aliases };
    delete aliases[from];
    const maxSimultaneous = { ...state.maxSimultaneous };
    delete maxSimultaneous[existingResolved];
    delete maxSimultaneous[target];
    return { ...state, aliases, maxSimultaneous };
  }

  const aliases = { ...state.aliases, [from]: target };
  const maxSimultaneous = { ...state.maxSimultaneous };
  const stranded = maxSimultaneous[from];
  if (stranded !== undefined) {
    maxSimultaneous[target] = Math.max(maxSimultaneous[target] ?? 0, stranded);
    delete maxSimultaneous[from];
  }
  return { ...state, aliases, maxSimultaneous };
}

/**
 * Orders track ids so `track_10` sorts after `track_2` instead of before it. Ids are shaped
 * `prefix_N`; ties (or ids with no trailing digit run, as in tests) fall back to a plain string
 * compare so ordering is still total and deterministic.
 */
function compareTrackIds(a: string, b: string): number {
  const na = /(\d+)$/.exec(a);
  const nb = /(\d+)$/.exec(b);
  if (na && nb) {
    const diff = Number(na[1]) - Number(nb[1]);
    if (diff !== 0) return diff;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Folds one census response into the fusion state.
 *
 * `markToTrack` is the mapping the client built when it composed the request, so mark ids never
 * have to survive a round trip through the model as anything but integers it echoes back.
 * `liveTrackIds` is every track that was in view for this keyframe, which is what the in-view
 * clamp is allowed to act on. Tracks outside it are items the camera has already moved past and
 * a model looking at this frame has no opinion about them.
 */
export function applyCensus(
  state: FusionState,
  census: CensusResult,
  markToTrack: Record<number, string>,
  liveTrackIds: string[],
): FusionState {
  let working: FusionState = { ...state, identities: { ...state.identities } };
  const merged = new Set(state.merged);

  for (const mark of census.marks) {
    const trackId = markToTrack[mark.id];
    // A mark id we never sent. The model invented or mistyped it; there is no track to attach
    // it to, so it is dropped rather than guessed at.
    if (trackId === undefined) continue;

    const existing = working.identities[trackId];

    // A barcode identity that never got a real name (the lookup missed, was offline, or was
    // rate limited) is not ground truth for anything except its key. "Scanned item" carries no
    // information worth protecting, so the next guess, however uncertain, replaces it outright.
    // The key and the barcode source stay exactly as they were, so the UPC keeps doing its job
    // as the stable counting key and this identity falls back to full protection immediately
    // afterward, same as any barcode that resolved on the first try.
    if (existing?.source === 'barcode' && existing.placeholder) {
      working.identities[trackId] = {
        ...existing,
        name: mark.name,
        brand: mark.brand,
        size: mark.size,
        category: mark.category,
        confidence: mark.confidence,
        needsCloserLook: mark.needsCloserLook,
        placeholder: false,
      };
      continue;
    }

    // A resolved barcode is ground truth. Never let a later VLM guess overwrite one.
    if (existing?.source === 'barcode') {
      const candidateKey = productKey(mark.name, mark.brand);
      const pending = working.pendingAlias[trackId];
      if (pending && pending.key === candidateKey) {
        // The same guess has now shown up on this barcoded track in two distinct censuses.
        // One misread is noise a VLM produces routinely on a bad frame; two in a row is
        // corroboration, so it's now safe to record that this model key refers to the same
        // product as the barcode's, letting a sibling track that only ever got the VLM name
        // still merge into the barcode's identity.
        working = addAlias(working, candidateKey, existing.key);
        const pendingAlias = { ...working.pendingAlias };
        delete pendingAlias[trackId];
        working = { ...working, pendingAlias };
      } else {
        // First sighting of this guess on this barcoded track (or it differs from the last
        // one). Don't act on it yet: a single misread must leave no permanent trace on the
        // bag, so just remember it in case the next census repeats it.
        working = { ...working, pendingAlias: { ...working.pendingAlias, [trackId]: { key: candidateKey, count: 1 } } };
      }
      continue;
    }

    working.identities[trackId] = {
      key: resolveKey(working, productKey(mark.name, mark.brand)),
      name: mark.name,
      brand: mark.brand,
      size: mark.size,
      category: mark.category,
      confidence: mark.confidence,
      needsCloserLook: mark.needsCloserLook,
      source: 'vlm',
      placeholder: false,
    };
  }

  const counted = new Map(census.inViewCounts.map((c) => [resolveKey(working, c.productKey), c.count]));

  // An explicit count for a product this frame is corroborating evidence strong enough to
  // revise a bad earlier clamp upward, so release that key's previously-merged tracks before
  // regrouping below. A key the model stays silent on this frame keeps its existing merges
  // exactly as they were: an omitted count is not a re-confirmation of the old clamp, and
  // releasing on silence is what would let a census that simply doesn't mention a product
  // re-inflate an already-correct clamp (the split-bananas case creeping back from 1 to 3).
  for (const id of [...merged]) {
    const identity = working.identities[id];
    if (identity && counted.has(resolveKey(working, identity.key))) merged.delete(id);
  }

  // --- The in-view clamp -------------------------------------------------------------------
  // Group the live tracks by resolved identity and compare against what the model counted in
  // this one frame. Counting a handful of objects inside a single image is the one counting
  // job a VLM does reliably, so where it disagrees with the tracker, it wins.
  const live = liveTrackIds.filter((id) => !merged.has(id));
  const byKey = new Map<string, string[]>();
  for (const id of live) {
    const identity = working.identities[id];
    if (!identity) continue;
    const key = resolveKey(working, identity.key);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(id);
    else byKey.set(key, [id]);
  }

  const maxSimultaneous = { ...working.maxSimultaneous };
  for (const [key, trackIds] of byKey) {
    const modelCount = counted.get(key);
    // No opinion from the model on this product means no clamp. Trust the tracker.
    const effective = modelCount === undefined ? trackIds.length : Math.min(trackIds.length, Math.max(0, modelCount));

    // Fold the surplus tracks. Numeric-aware order keeps the survivor stable across calls
    // rather than flickering between siblings every census, and rather than flickering at the
    // 9-to-10 boundary the way a plain string sort would.
    const ordered = [...trackIds].sort(compareTrackIds);
    for (const id of ordered.slice(effective)) merged.add(id);

    // Quantity is the high-water mark of simultaneously live tracks, never a running sum.
    // A running sum is the current bug: pan away from two cartons and back and it says four.
    maxSimultaneous[key] = Math.max(maxSimultaneous[key] ?? 0, effective);
  }

  return {
    identities: working.identities,
    aliases: working.aliases,
    maxSimultaneous,
    merged: [...merged],
    pendingAlias: working.pendingAlias,
  };
}

/** Attaches a decoded barcode's identity to a track. Ground truth, so it outranks any VLM guess. */
export function applyBarcode(
  state: FusionState,
  trackId: string,
  payload: string,
  resolved: { name: string; brand: string | null; size: string | null; category: string } | null,
  vlmNameForAlias?: { name: string; brand: string | null },
): FusionState {
  const key = barcodeKey(payload);
  const previous = state.identities[trackId];

  let working = state;
  // The same physical item already had a VLM guess. Record the alias so its siblings, which
  // may never get a barcode read of their own, still land in the same bag line, and so the
  // quantity already accumulated under the guessed key follows the item rather than vanishing.
  if (previous && previous.source === 'vlm') working = addAlias(working, previous.key, key);
  if (vlmNameForAlias) {
    working = addAlias(working, productKey(vlmNameForAlias.name, vlmNameForAlias.brand), key);
  }

  // True only when neither Open Food Facts nor a prior VLM guess actually named this item, so
  // the name below falls back to the synthetic "Scanned item" text. That text is not ground
  // truth and applyCensus's barcode branch treats it as freely replaceable; a resolved lookup or
  // an already-known VLM name is real information and stays fully protected like any barcode.
  const isPlaceholder = resolved === null && !(previous && previous.source === 'vlm');

  const identities = { ...working.identities };
  identities[trackId] = {
    key,
    // Open Food Facts names are raw retail feed strings ("Gmills hny nut cheerios sweetened whl
    // grn oat cereal"). Keep a clean VLM name when we already have one; fall back to theirs.
    name: previous && previous.source === 'vlm' ? previous.name : (resolved?.name ?? 'Scanned item'),
    brand: resolved?.brand ?? previous?.brand ?? null,
    size: resolved?.size ?? previous?.size ?? null,
    category: resolved?.category ?? previous?.category ?? 'Grocery',
    // A placeholder starts at confidence 0 rather than 1: the UPC match is the ground truth
    // here, not this name, so the item should read amber and draw a crop identify like any
    // other uncertain item, rather than sit at full confidence under a name that means nothing.
    confidence: isPlaceholder ? 0 : 1,
    needsCloserLook: false,
    source: 'barcode',
    placeholder: isPlaceholder,
  };

  return { ...working, identities };
}

export interface BagLine { key: string; name: string; brand: string | null; size: string | null; category: string; qty: number }

/** The bag. One line per product, quantity from the high-water mark, first-identified order. */
export function bagLines(state: FusionState): BagLine[] {
  const order: string[] = [];
  const display = new Map<string, Identity>();
  // `Object.keys` on a string-keyed object already returns insertion order for non-index-like
  // keys (which every track id is), so this is first-identified order with no sort needed.
  for (const id of Object.keys(state.identities)) {
    const identity = state.identities[id];
    const key = resolveKey(state, identity.key);
    if (!display.has(key)) { order.push(key); display.set(key, identity); }
    // Prefer a barcode-sourced identity's metadata for the line.
    else if (identity.source === 'barcode' && display.get(key)!.source !== 'barcode') display.set(key, identity);
  }
  return order
    .map((key) => {
      const identity = display.get(key)!;
      return { key, name: identity.name, brand: identity.brand, size: identity.size, category: identity.category, qty: state.maxSimultaneous[key] ?? 0 };
    })
    .filter((line) => line.qty > 0);
}
