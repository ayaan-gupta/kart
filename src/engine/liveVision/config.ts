/**
 * The barcode fast path decodes any UPC that happens to face the camera and resolves it
 * against Open Food Facts in Plan 3, skipping the model entirely for that item.
 *
 * It reverses a documented product decision. The 2026-08-10 spec listed barcode scanning as a
 * non-goal, on the grounds that items should be recognized visually the way a person would.
 * The reversal is narrow and invisible: the user is never asked to find, aim at, or scan a
 * barcode, and nothing about the interaction changes. Set this to false to restore the
 * original behaviour without touching the pipeline.
 *
 * Enabling it obliges the app to carry Open Food Facts attribution under ODbL. That belongs
 * with the lookup, in Plan 3.
 */
export const ENABLE_BARCODE_FAST_PATH = true;

/** How many times a second the detector runs. Rendering stays at 60fps via Kalman prediction. */
export const DETECT_TARGET_FPS = 3;

/**
 * Base URL of the recognition service, without a trailing slash. A function rather than a
 * cached constant: `process.env.EXPO_PUBLIC_KART_API_URL` is read on every call, not once at
 * module load. A module-level constant would freeze at whatever the environment held the first
 * time this file was imported, which on a real device is stable for the process's lifetime, but
 * makes the value impossible to vary from a test's `beforeEach`, since imports resolve before
 * any hook runs.
 *
 * `EXPO_PUBLIC_` is the only prefix Expo inlines into the client bundle, which is exactly why
 * nothing secret may ever be read this way. This holds a public hostname and nothing else. The
 * OpenAI key lives in the Vercel environment and never leaves the server.
 *
 * Unset is a supported state, not a bug: the app runs, tracks, and draws outlines with no
 * endpoint at all. It simply never names anything.
 */
export function apiBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_KART_API_URL ?? '').replace(/\/+$/, '');
}

/** How long any single recognition request may take before it is abandoned. */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Hard ceiling on census calls per scan session. This bounds a scan to a small, predictable
 * number of model calls plus whatever crops it needs, and it bounds upload volume to roughly
 * 2.4 MB. Without a cap, leaving the scan screen open on a table racks up calls indefinitely.
 */
export const MAX_CENSUS_CALLS_PER_SESSION = 8;

/** Hard ceiling on crop identifications per scan session, for the same reason. */
export const MAX_IDENTIFY_CALLS_PER_SESSION = 6;

/**
 * At or above this an identity is trusted: the item turns green, enters the bag, and stops
 * being offered for a closer look.
 *
 * It lives here rather than beside the orchestrator so the overlay can read it without a UI
 * component importing the async session machinery.
 */
export const GREEN_CONFIDENCE = 0.55;
