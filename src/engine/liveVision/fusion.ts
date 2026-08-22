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
  /**
   * True only for a vlm identity set by a crop identify, a closer, more careful look at this
   * one item, rather than a wide census guess. Protected the same way a resolved barcode is
   * protected (see the `existing?.source === 'barcode'` branch in `applyCensus`): a later census
   * mark that disagrees needs to repeat twice in a row before it is trusted at all, and even
   * then it only earns an alias, never an outright overwrite of what the closer look found. A
   * fresh identify call is exempt and always wins outright, since a second closer look
   * supersedes the first. Always false for a census-sourced vlm identity and for any barcode.
   */
  verifiedByIdentify: boolean;
}

export interface CensusMark {
  id: number;
  name: string;
  brand: string | null;
  size: string | null;
  category: string;
  confidence: number;
  needsCloserLook: boolean;
  /**
   * Whether the badge is on something the shopper is buying. Optional so an older server keeps
   * working, and absent is read as true, because a server that predates the field was still
   * identifying real products.
   */
  isProduct?: boolean;
  /**
   * Which catalog candidate this is, copied exactly from the shortlist the request carried, or
   * null when no catalog was consulted or nothing it offered fits.
   *
   * Optional so a server that predates the field, or a deployment with no catalog, behaves
   * exactly as before.
   */
  catalogSku?: string | null;
}

