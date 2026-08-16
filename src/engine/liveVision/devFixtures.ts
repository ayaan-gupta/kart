import type { CensusPayload, ClientResult, IdentifyResult } from './recognitionClient';
import type { Box } from './types';

/**
 * Local, offline stand-ins for `requestCensus`/`requestIdentify` (see `recognitionClient.ts`),
 * used only by the developer Frame Lab screen (`src/app/dev/frame-lab.tsx`).
 *
 * The task this harness exists for is explicit: no network call to the recognition endpoint,
 * because it is not deployed and there is no key. `RecognitionSession` (orchestrator.ts),
 * `applyCensus`/`bagLines` (fusion.ts) and the bag UI have no server-shaped substitute otherwise,
 * so these two functions are the one deliberately-not-real piece of this harness. Everything
 * downstream of them - `RecognitionSession` itself, the counting rule, aliasing, `bagLines`,
 * `BagTray`, `CoachNotice` - runs unmodified, for real, against whatever these return. They
 * match `SessionDeps['requestCensus']`/`SessionDeps['requestIdentify']`'s exact shape, so
 * swapping in the real `recognitionClient.ts` functions (once a server exists) is a one-line
 * change in the dev screen, not a rewrite.
 *
 * Deterministic and keyed only on the mark's position in the request, not on anything read from
 * the image: this harness has no model of its own, so it always assigns the same names in the
 * same order rather than pretending to recognize the five shapes in the bundled test photograph.
 */
const DEV_NAMES: { name: string; size: string }[] = [
  { name: 'Garnet Carton', size: '12 oz' },
  { name: 'Cobalt Bottle', size: '1 L' },
  { name: 'Meadow Box', size: '340 g' },
  { name: 'Amber Crate', size: '6 ct' },
  { name: 'Violet Tub', size: '454 g' },
];

function nameFor(index: number): { name: string; size: string } {
  return DEV_NAMES[index % DEV_NAMES.length];
}

/**
 * Stands in for `requestCensus`. Names every requested mark from the fixed, deterministic list
 * above, at a confidence just under `GREEN_CONFIDENCE` (see `config.ts`) so each item goes amber
 * first and is picked up by `resolveUncertain`'s crop-identify pass, exactly like a real,
 * moderately-confident wide-shot guess would: this exercises the amber-to-green transition
 * through `devRequestIdentify` below, not just a single-call green result.
 */
export function devRequestCensus(
  req: { imageBase64: string; marks?: { id: number; box: Box }[] },
  _signal?: AbortSignal,
): Promise<ClientResult<CensusPayload>> {
  // The stand-in never enumerates: it is fed marks by the on-device path it replaces.
  const requested = req.marks ?? [];
  const marks = requested.map((mark, index) => {
    const { name, size } = nameFor(index);
    return {
      id: mark.id,
      name,
      brand: null,
      size,
      category: 'Grocery',
      confidence: 0.4,
      needsCloserLook: false,
    };
  });

  const payload: CensusPayload = {
    marks,
    // One of each: the bundled test image has one instance of each shape, and the local
    // stand-in has no reason to claim otherwise.
    inViewCounts: [],
    occlusion: { itemsLikelyHidden: false, severity: 'none', reason: 'dev fixture: no occlusion modeled' },
    unmarkedItems: [],
    regions: [],
    enumeration: 'client',
  };
  return Promise.resolve({ ok: true, value: payload });
}

/**
 * Stands in for `requestIdentify`. `orchestrator.ts` sends the census guess back as `hint`, so
 * echoing it back at a high, confident score is what a real closer look agreeing with the wide
 * shot looks like: `outlineStateFor` (ItemHighlights.tsx) reads this as `'counted'` and the
 * overlay turns the item green with a check.
 */
export function devRequestIdentify(
  req: { imageBase64: string; box: Box | null; hint: string | null },
  _signal?: AbortSignal,
): Promise<ClientResult<IdentifyResult>> {
  const known = DEV_NAMES.find((entry) => entry.name === req.hint);
  const result: IdentifyResult = {
    name: req.hint ?? 'Dev Item',
    brand: null,
    size: known?.size ?? null,
    category: 'Grocery',
    confidence: 0.92,
    stillUnclear: false,
  };
  return Promise.resolve({ ok: true, value: result });
}
