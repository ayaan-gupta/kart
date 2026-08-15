/**
 * Open Food Facts resolution for the barcode fast path.
 *
 * This supplies facts, never names the user reads first and never pictures.
 *
 * Their `product_name` is a raw retail feed string: the UPC for Honey Nut Cheerios returns
 * "Gmills hny nut cheerios sweetened whl grn oat cereal", and Oreos come back as "oreo cookies
 * shelf". `fusion.applyBarcode` therefore keeps the model's clean name whenever it has one and
 * only falls back to this. Their product images are Creative Commons Attribution ShareAlike, a
 * stricter licence than the ODbL that covers the database, so this file never requests one.
 */

/** Shown wherever an item's facts came from this database. Required by the ODbL. */
export const OPEN_FOOD_FACTS_ATTRIBUTION = 'Product data from Open Food Facts, licensed under ODbL';

/** Their policy asks for AppName/Version (ContactEmail) so they can identify heavy clients. */
const USER_AGENT = 'Kart/1.0 (support@kart.app)';

const ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product';

/** Only the fields that are actually used. Asking for the whole record wastes their bandwidth. */
const FIELDS = 'code,product_name,brands,quantity,categories_tags';

/**
 * Their documented ceiling is 15 reads per minute per IP. Staying under it matters more than
 * it looks: on shared shop wifi the IP is not only this user's.
 */
const MAX_REQUESTS_PER_MINUTE = 15;
const WINDOW_MS = 60_000;

const REQUEST_TIMEOUT_MS = 6_000;

export interface ResolvedProduct {
  name: string;
  brand: string | null;
  size: string | null;
  category: string;
}

export interface LookupCache {
  /** A resolved barcode, or null for a confirmed miss. Misses are cached too. */
  entries: Map<string, ResolvedProduct | null>;
  /** Deduplicates concurrent lookups of the same barcode from different frames. */
  inFlight: Map<string, Promise<ResolvedProduct | null>>;
  /** Timestamps of recent requests, for the rate limiter. */
  recent: number[];
}

export function createLookupCache(): LookupCache {
  return { entries: new Map(), inFlight: new Map(), recent: [] };
}

function withinBudget(cache: LookupCache, now: number): boolean {
  while (cache.recent.length > 0 && now - cache.recent[0] > WINDOW_MS) cache.recent.shift();
  return cache.recent.length < MAX_REQUESTS_PER_MINUTE;
}

/** `"Nutella, Ferrero, Yum yum"` is a real response. The first entry is the one that matters. */
function firstBrand(brands: unknown): string | null {
  if (typeof brands !== 'string') return null;
  const first = brands.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/** `categories_tags` looks like `["en:breakfasts", "en:cereals"]`. Take the first, drop the prefix. */
function firstCategory(tags: unknown): string {
  if (!Array.isArray(tags)) return 'Grocery';
  const first = tags.find((t): t is string => typeof t === 'string' && t.length > 0);
  if (!first) return 'Grocery';
  const colon = first.indexOf(':');
  const label = colon === -1 ? first : first.slice(colon + 1);
  return label.replace(/-/g, ' ').trim() || 'Grocery';
}

async function fetchProduct(payload: string, signal?: AbortSignal): Promise<ResolvedProduct | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const url = `${ENDPOINT}/${encodeURIComponent(payload)}?fields=${FIELDS}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return null;
    }

    const record = body as { status?: unknown; product?: Record<string, unknown> };
    // The trap: an unknown barcode answers HTTP 200 with status 0. Trusting response.ok alone
    // turns every miss into a product with an undefined name.
    if (record?.status !== 1 || !record.product) return null;

    const product = record.product;
    const name = typeof product.product_name === 'string' ? product.product_name.trim() : '';
    if (name.length === 0) return null;

    // quantity is frequently "" rather than absent; Pepsi's real record is an example.
    const quantity = typeof product.quantity === 'string' ? product.quantity.trim() : '';

    return {
      name,
      brand: firstBrand(product.brands),
      size: quantity.length > 0 ? quantity : null,
      category: firstCategory(product.categories_tags),
    };
  } catch {
    // Offline, aborted, DNS failure. A barcode that will not resolve is not an error worth
    // surfacing: the model still names the item.
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Resolves a barcode, at most once per barcode per session.
 *
 * Misses are cached alongside hits. Without that, an item whose barcode is not in the database
 * sits in frame being re-requested several times a second, and the whole minute's budget is
 * gone before the user has finished scanning.
 */
export function lookupBarcode(
  cache: LookupCache,
  payload: string,
  signal?: AbortSignal,
): Promise<ResolvedProduct | null> {
  const cached = cache.entries.get(payload);
  if (cached !== undefined) return Promise.resolve(cached);

  const existing = cache.inFlight.get(payload);
  if (existing) return existing;

  // A session torn down while this lookup was queued must never reach the network or spend
  // budget on a caller that has already stopped listening. AbortSignal does not replay a past
  // abort to a listener added after the fact, so the `addEventListener` inside fetchProduct
  // would never fire for a signal that was already aborted before we got here; this has to be
  // a synchronous check up front instead. Mirrors the same guard in recognitionClient.ts.
  if (signal?.aborted) return Promise.resolve(null);

  if (!withinBudget(cache, Date.now())) return Promise.resolve(null);
  cache.recent.push(Date.now());

  const promise = fetchProduct(payload, signal)
    .then((product) => {
      cache.entries.set(payload, product);
      return product;
    })
    .finally(() => {
      cache.inFlight.delete(payload);
    });

  cache.inFlight.set(payload, promise);
  return promise;
}
