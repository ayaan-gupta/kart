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
 * the most common.
 *
 * Still a starting value rather than a tuned one, but it has now been checked against a real
 * handheld scan and behaves: it rejects 1 frame of 26, where the frames it keeps have a median
 * sharpness of 90. With MAX_KEYFRAME_MOTION relaxed to 0.15 this is the only blur test left, so
 * it is now load-bearing where before it was shadowed by the motion ceiling rejecting everything.
 */
export const MIN_KEYFRAME_SHARPNESS = 12;

/**
 * Mean absolute inter-frame difference ceiling. FrameMetrics reports 1.0 (maximum motion) for the
 * first frame of a session and whenever the buffer size changes, so any value below 1.0 keeps the
 * property that a session never uploads its own first frame.
 *
 * This was 0.06, chosen by eye on the reasoning that a frame above it "will be smeared". Measured
 * against a real handheld scan of a loaded trolley, that reasoning does not hold and the value
 * was catastrophic. Of 26 frames, 25 exceeded 0.06 while only 1 fell below the sharpness floor:
 * the proxy rejected almost everything the direct measure of blur accepted. Motion and sharpness
 * correlate at only -0.285 on that clip, and the frames above 0.08 still have a median sharpness
 * of 58 against a floor of 12. A phone held over a trolley moves; that is the interaction.
 *
 * What the shipped value cost, on a nine-second scan:
 *
 *     ceiling   census calls   items reaching the bag   frames rejected as moving
 *     0.06                 1                       0                   23 of 27
 *     0.10                 3                       3                         12
 *     0.15                 4                       3                          0
 *     unbounded            4                       3                          0
 *
 * One census call and nothing in the bag. At 0.15 the gate stops binding and the limiter becomes
 * `minIntervalMs`, which is the control that is supposed to pace this. Above 0.15 nothing further
 * changes, so this is the point where the motion test stops removing anything a real scan
 * produces while still rejecting the first-frame sentinel.
 *
 * Not a regression on the corpus it was previously exercised against: on the 360-frame haul
 * video, 0.15 removes all 22 motion rejections, leaves every census count unchanged, and takes
 * one segment from 1 item reaching the bag to 2.
 *
 * Blur is still gated, by MIN_KEYFRAME_SHARPNESS, which is the measurement of blur rather than a
 * proxy for it.
 */
export const MAX_KEYFRAME_MOTION = 0.15;

/** Padding around a thumbnail crop, as a fraction of the box, so items are not cut flush. */
export const THUMBNAIL_PADDING = 0.08;

/**
 * At or above this share of an item covered by the items in front of it, that one item is shown
 * as covered rather than merely unidentified, and the shopper is asked to move what is on top.
 *
 * Read off the curve in `server/eval/score_grocer_occlusion.py` rather than chosen. On 1,442
 * crops of real store shelves, with fine-tuned features and the enclosing guard in place, items
 * at or above 0.2 are named correctly 60.6% of the time against 68.1% for the rest, and the
 * accuracy falls monotonically as the score rises: 68.9% below 0.05, 59.3%, 56.8%, and 51.4%
 * above 0.6. Below 0.2 ordinary crowding gets called hiding; above 0.3 the gap narrows to three
 * points while the flagged share keeps shrinking, so the state stops firing on items that are
 * genuinely lost without buying accuracy back.
 *
 * The guard matters more than the threshold. Before enclosing boxes were excluded this flagged
 * 11.9% of crops at a 10.5 point deficit; now it flags 6.5% at 7.5. Fewer, and more of them
 * real: one whole-cart proposal used to mark every item in the cart as covered.
 *
 * This is per item. `OCCLUSION_THRESHOLD` below is a separate, scene-level verdict about
 * whether the whole cart needs walking around, and the two answer different questions.
 */
export const COVERED_FRACTION = 0.2;

/**
 * Above this an occlusion score flips the verdict to hidden and guided capture opens. Set above
 * the strongest single signal's own maximum contribution (see `assessOcclusion` in
 * `occlusion.ts`, where the semantic signal alone tops out at 0.45) so that no one signal can
 * trip the guide by itself; two of the three must agree.
 */
export const OCCLUSION_THRESHOLD = 0.5;

/** How many angular sectors the user is walked through in guided capture. Six is 60 degrees apiece. */
export const SECTOR_COUNT = 6;

/**
 * Guided capture asks for a half circle, not a full lap.
 *
 * A shopping cart is against a shelf or an aisle end as often as not, so demanding a full
 * three-sixty would leave the guide open forever in a case the user cannot fix.
 */
export const REQUIRED_SECTORS = 3;

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
