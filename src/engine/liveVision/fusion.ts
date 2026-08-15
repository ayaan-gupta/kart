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
}

export function createFusionState(): FusionState {
  return { identities: {}, aliases: {}, maxSimultaneous: {}, merged: [] };
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
 */
export function addAlias(state: FusionState, from: string, to: string): FusionState {
  const target = resolveKey(state, to);
  if (from === target) return state;

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
    // A barcode is ground truth. Never let a later VLM guess overwrite one.
    if (existing?.source === 'barcode') {
      // ...but do record that this VLM name refers to the same product, so a sibling track
      // that only ever got the VLM name still merges into the barcode's identity.
      working = addAlias(working, productKey(mark.name, mark.brand), existing.key);
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
    };
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

  const counted = new Map(census.inViewCounts.map((c) => [resolveKey(working, c.productKey), c.count]));

  const maxSimultaneous = { ...working.maxSimultaneous };
  for (const [key, trackIds] of byKey) {
    const modelCount = counted.get(key);
    // No opinion from the model on this product means no clamp. Trust the tracker.
    const effective = modelCount === undefined ? trackIds.length : Math.min(trackIds.length, Math.max(0, modelCount));

    // Fold the surplus tracks. Keep the earliest ids so the survivor is stable across calls
    // rather than flickering between siblings every census.
    const ordered = [...trackIds].sort();
    for (const id of ordered.slice(effective)) merged.add(id);

    // Quantity is the high-water mark of simultaneously live tracks, never a running sum.
    // A running sum is the current bug: pan away from two cartons and back and it says four.
    maxSimultaneous[key] = Math.max(maxSimultaneous[key] ?? 0, effective);
  }

  return { identities: working.identities, aliases: working.aliases, maxSimultaneous, merged: [...merged] };
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

  const identities = { ...working.identities };
  identities[trackId] = {
    key,
    // Open Food Facts names are raw retail feed strings ("Gmills hny nut cheerios sweetened whl
    // grn oat cereal"). Keep a clean VLM name when we already have one; fall back to theirs.
    name: previous && previous.source === 'vlm' ? previous.name : (resolved?.name ?? 'Scanned item'),
    brand: resolved?.brand ?? previous?.brand ?? null,
    size: resolved?.size ?? previous?.size ?? null,
    category: resolved?.category ?? previous?.category ?? 'Grocery',
    confidence: 1,
    needsCloserLook: false,
    source: 'barcode',
  };

  return { ...working, identities };
}

export interface BagLine { key: string; name: string; brand: string | null; size: string | null; category: string; qty: number }

/** The bag. One line per product, quantity from the high-water mark, first-identified order. */
export function bagLines(state: FusionState): BagLine[] {
  const order: string[] = [];
  const display = new Map<string, Identity>();
  for (const id of Object.keys(state.identities).sort()) {
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
