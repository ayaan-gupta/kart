import { apiBaseUrl, REQUEST_TIMEOUT_MS } from './config';
import type { CensusMark, CensusResult } from './fusion';
import type { Box } from './types';

/**
 * Why the call did not produce a result. These are deliberately coarse: the UI does not show
 * any of them to the user, and the orchestrator only needs to know whether retrying could help.
 *
 *  - `unconfigured`: no endpoint is set. Permanent until the build changes. Do not retry.
 *  - `offline`:      the request never reached a server. Retrying later is reasonable.
 *  - `timeout`:      it reached a server but took too long. Retrying later is reasonable.
 *  - `rejected`:     the server refused the request (4xx). Our bug. Retrying sends the same bug.
 *  - `server`:       the server failed (5xx). Often transient and safe to retry later, but
 *                     not always: a request whose fields are each individually valid but
 *                     combine into something the server cannot act on (an off-frame crop box,
 *                     for example) can produce a deterministic 500 that repeats on every
 *                     identical retry. A caller must bound retries by the session call ceiling
 *                     (`MAX_CENSUS_CALLS_PER_SESSION` / `MAX_IDENTIFY_CALLS_PER_SESSION`), not
 *                     by retrying `server` until it succeeds.
 *  - `malformed`:    a 2xx whose body was not what we expect. Treated as a bug, not retried.
 */
export type ClientFailure = 'offline' | 'timeout' | 'unconfigured' | 'rejected' | 'server' | 'malformed';

export type ClientResult<T> = { ok: true; value: T } | { ok: false; failure: ClientFailure };

export interface OcclusionReport {
  itemsLikelyHidden: boolean;
  severity: 'none' | 'some' | 'many';
  reason: string;
}

export interface UnmarkedItem {
  description: string;
  /** The model's own product key, so the sighting joins exactly to its count and to any badge. */
  productKey: string;
  approxLocation: string;
  confidence: number;
}

export type CensusPayload = CensusResult & {
  occlusion: OcclusionReport;
  unmarkedItems: UnmarkedItem[];
};

export interface CensusRequest {
  imageBase64: string;
  marks: { id: number; box: Box }[];
}

export interface IdentifyRequest {
  imageBase64: string;
  box: Box | null;
  hint: string | null;
}

export interface IdentifyResult {
  name: string;
  brand: string | null;
  size: string | null;
  category: string;
  confidence: number;
  stillUnclear: boolean;
}

/**
 * One POST, with every failure mode folded into a ClientResult rather than thrown.
 *
 * Nothing above this function may throw on a network problem. The scan screen keeps tracking
 * and drawing outlines whether or not the endpoint exists, and an unhandled rejection inside a
 * frame handler would take that down.
 */
