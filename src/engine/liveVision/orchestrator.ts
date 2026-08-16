import {
  addAlias,
  applyBarcode,
  applyCensus,
  createFusionState,
  isBarcodeKey,
  productKey,
  resolveKey,
  type FusionState,
} from './fusion';
import { assessOcclusion, type OcclusionVerdict } from './occlusion';
import type { ClientResult, IdentifyResult, CensusPayload } from './recognitionClient';
import type { ResolvedProduct } from './barcodeLookup';
import type { Box, Track } from './types';
import {
  GREEN_CONFIDENCE,
  MAX_CENSUS_CALLS_PER_SESSION,
  MAX_IDENTIFY_CALLS_PER_SESSION,
} from './config';

/** How long an item must stay amber before the "come closer" copy appears. */
export const AMBER_DWELL_MS = 1500;

/** The server rejects more than this many marks, and dense badges confuse mark association. */
const MAX_MARKS = 40;

export interface SessionState {
  fusion: FusionState;
  occlusion: OcclusionVerdict;
  /** productKey -> local file URI of a photo of that item. Keyed on the product, not the
   * track, because ByteTrack retires track ids and the bag outlives them. */
  thumbnails: Record<string, string>;
  /** trackId -> when it first went amber, for the dwell. */
  amberSince: Record<string, number>;
  censusCalls: number;
  identifyCalls: number;
  /** Plain-string message from the most recent rejecting dependency, or null. Never a native
   * error object, matching `FrameScan.error`: a session that throws every call is otherwise
   * indistinguishable from one that works. Not cleared automatically; it is a diagnostic, not a
   * transient banner. */
  lastError: string | null;
}

export function createSessionState(): SessionState {
  return {
    fusion: createFusionState(),
    occlusion: { hidden: false, score: 0, reasons: [] },
    thumbnails: {},
    amberSince: {},
    censusCalls: 0,
    identifyCalls: 0,
    lastError: null,
  };
}

/**
 * Chooses which tracks to ask about and numbers them.
 *
 * Only confirmed tracks are marked. A tentative track may be a detector artefact that will be
 * gone next frame, and every mark spent on one is a badge drawn on the image and a line in the
 * prompt. Over the cap, the largest items win: they are the ones a person would name first, and
 * the smallest boxes are the likeliest to be noise.
 */
export function marksFor(
  tracks: Track[],
  limit = MAX_MARKS,
): { marks: { id: number; box: Box }[]; markToTrack: Record<number, string> } {
  const eligible = tracks
    .filter((t) => t.state === 'confirmed')
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
    .slice(0, limit);

  const marks: { id: number; box: Box }[] = [];
  const markToTrack: Record<number, string> = {};
  eligible.forEach((t, index) => {
    // Mark ids start at 1: a zero badge reads as an "O" against some packaging.
    const id = index + 1;
    marks.push({ id, box: t.box });
    markToTrack[id] = t.id;
  });
  return { marks, markToTrack };
}

/**
 * Tracks whose identity is not trustworthy yet, and which are still on screen and still counted.
 *
 * Excludes a track the in-view clamp has folded into a sibling (`fusion.merged`). A merged track
 * is the same physical item as its group's survivor, so identifying it separately spends the
 * same crop-identify budget again for nothing new, and a misread on that crop is free to alias
 * the survivor's already-good identity onto something else entirely, which is worse than simply
 * not asking. `resolveUncertain`'s alias step is what keeps the count correct even when a merged
 * sibling never gets examined at all (a resolved track's high-water mark now migrates to its new
 * key, and a merged sibling's stale key still resolves through that alias); this exclusion is a
 * second, independent improvement on top of it: fewer wasted calls, and no risk of a crop on a
 * folded duplicate overwriting a correct identity with a worse one.
 */
export function amberTrackIds(state: SessionState, tracks: Track[]): string[] {
  const merged = new Set(state.fusion.merged);
  return tracks
    .filter((t) => {
      if (t.state === 'lost' || merged.has(t.id)) return false;
      const identity = state.fusion.identities[t.id];
      if (!identity) return false;
      return identity.needsCloserLook || identity.confidence < GREEN_CONFIDENCE;
    })
    .map((t) => t.id);
}

