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
 * Deliberately free of React and of the camera. It takes a base64 image and a `requestCensus`
 * function, so a test can drive a whole multi-photograph session with no device, and the screen
 * above it holds no counting rules of its own.
 */
import { applyCensus, bagLines, createFusionState, type BagLine, type FusionState } from './fusion';
import type { CensusPayload, CensusRequest, ClientFailure, ClientResult } from './recognitionClient';

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
}

export type PhotoScanOutcome =
  | {
      ok: true;
      state: PhotoScanState;
      /** The whole bag after this photograph, not just what it added. */
      lines: BagLine[];
      /** How many products this photograph put in the bag that were not already in it. */
      added: number;
    }
  | { ok: false; failure: ClientFailure; state: PhotoScanState };

export function createPhotoScanState(): PhotoScanState {
  return { fusion: createFusionState() };
}

export async function scanPhoto(
  state: PhotoScanState,
  imageBase64: string,
  deps: PhotoScanDeps,
): Promise<PhotoScanOutcome> {
  const before = bagLines(state.fusion);

  // What the bag already holds, so the census reuses a phrasing rather than inventing a third.
  // A photograph session asks about one scene repeatedly in exactly the way a live scan does,
  // so it has the same failure: one bag arriving as "packaged apples", then "red apples", then
  // "bag of apples", opening three lines nothing downstream can join.
  const result = await deps.requestCensus({
    imageBase64,
    counted: before.map((line) => line.name),
  });

  if (!result.ok) return { ok: false, failure: result.failure, state };

  // No marks and no tracks: nothing was detected and nothing is being followed, so every product
  // arrives through `unmarkedItems` and the empty track arguments are the honest ones. `applyCensus`
  // already handles that case, which is what the degraded enumeration path has always relied on.
  const fusion = applyCensus(state.fusion, result.value, {}, [], false, {});
  const lines = bagLines(fusion);

  const seen = new Set(before.map((line) => line.key));
  return {
    ok: true,
    state: { fusion },
    lines,
    added: lines.filter((line) => !seen.has(line.key)).length,
  };
}