async function post<T>(
  path: string,
  body: unknown,
  parse: (value: unknown) => T | null,
  signal?: AbortSignal,
): Promise<ClientResult<T>> {
  const base = apiBaseUrl();
  if (base === '') return { ok: false, failure: 'unconfigured' };

  // A signal that is already aborted when we're called (a session torn down while this request
  // was queued) must never reach the network. AbortSignal does not replay a past abort to a
  // listener added after the fact, so `addEventListener` below would never fire for it; this has
  // to be a synchronous check up front instead.
  if (signal?.aborted) return { ok: false, failure: 'timeout' };

  // Two abort sources: our own timeout, and the caller ending the scan session. AbortSignal.any
  // is not available in the Hermes runtime, so the timeout drives a controller that the
  // caller's signal also fires.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener('abort', onCallerAbort);

  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, failure: response.status >= 500 ? 'server' : 'rejected' };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      // A 200 carrying HTML is the classic signature of hitting a deployment's login wall or a
      // stale route, and JSON.parse throwing inside a frame handler must not surface as a crash.
      return { ok: false, failure: 'malformed' };
    }

    const envelope = payload as { ok?: unknown; result?: unknown };
    if (envelope?.ok !== true) return { ok: false, failure: 'malformed' };

    const parsed = parse(envelope.result);
    return parsed === null ? { ok: false, failure: 'malformed' } : { ok: true, value: parsed };
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    return { ok: false, failure: name === 'AbortError' ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const nullableStr = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Validates the census body field by field.
 *
 * The server already validates against a strict schema, so this is not a second line of defence
 * against the model. It is a defence against reaching the wrong server: a proxy, a login page,
 * an older deployment. Anything unrecognised is dropped rather than allowed to reach fusion,
 * because a mark with a string id would silently never match a track.
 */
function parseCensus(value: unknown): CensusPayload | null {
  if (!isRecord(value) || !Array.isArray(value.marks)) return null;

  const marks: CensusMark[] = [];
  for (const raw of value.marks) {
    if (!isRecord(raw) || typeof raw.id !== 'number' || !Number.isInteger(raw.id)) continue;
    if (typeof raw.name !== 'string') continue;
    marks.push({
      id: raw.id,
      name: raw.name,
      brand: nullableStr(raw.brand),
      size: nullableStr(raw.size),
      category: str(raw.category, 'Grocery'),
      confidence: Math.min(1, Math.max(0, num(raw.confidence))),
      needsCloserLook: raw.needsCloserLook === true,
      // Absent means true. A server that predates this field was identifying products, and
      // defaulting to false there would empty the bag rather than clean it.
      isProduct: raw.isProduct !== false,
    });
  }

  const inViewCounts: CensusResult['inViewCounts'] = [];
  if (Array.isArray(value.inViewCounts)) {
    for (const raw of value.inViewCounts) {
      if (!isRecord(raw) || typeof raw.productKey !== 'string') continue;
      inViewCounts.push({ productKey: raw.productKey, count: Math.max(0, Math.round(num(raw.count))) });
    }
  }

  const unmarkedItems: UnmarkedItem[] = [];
  if (Array.isArray(value.unmarkedItems)) {
    for (const raw of value.unmarkedItems) {
      if (!isRecord(raw) || typeof raw.description !== 'string') continue;
      unmarkedItems.push({
        description: raw.description,
        // An older server, or a model that skipped the field, leaves this empty and fusion
        // falls back to keying off the description.
        productKey: typeof raw.productKey === 'string' ? raw.productKey : '',
        approxLocation: str(raw.approxLocation),
        confidence: Math.min(1, Math.max(0, num(raw.confidence))),
      });
    }
  }

  const rawOcclusion = isRecord(value.occlusion) ? value.occlusion : {};
  const severity = rawOcclusion.severity;
  const occlusion: OcclusionReport = {
    itemsLikelyHidden: rawOcclusion.itemsLikelyHidden === true,
    severity: severity === 'some' || severity === 'many' ? severity : 'none',
    reason: str(rawOcclusion.reason),
  };

  return { marks, inViewCounts, unmarkedItems, occlusion };
}

function parseIdentify(value: unknown): IdentifyResult | null {
  if (!isRecord(value) || typeof value.name !== 'string') return null;
  return {
    name: value.name,
    brand: nullableStr(value.brand),
    size: nullableStr(value.size),
    category: str(value.category, 'Grocery'),
    confidence: Math.min(1, Math.max(0, num(value.confidence))),
    stillUnclear: value.stillUnclear === true,
  };
}

export function requestCensus(req: CensusRequest, signal?: AbortSignal): Promise<ClientResult<CensusPayload>> {
  return post('/api/census', { image: req.imageBase64, marks: req.marks }, parseCensus, signal);
}

export function requestIdentify(req: IdentifyRequest, signal?: AbortSignal): Promise<ClientResult<IdentifyResult>> {
  return post(
    '/api/identify',
    // The server treats an absent box as "use the whole image", so send nothing rather than null.
    { image: req.imageBase64, hint: req.hint, ...(req.box ? { box: req.box } : {}) },
    parseIdentify,
    signal,
  );
}