export interface CensusResult {
  marks: CensusMark[];
  inViewCounts: { productKey: string; count: number }[];
  /**
   * Products the model can see that no badge landed on. Not a diagnostic: enumeration recall
   * on real cart photographs measures 38%, so most of a cart arrives through this field. An
   * unmarked item has no polygon and so never gets an outline, but it still gets named, still
   * gets counted, and still reaches the bag, which is worth far more than the outline.
   */
  unmarkedItems?: { description: string; productKey?: string; confidence?: number }[];
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

/**
 * Marks an identity that came from the model naming something no badge landed on. It is a
 * synthetic key, never a track id, so outline lookups miss it by construction, and `bagLines`
 * lets any real identity for the same product take the display slot instead: an unmarked
 * sighting knows a name and nothing else, while a marked one also knows the brand and size.
 */
const CENSUS_IDENTITY_PREFIX = 'census:';

/**
 * The key for a product the model saw but no badge landed on.
 *
 * Prefer the model's own key, which is the same string it uses in inViewCounts and on marks, so
 * an unmarked sighting of a Kellogg's box joins the badge that finds it on the next keyframe.
 * A description alone carries no brand and would key as "::froot loops", which meets nothing.
 */
function unmarkedKey(state: FusionState, unmarked: { description: string; productKey?: string }): string {
  const supplied = unmarked.productKey?.trim();
  if (supplied) {
    // Re-normalise rather than trusting the string as sent. productKey folds accents and strips
    // punctuation, so a model that reports "Kellogg's::Froot Loops" would otherwise key as
    // "kellogg's::froot loops" and miss the badge's "kelloggs::froot loops" by one apostrophe.
    const split = supplied.indexOf('::');
    const brand = split >= 0 ? supplied.slice(0, split) : '';
    const name = split >= 0 ? supplied.slice(split + 2) : supplied;
    if (name.trim()) return resolveKey(state, productKey(name, brand.trim() ? brand : null));
  }
  return resolveKey(state, productKey(unmarked.description.trim(), null));
}

export function createFusionState(): FusionState {
  return { identities: {}, aliases: {}, maxSimultaneous: {}, merged: [], pendingAlias: {} };
}

/**
 * Stable key for one product across calls. Must stay character-for-character identical to
 * `productKey` in `server/src/schemas.ts`; the client and the server both compute it and the
 * in-view clamp silently stops matching if they ever diverge.
 */
/**
 * The key a mark counts under.
 *
 * A catalog SKU when the model picked one, and the model's own words otherwise. The name is what
 * drifts: measured across the four census calls of a nine-second scan, one trolley's contents
 * came back as "oreo" and "oreo cookies", as "bread" and "seedstastic bread" and "seedblossom
 * bread", and each spelling became its own line in the bag, turning ten products into fifteen
 * units. A SKU copied out of a shortlist cannot drift, and the request already carries the
 * shortlist for exactly this reason.
 *
 * `sku:` rather than a bare SKU so the three key spaces stay tellable apart: `upc:` is a scanned
 * barcode, `sku:` is a catalog match, and `brand::name` is the model's own words.
 */
export function markKey(mark: { name: string; brand: string | null; catalogSku?: string | null }): string {
  const sku = mark.catalogSku?.trim();
  return sku ? `sku:${sku}` : productKey(mark.name, mark.brand);
}

/**
 * Whether a mark is already the product an existing identity carries.
 *
 * Both keys are checked, not just `markKey`'s. `IdentifyResponse` has no `catalogSku` field, so a
 * closer look can only ever produce a `brand::name` key while a census on the same product now
 * produces `sku:`. Comparing one key would read those as a disagreement between two calls that
 * actually agree, and send a correct identification round the two-in-a-row corroboration path
 * before it could merge, showing one product on two bag lines in the meantime.
 */
export function marksSameProduct(
  state: FusionState,
  mark: { name: string; brand: string | null; catalogSku?: string | null },
  existingKey: string,
): boolean {
  const resolved = resolveKey(state, existingKey);
  return resolveKey(state, markKey(mark)) === resolved
    || resolveKey(state, productKey(mark.name, mark.brand)) === resolved;
}

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
 * A track's box, normalized to the frame with origin top-left. Declared here rather than
 * imported from `types.ts` because that module re-exports `Identity` from this one, and this
 * file is otherwise dependency-free.
 */
export interface TrackBox { x: number; y: number; w: number; h: number }

/**
 * How much of the smaller of two boxes lies inside the other, 0 to 1.
 *
 * Deliberately not IoU. Two boxes on one bottle, one loose and one tight, score 0.23 to 0.63 by
 * IoU, which is indistinguishable from two genuinely adjacent products; by containment they
 * score 1.0, because one is wholly inside the other. Nesting is the signal that separates "one
 * item proposed twice" from "two items touching".
 */
function containment(a: TrackBox, b: TrackBox): number {
  const overlap =
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const smaller = Math.min(a.w * a.h, b.w * b.h);
  return smaller <= 0 ? 0 : overlap / smaller;
}

/**
 * At or above this, one box is inside the other and they are the same physical item.
 *
 * 0.85 rather than 1.0 because a tight mask-derived box and a loose detector box on the same
 * product rarely nest perfectly; measured on real cart photographs the true duplicates scored
 * 0.93 to 1.00 and the true neighbours scored 0.00.
 */
const NESTED_CONTAINMENT = 0.85;

/** Normalized box area. Zero for a degenerate box, which never wins a survivor comparison. */
function area(box: TrackBox): number {
  return Math.max(0, box.w) * Math.max(0, box.h);
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
  /**
   * True when `census` is really a single crop identify's result, folded through this function
   * so it goes through the same clamp and barcode-precedence rules as a real census mark (see
   * `resolveUncertain` in `orchestrator.ts`). Marks the identity it writes as
   * `verifiedByIdentify`, and exempts a track already in that state from the protection below:
   * a fresh closer look always supersedes an earlier one outright.
   */
  fromIdentify = false,
  /**
   * Every live track's box, normalized to the frame. Optional: without it nothing is folded and
   * the behaviour is exactly what it was, which is what keeps existing callers working. With it,
   * several proposals landing on one physical item stop being several units of quantity.
   */
  liveBoxes?: Record<string, TrackBox>,
): FusionState {
  let working: FusionState = { ...state, identities: { ...state.identities } };
  const merged = new Set(state.merged);

  for (const mark of census.marks) {
    const trackId = markToTrack[mark.id];
    // A mark id we never sent. The model invented or mistyped it; there is no track to attach
    // it to, so it is dropped rather than guessed at.
    if (trackId === undefined) continue;

    // A badge on the cart frame, a bag handle, a shopper's leg or bare floor. The detector puts
    // badges on plenty of those, the model names them accurately and confidently, and none of
    // them is being bought. Measured on real photographs, a bag could otherwise open with
    // "1 x shopping cart frame" and "2 x dark clothing/leg in background" in it.
    if (mark.isProduct === false) continue;

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
      const candidateKey = markKey(mark);
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

    // A crop identify is a closer, more careful look at this one item than a wide census mark
    // is. Protect it exactly the way a resolved barcode is protected above: a later census
    // guess that disagrees needs to repeat twice in a row before it earns even an alias, and
    // never overwrites what the closer look found outright. Exempt when this call is itself a
    // fresh identify (`fromIdentify`): a second closer look supersedes the first without
    // needing corroboration.
    if (existing?.source === 'vlm' && existing.verifiedByIdentify && !fromIdentify) {
      const candidateKey = markKey(mark);
      const existingKey = resolveKey(working, existing.key);
      if (marksSameProduct(working, mark, existing.key)) continue; // already the same product

      const pending = working.pendingAlias[trackId];
      if (pending && pending.key === candidateKey) {
        // Corroborated: this model key has now shown up twice in a row on a track the closer
        // look already named. Safe to record it as the same product, so a sibling track that
        // only ever gets the wide-shot guess still merges into the identify's line. The
        // identify's own name and confidence are left untouched, same as a corroborated
        // barcode's are.
        working = addAlias(working, candidateKey, existingKey);
        const pendingAlias = { ...working.pendingAlias };
        delete pendingAlias[trackId];
        working = { ...working, pendingAlias };
      } else {
        working = { ...working, pendingAlias: { ...working.pendingAlias, [trackId]: { key: candidateKey, count: 1 } } };
      }
      continue;
    }

    working.identities[trackId] = {
      key: resolveKey(working, markKey(mark)),
      name: mark.name,
      brand: mark.brand,
      size: mark.size,
      category: mark.category,
      confidence: mark.confidence,
      needsCloserLook: mark.needsCloserLook,
      source: 'vlm',
      placeholder: false,
      verifiedByIdentify: fromIdentify,
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

  // --- Several proposals, one physical item -------------------------------------------------
  // The clamp below groups live tracks by product key, so it can only ever see duplicates that
  // were named identically. On a real cart photograph two Coca-Cola bottles drew four boxes,
  // three of them nested on one bottle, and the model named all four differently across three
  // censuses: "cola soda", "Coca-Cola can", "Coca-Cola", "soda can". Four keys, so the clamp
  // never grouped them, and the bag showed four units of a two-bottle cart.
  //
  // Nothing in the pipeline compared two live tracks to each other. Geometry is what settles it:
  // a box wholly inside another box is not a second thing to buy, whatever the two were called.
  // The loser is folded into `merged`, which already means "keeps its outline, stops counting",
  // and its key is aliased onto the survivor's so the quantity it accumulated under its own name
  // moves across instead of being stranded in a second bag line.
  if (liveBoxes) {
    const foldable = liveTrackIds
      .filter((id) => !merged.has(id) && working.identities[id] !== undefined && liveBoxes[id] !== undefined)
      .sort(compareTrackIds);

    for (let i = 0; i < foldable.length; i++) {
      const a = foldable[i];
      if (merged.has(a)) continue;

      for (let j = i + 1; j < foldable.length; j++) {
        const b = foldable[j];
        if (merged.has(b)) continue;
        if (containment(liveBoxes[a], liveBoxes[b]) < NESTED_CONTAINMENT) continue;

        const first = working.identities[a];
        const second = working.identities[b];

        // A brand disagreement means nesting is describing a multipack, not a duplicate: the
        // outer box and one legible unit inside it are two different products, and folding
        // them would throw away the inner one entirely. Two brandless items still fold, which
        // is the common produce case (a bag of leaves proposed twice, at two sizes).
        const brandOf = (identity: Identity) => identity.brand?.trim().toLowerCase() ?? '';
        if (brandOf(first) !== brandOf(second)) continue;

        // Two decoded UPCs are two physical labels and therefore two physical items, however
        // their boxes sit. A barcode is the only certain identification this pipeline produces
        // and geometry does not get to overrule it.
        const firstKey = resolveKey(working, first.key);
        const secondKey = resolveKey(working, second.key);
        if (isBarcodeKey(firstKey) && isBarcodeKey(secondKey)) continue;

        // The smaller box survives, always. Two proposals on one bottle differ only in how
        // tightly they hug it, and the tighter one is the better crop to identify from and the
        // better shape to draw. More importantly this is also right for the other thing nesting
        // means: an enumerator proposing at several scales puts one box over a row of four milk
        // cartons and another box on each carton, and there the large box is the mistake. Keeping
        // the larger would collapse all four cartons into one item. Measured on a real cart, that
        // is exactly what happened: 14 of 24 tracks folded away and a twenty-item cart came back
        // as six units.
        const firstIsSmaller = area(liveBoxes[a]) !== area(liveBoxes[b])
          ? area(liveBoxes[a]) < area(liveBoxes[b])
          : compareTrackIds(a, b) <= 0;

        const survivor = firstIsSmaller ? a : b;
        const folded = firstIsSmaller ? b : a;
        merged.add(folded);

        const foldedKey = resolveKey(working, working.identities[folded].key);
        const survivorKey = resolveKey(working, working.identities[survivor].key);
        if (foldedKey !== survivorKey) working = addAlias(working, foldedKey, survivorKey);

        // `a` itself lost, so it has nothing left to compare against anything.
        if (folded === a) break;
      }
    }
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

  // Every spelling the live tracks answer to, which is not the same set as their keys. A mark
  // that carried a catalogSku keys as "sku:kart_brussels_sprouts"; an unmarked sighting of the
  // same product has no SKU to offer and can only key as "::brussels sprouts". The two never
  // meet, so the guard on unmarked items below has to know both. Measured on a real response:
  // two badges named "Brussels sprouts" with that SKU, one unmarked "Brussels sprouts bag", and
  // a bag holding five items where the trolley held three.
  const spelledByLive = new Set<string>();
  for (const id of live) {
    const identity = working.identities[id];
    if (!identity) continue;
    spelledByLive.add(resolveKey(working, identity.key));
    spelledByLive.add(resolveKey(working, productKey(identity.name, identity.brand)));
  }

  const maxSimultaneous = { ...working.maxSimultaneous };
  for (const [key, trackIds] of byKey) {
    const modelCount = counted.get(key);
    // No opinion from the model on this product means no clamp. Trust the tracker.
    //
    // Where the model does have an opinion it wins outright, in both directions. It used to win
    // only downward, via a min against the track count, which quietly made the tracker a ceiling
    // on quantity. With enumeration recall measured at 38% that ceiling is wrong far more often
    // than it is right: three cartons with one polygon on them counted as one. The model looking
    // at the whole frame is the better witness to how many are there, which is what the comment
    // above this block always claimed and what the code did not do.
    const effective = modelCount === undefined ? trackIds.length : Math.max(0, modelCount);

    // Fold the surplus tracks. Numeric-aware order keeps the survivor stable across calls
    // rather than flickering between siblings every census, and rather than flickering at the
    // 9-to-10 boundary the way a plain string sort would. Slicing past the end is empty, so a
    // model count above the track count folds nothing, which is the point.
    const ordered = [...trackIds].sort(compareTrackIds);
    for (const id of ordered.slice(effective)) merged.add(id);

    // Quantity is the high-water mark of simultaneously live tracks, never a running sum.
    // A running sum is the current bug: pan away from two cartons and back and it says four.
    maxSimultaneous[key] = Math.max(maxSimultaneous[key] ?? 0, effective);
  }

  // --- Products no badge landed on ----------------------------------------------------------
  // Only items the model explicitly listed as unmarked count here. An inViewCounts entry alone
  // is not enough: a count against a mark id that was never sent is a model error, and inventing
  // a bag line from it would put hallucinated products in the bag.
  const keysWithIdentity = new Set(
    Object.values(working.identities).map((i) => resolveKey(working, i.key)),
  );
  // Two separate entries naming the same product are two units of it. The model is supposed to
  // say so in inViewCounts, but when it lists a product twice and counts it once, the listing is
  // the more direct evidence, so take whichever is larger.
  const listedTimes = new Map<string, number>();
  for (const unmarked of census.unmarkedItems ?? []) {
    if (!unmarked.description.trim()) continue;
    listedTimes.set(unmarkedKey(working, unmarked), (listedTimes.get(unmarkedKey(working, unmarked)) ?? 0) + 1);
  }

  for (const unmarked of census.unmarkedItems ?? []) {
    const name = unmarked.description.trim();
    if (!name) continue;
    const key = unmarkedKey(working, unmarked);
    // The model does not always spell the two key spaces the same way. On a real response it
    // named two badges "packaged carrots" (deriving "::packaged carrots") while listing the
    // unmarked sighting under "::carrots", and the bag showed four carrots where there were two.
    // Skip if either spelling is already carried by a live track.
    const fromDescription = resolveKey(working, productKey(unmarked.description.trim(), null));
    if (spelledByLive.has(key) || spelledByLive.has(fromDescription)) continue;
    const count = Math.max(Math.max(0, counted.get(key) ?? 0), listedTimes.get(key) ?? 1);
    if (count === 0) continue;
    maxSimultaneous[key] = Math.max(maxSimultaneous[key] ?? 0, count);
    // Give it a bag identity only if nothing already carries this product. The synthetic id can
    // never collide with a track id, so every outline lookup simply misses it and the item shows
    // in the bag with no outline, which is the honest rendering of "seen but not located".
    if (!keysWithIdentity.has(key)) {
      keysWithIdentity.add(key);
      working.identities[`${CENSUS_IDENTITY_PREFIX}${key}`] = {
        key,
        name,
        brand: null,
        size: null,
        category: 'other',
        // The model's own confidence, passed through rather than invented. needsCloserLook is
        // always true: nothing was cropped and nothing was outlined, so a closer look is exactly
        // what this item has not had.
        confidence: typeof unmarked.confidence === 'number' ? unmarked.confidence : 0.5,
        needsCloserLook: true,
        source: 'vlm',
        placeholder: false,
        verifiedByIdentify: false,
      };
    }
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
    verifiedByIdentify: false,
  };

  return { ...working, identities };
}

export interface BagLine { key: string; name: string; brand: string | null; size: string | null; category: string; qty: number }

/** The bag. One line per product, quantity from the high-water mark, first-identified order. */
export function bagLines(state: FusionState): BagLine[] {
  const order: string[] = [];
  const display = new Map<string, { identity: Identity; id: string }>();
  // `Object.keys` on a string-keyed object already returns insertion order for non-index-like
  // keys (which every track id is), so this is first-identified order with no sort needed.
  for (const id of Object.keys(state.identities)) {
    const identity = state.identities[id];
    const key = resolveKey(state, identity.key);
    const current = display.get(key);
    if (!current) {
      order.push(key);
      display.set(key, { identity, id });
      continue;
    }
    // Prefer a barcode-sourced identity's metadata for the line.
    if (identity.source === 'barcode' && current.identity.source !== 'barcode') {
      display.set(key, { identity, id });
      continue;
    }
    // Any located identity beats a bare unmarked sighting. The unmarked one gets the line first
    // because it was seen first, but it knows only a name, while a badge that later lands on the
    // same product also carries brand, size and category.
    if (current.id.startsWith(CENSUS_IDENTITY_PREFIX) && !id.startsWith(CENSUS_IDENTITY_PREFIX)) {
      display.set(key, { identity, id });
    }
  }
  return order
    .map((key) => {
      const { identity } = display.get(key)!;
      return { key, name: identity.name, brand: identity.brand, size: identity.size, category: identity.category, qty: state.maxSimultaneous[key] ?? 0 };
    })
    .filter((line) => line.qty > 0);
}