/**
 * True when some amber item has been amber long enough to be worth telling the user about.
 *
 * Checks the track's live identity, not a re-derived membership in `amberTrackIds`: `fusion`
 * persists across frames and outlives any single census, so an identity that has since gone
 * green (a barcode resolving it, for instance) is visible right here and must clear the dwell
 * clock's verdict. A track with no identity at all is treated as still amber: nothing has
 * contradicted the clock, so there is no reason to clear it early. A track that has left the
 * frame is ignored outright; the notice is about something the user can still act on.
 */
export function persistentAmber(state: SessionState, tracks: Track[], now: number): boolean {
  const live = new Map(tracks.filter((t) => t.state !== 'lost').map((t) => [t.id, t] as const));
  for (const [trackId, since] of Object.entries(state.amberSince)) {
    if (!live.has(trackId) || now - since < AMBER_DWELL_MS) continue;
    const identity = state.fusion.identities[trackId];
    if (!identity || identity.needsCloserLook || identity.confidence < GREEN_CONFIDENCE) return true;
  }
  return false;
}

/** Counted items whose product does not have a photo yet. */
export function tracksNeedingThumbnail(state: SessionState, tracks: Track[]): { id: string; box: Box }[] {
  const wanted: { id: string; box: Box }[] = [];
  const claimed = new Set<string>();
  for (const t of tracks) {
    if (t.state !== 'confirmed') continue;
    const identity = state.fusion.identities[t.id];
    if (!identity || identity.confidence < GREEN_CONFIDENCE) continue;
    const key = resolveKey(state.fusion, identity.key);
    if (state.thumbnails[key] || claimed.has(key)) continue;
    claimed.add(key);
    wanted.push({ id: t.id, box: t.box });
  }
  return wanted;
}

export interface SessionDeps {
  requestCensus: (
    req: { imageBase64: string; marks: { id: number; box: Box }[] },
    signal?: AbortSignal,
  ) => Promise<ClientResult<CensusPayload>>;
  requestIdentify: (
    req: { imageBase64: string; box: Box | null; hint: string | null },
    signal?: AbortSignal,
  ) => Promise<ClientResult<IdentifyResult>>;
  lookupBarcode: (payload: string, signal?: AbortSignal) => Promise<ResolvedProduct | null>;
  /** Writes a base64 JPEG to disk and returns its URI. */
  saveThumbnail: (key: string, base64: string) => Promise<string | null>;
}

/**
 * Owns every asynchronous decision in the scan.
 *
 * The frame loop calls into this and never awaits it. A slow or failing network must never
 * hold up rendering, so nothing here is on the path between a frame arriving and an outline
 * being drawn.
 */
export class RecognitionSession {
  state: SessionState = createSessionState();

  private censusInFlight = false;
  private disposed = false;
  /** Set once the endpoint proves to be unconfigured. Retrying that can never succeed. */
  private permanentlyUnavailable = false;
  private readonly resolvedBarcodes = new Set<string>();
  /** Product keys with a save in flight, so two overlapping crops for the same product cannot
   * both see an empty thumbnail slot and both write. Claimed before the await, mirroring
   * `resolvedBarcodes`. */
  private readonly savingThumbnails = new Set<string>();
  private readonly controller = new AbortController();

  constructor(private readonly deps: SessionDeps) {}

  /** Cancels in-flight work. Called when the scan screen unmounts. */
  dispose(): void {
    this.disposed = true;
    this.controller.abort();
  }

  /**
   * Turns a rejection into the plain-string error shape the rest of this branch uses (see
   * `FrameScan.error` in `types.ts`) and files it on state so the UI can surface it.
   *
   * The frame loop never awaits `onKeyframe`, `onCrops` or `onBarcodes`, so a dependency that
   * rejects instead of resolving would otherwise become an unhandled rejection inside a frame
   * handler. `requestCensus`, `requestIdentify` and the real `lookupBarcode` all promise never to
   * throw, but `saveThumbnail` writes to disk and can reject on a full disk or a permissions
   * problem, so every public method that awaits a dependency needs this backstop regardless.
   */
  private recordError(error: unknown): void {
    const message = error instanceof Error ? error.message : 'recognition step failed';
    this.state = { ...this.state, lastError: message };
  }

