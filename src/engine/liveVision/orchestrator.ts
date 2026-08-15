import {
  applyBarcode,
  applyCensus,
  createFusionState,
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
}

export function createSessionState(): SessionState {
  return {
    fusion: createFusionState(),
    occlusion: { hidden: false, score: 0, reasons: [] },
    thumbnails: {},
    amberSince: {},
    censusCalls: 0,
    identifyCalls: 0,
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

/** Tracks whose identity is not trustworthy yet, and which are still on screen. */
export function amberTrackIds(state: SessionState, tracks: Track[]): string[] {
  return tracks
    .filter((t) => {
      if (t.state === 'lost') return false;
      const identity = state.fusion.identities[t.id];
      if (!identity) return false;
      return identity.needsCloserLook || identity.confidence < GREEN_CONFIDENCE;
    })
    .map((t) => t.id);
}

/**
 * True when some amber item has been amber long enough to be worth telling the user about.
 *
 * Deliberately checks presence in the current `tracks` list rather than recomputing
 * `amberTrackIds`: an entry only ever lands in `amberSince` because it was amber at the moment
 * the dwell clock started, so re-deriving "is it still amber right now" here would require this
 * frame to also carry a fresh identity for it, which a frame between census calls never does.
 * All this needs to know is whether the track has since left the frame.
 */
export function persistentAmber(state: SessionState, tracks: Track[], now: number): boolean {
  const present = new Set(tracks.filter((t) => t.state !== 'lost').map((t) => t.id));
  for (const [trackId, since] of Object.entries(state.amberSince)) {
    if (present.has(trackId) && now - since >= AMBER_DWELL_MS) return true;
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
  private readonly controller = new AbortController();

  constructor(private readonly deps: SessionDeps) {}

  /** Cancels in-flight work. Called when the scan screen unmounts. */
  dispose(): void {
    this.disposed = true;
    this.controller.abort();
  }

  /**
   * Whether the next good frame should be encoded and uploaded.
   *
   * This is the half of the keyframe gate that JavaScript can answer. Sharpness and stillness
   * are decided natively on the frame itself, so a frame is only ever encoded when both halves
   * agree and no encode is wasted.
   */
  wantsKeyframe(tracks: Track[]): boolean {
    if (this.disposed || this.permanentlyUnavailable) return false;
    if (this.censusInFlight) return false;
    if (this.state.censusCalls >= MAX_CENSUS_CALLS_PER_SESSION) return false;
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

      const fusion = applyCensus(this.state.fusion, result.value, markToTrack, liveTrackIds);
      const occlusion = assessOcclusion({
        semantic: result.value.occlusion,
        boxes: tracks.filter((t) => t.state === 'confirmed').map((t) => t.box),
        unmarkedCount: result.value.unmarkedItems.length,
      });

      this.state = { ...this.state, fusion, occlusion, amberSince: this.nextAmberSince(fusion, tracks, now) };

      await this.resolveUncertain(imageBase64, tracks, now);
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

      // Reuse applyCensus so the crop result goes through exactly the same clamp, alias, and
      // barcode-precedence rules as a census mark. A second code path here would be a second
      // place for the counting rule to drift.
      const value = result.value;
      this.state = {
        ...this.state,
        fusion: applyCensus(
          this.state.fusion,
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
      if (this.state.thumbnails[key]) continue;

      const uri = await this.deps.saveThumbnail(key, crop.jpeg);
      if (uri === null || this.disposed) continue;
      this.state = { ...this.state, thumbnails: { ...this.state.thumbnails, [key]: uri } };
    }
  }

  /** Resolves any newly decoded barcode and attaches it to its track. */
  async onBarcodes(hits: { trackId: string; payload: string }[]): Promise<void> {
    for (const hit of hits) {
      if (this.disposed) return;
      const seen = `${hit.trackId}:${hit.payload}`;
      if (this.resolvedBarcodes.has(seen)) continue;
      this.resolvedBarcodes.add(seen);

      const resolved = await this.deps.lookupBarcode(hit.payload, this.controller.signal);
      if (this.disposed) return;
      this.state = { ...this.state, fusion: applyBarcode(this.state.fusion, hit.trackId, hit.payload, resolved) };
    }
  }
}
