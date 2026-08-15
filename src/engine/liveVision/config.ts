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

/**
 * Variance-of-Laplacian floor for a frame worth uploading. Below this the image is motion
 * blurred or out of focus, and a blurry frame is both the most expensive kind to get wrong and
 * the most common. Tuned against `npm run bench:detector` output once real cart photos exist;
 * until then this is a starting value, not a measured one.
 */
export const MIN_KEYFRAME_SHARPNESS = 12;

/**
 * Mean absolute inter-frame difference ceiling. Above this the camera is still moving and the
 * frame will be smeared. FrameMetrics reports 1.0 (maximum motion) for the first frame of a
 * session and whenever the buffer size changes, so a session never uploads its own first frame.
 */
export const MAX_KEYFRAME_MOTION = 0.06;

/** Padding around a thumbnail crop, as a fraction of the box, so items are not cut flush. */
export const THUMBNAIL_PADDING = 0.08;

/**
 * Above this an occlusion score flips the verdict to hidden and guided capture opens. Set above
 * the strongest single signal's own maximum contribution (see `assessOcclusion` in
 * `occlusion.ts`, where the semantic signal alone tops out at 0.45) so that no one signal can
 * trip the guide by itself; two of the three must agree.
 */
export const OCCLUSION_THRESHOLD = 0.5;

/** Base URL for Open Food Facts product reads. No trailing slash; callers append `/{barcode}`. */
export const OPEN_FOOD_FACTS_ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product';

/** Their policy asks for AppName/Version (ContactEmail) so they can identify heavy clients. */
export const OPEN_FOOD_FACTS_USER_AGENT = 'Kart/1.0 (support@kart.app)';

/**
 * Their documented ceiling is 15 reads per minute per IP. Staying under it matters more than
 * it looks: on shared shop wifi the IP is not only this user's.
 */
export const MAX_BARCODE_REQUESTS_PER_MINUTE = 15;

/** Sliding window the rate limiter counts requests over, matching Open Food Facts' "per minute". */
export const BARCODE_RATE_WINDOW_MS = 60_000;

/**
 * How long a single Open Food Facts lookup may take before it is abandoned. Deliberately
 * shorter than the shared `REQUEST_TIMEOUT_MS` above: that one bounds a recognition call that
 * uploads an image and waits on a model, while this is a single indexed lookup by barcode
 * against a public database, so a slow response is worth giving up on sooner rather than
 * blocking the fast path it exists to serve.
 */
export const BARCODE_TIMEOUT_MS = 6_000;