  /**
   * Whether the next good frame should be encoded and uploaded.
   *
   * Two independent gates, both of which must agree. This method answers the session-eligibility
   * half: is anything confirmed, is a call already in flight, is the budget spent. `paced` is the
   * other half, `evaluateKeyframe`'s verdict for this same frame (sharp enough, still enough, and
   * paced by `minIntervalMs` / the scene-change interval; see `pipeline.ts` and `keyframe.ts`),
   * which only the caller has, so it is passed in rather than recomputed here.
   *
   * Defaults to `true` so `onKeyframe`'s own internal guard below, and every existing test, can
   * keep asking only the session-eligibility question. `scan.tsx` is the one caller deciding
   * whether to *request* a keyframe at all, and it must pass its actual pacing verdict, or
   * `minIntervalMs` has no effect on device and the census budget can be spent in well under a
   * minute of scanning.
   */
  wantsKeyframe(tracks: Track[], paced = true): boolean {
    if (this.disposed || this.permanentlyUnavailable) return false;
    if (this.censusInFlight) return false;
    if (this.state.censusCalls >= MAX_CENSUS_CALLS_PER_SESSION) return false;
    if (!paced) return false;
    return tracks.some((t) => t.state === 'confirmed');
  }

  async onKeyframe(imageBase64: string, tracks: Track[], now: number): Promise<void> {
    if (!this.wantsKeyframe(tracks)) return;

    const { marks, markToTrack } = marksFor(tracks);
    if (marks.length === 0) return;

    const liveTrackIds = Object.values(markToTrack);
    this.censusInFlight = true;
    this.state = { ...this.state, censusCalls: this.state.censusCalls + 1 };

    try {
      const result = await this.deps.requestCensus({ imageBase64, marks }, this.controller.signal);
      if (this.disposed) return;

      if (!result.ok) {
        // An unset base URL cannot start working mid-session, so stop asking. Every other
        // failure is transient and the next keyframe may well succeed.
        if (result.failure === 'unconfigured') this.permanentlyUnavailable = true;
        return;
      }

      // Boxes go with the ids so the counting rule can tell several proposals on one physical
      // item from several items. Only the marked tracks matter: an unmarked track is not being
      // counted this census, so it has nothing to fold into.
      const liveBoxes: Record<string, Box> = {};
      for (const track of tracks) {
        if (liveTrackIds.includes(track.id)) liveBoxes[track.id] = track.box;
      }
      const fusion = applyCensus(
        this.state.fusion, result.value, markToTrack, liveTrackIds, false, liveBoxes);
      const occlusion = assessOcclusion({
        semantic: result.value.occlusion,
        boxes: tracks.filter((t) => t.state === 'confirmed').map((t) => t.box),
        unmarkedCount: result.value.unmarkedItems.length,
      });

      this.state = { ...this.state, fusion, occlusion, amberSince: this.nextAmberSince(fusion, tracks, now) };

      await this.resolveUncertain(imageBase64, tracks, now);
    } catch (error) {
      this.recordError(error);
    } finally {
      this.censusInFlight = false;
    }
  }

  /** Starts or clears the dwell clock for each amber track. */
  private nextAmberSince(fusion: FusionState, tracks: Track[], now: number): Record<string, number> {
    const amber = new Set(amberTrackIds({ ...this.state, fusion }, tracks));
    const next: Record<string, number> = {};
    for (const trackId of amber) {
      next[trackId] = this.state.amberSince[trackId] ?? now;
    }
    return next;
  }

  /**
   * Sends a tight crop of each uncertain item for a second, more careful look.
   *
   * Sequential rather than concurrent: these run against the same rate limits and budget, and
   * a burst of parallel uploads on a phone's uplink is slower in wall-clock terms than doing
   * them one at a time.
   */
  private async resolveUncertain(imageBase64: string, tracks: Track[], now: number): Promise<void> {
    const uncertain = amberTrackIds(this.state, tracks);

    for (const trackId of uncertain) {
      if (this.disposed) return;
      if (this.state.identifyCalls >= MAX_IDENTIFY_CALLS_PER_SESSION) return;

      const track = tracks.find((t) => t.id === trackId);
      const identity = this.state.fusion.identities[trackId];
      if (!track || !identity) continue;

      this.state = { ...this.state, identifyCalls: this.state.identifyCalls + 1 };

      const result = await this.deps.requestIdentify(
        { imageBase64, box: track.box, hint: identity.name },
        this.controller.signal,
      );
      if (this.disposed || !result.ok) continue;

      // `/api/identify` exists to return a better, and therefore usually different, name. A
      // different name is a different productKey, and applyCensus's in-view clamp is about to
      // group this call's one live track under that new key alone: a group of one, high-water
      // mark one. Without this, the quantity already accumulated under the track's old key (the
      // whole sibling group's count, not just this track's) is stranded there, orphaned the
      // moment this identity moves off it. Alias the old key to the new one first so that
      // quantity migrates to the surviving key, exactly what applyBarcode already does when a
      // barcode resolves a track that already had a VLM guess. A track still on its old key
      // (a merged sibling this call never reaches, or one a later census hasn't caught up to
      // yet) keeps resolving to the right place because resolveKey follows the alias.
      //
      // Skipped when the track's current key is already a barcode's: that key is ground truth,
      // and only the two-in-a-row corroboration path in applyCensus is allowed to link a fresh
      // guess onto it. A single, uncorroborated identify answer does not clear that bar, and
      // redirecting a barcode-owned key on one crop's say-so would undo that protection.
      const value = result.value;
      let fusion = this.state.fusion;
      const oldKey = resolveKey(fusion, identity.key);
      const newKey = resolveKey(fusion, productKey(value.name, value.brand));
      if (oldKey !== newKey && !isBarcodeKey(oldKey)) {
        fusion = addAlias(fusion, oldKey, newKey);
      }

      // Reuse applyCensus so the crop result goes through exactly the same clamp and
      // barcode-precedence rules as a census mark. A second code path here would be a second
      // place for the counting rule to drift.
      this.state = {
        ...this.state,
        fusion: applyCensus(
          fusion,
          {
            marks: [{
              id: 1,
              name: value.name,
              brand: value.brand,
              size: value.size,
              category: value.category,
              confidence: value.confidence,
              needsCloserLook: value.stillUnclear,
            }],
            // A crop shows one item, so it says nothing about how many are in view. Sending a
            // count of 1 here would clamp every sibling of this product away.
            inViewCounts: [],
          },
          { 1: trackId },
          [trackId],
          // A closer look. Marks the identity verifiedByIdentify so the next plain census mark
          // cannot clobber it outright (see fusion.ts), and exempts this call itself from that
          // same protection so a second identify always supersedes the first.
          true,
        ),
      };
    }

    this.state = { ...this.state, amberSince: this.nextAmberSince(this.state.fusion, tracks, now) };
  }

  /** Files the pictures the plugin cut for us. */
  async onCrops(crops: { id: string; jpeg: string }[]): Promise<void> {
    for (const crop of crops) {
      if (this.disposed) return;
      const identity = this.state.fusion.identities[crop.id];
      if (!identity) continue;
      const key = resolveKey(this.state.fusion, identity.key);
      // Claim the slot before the await, not after: `tracksNeedingThumbnail` keeps returning the
      // same track every frame until the save actually lands in state, and the frame loop calls
      // this without awaiting it, so two overlapping saves for the same product are routine, not
      // a rare interleaving. Reading `thumbnails` alone would let both see it empty.
      if (this.state.thumbnails[key] || this.savingThumbnails.has(key)) continue;
      this.savingThumbnails.add(key);

      try {
        const uri = await this.deps.saveThumbnail(key, crop.jpeg);
        if (uri === null || this.disposed) continue;
        this.state = { ...this.state, thumbnails: { ...this.state.thumbnails, [key]: uri } };
      } catch (error) {
        this.recordError(error);
      } finally {
        this.savingThumbnails.delete(key);
      }
    }
  }

  /** Resolves any newly decoded barcode and attaches it to its track. */
  async onBarcodes(hits: { trackId: string; payload: string }[]): Promise<void> {
    for (const hit of hits) {
      if (this.disposed) return;
      const seen = `${hit.trackId}:${hit.payload}`;
      if (this.resolvedBarcodes.has(seen)) continue;
      this.resolvedBarcodes.add(seen);

      try {
        const resolved = await this.deps.lookupBarcode(hit.payload, this.controller.signal);
        if (this.disposed) return;
        this.state = { ...this.state, fusion: applyBarcode(this.state.fusion, hit.trackId, hit.payload, resolved) };
      } catch (error) {
        this.recordError(error);
      }
    }
  }
}
