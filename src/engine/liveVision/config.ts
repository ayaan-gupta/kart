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

/**
 * `__DEV__` is Metro's build-mode global, declared here rather than relied on from ambient types.
 *
 * The app's typecheck sees it through react-native's globals, so nothing in the app needed this.
 * The eval does not: `server/eval/pipeline/*.ts` imports this module's neighbours so the
 * verification set runs the same code the phone runs, and `server/tsconfig.json` carries only
 * `types: ["node"]`. Without this line `npm run typecheck --prefix server` fails on the one
 * reference below, which is how the guard reached a commit unnoticed.
 *
 * Declaring it costs nothing at runtime: `declare` emits no JavaScript, so `__DEV__` stays a free
 * identifier and Metro still substitutes the literal and eliminates the dead branch in a Release
 * build, which is the only reason the guard works.
 */
declare const __DEV__: boolean;

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

/**
 * How long any single recognition request may take before it is abandoned.
 *
 * 20 seconds is the product value and the default, chosen against the shipped model, which
 * answers a whole frame in one call. It stays the default because a shopper holding a phone over
 * a trolley will not wait longer than that for the bag to move.
 *
 * It is overridable only because the local fallback exists. `server/localvlm/serve.py` asks the
 * model one question per region, which measured 58 to 73 seconds for nine regions on an M-series
 * Mac, so against that server every request aborts at 20s and the shopper gets the unavailable
 * notice while the census is still running. That is the right product behaviour and the wrong
 * development behaviour, so the budget can be raised for a development build and nowhere else.
 *
 * Read at call time rather than frozen at module load, for the reason `apiBaseUrl` documents.
 */
export function requestTimeoutMs(): number {
  const raw = Number((process.env.EXPO_PUBLIC_KART_REQUEST_TIMEOUT_MS ?? '').trim());
  if (!Number.isFinite(raw) || raw <= 0) return REQUEST_TIMEOUT_MS;

  // A Release build ignores the override entirely, rather than trusting whoever set it.
  //
  // The override exists so a local run against a slow stand-in model can finish; the local VLM
  // fallback answers one region at a time and needs minutes where the shipped model needs
  // seconds. `.env` on this machine therefore carries 900000, fifteen minutes, under a comment
  // saying not to ship a build with it. That comment is the entire protection, and `.env` is
  // read at build time by whoever happens to run the build.
  //
  // Shipping it would be a bad failure rather than a slow one: a request that hangs would hold
  // the scan for fifteen minutes instead of failing at twenty seconds, and `censusFailures`
  // would never rise, so the "scanning isn't working" notice could not appear either. The
  // shopper would watch a live camera that silently never adds anything.
  if (!__DEV__) return REQUEST_TIMEOUT_MS;
  return raw;
}

/** The product default, kept as a named constant so tests and callers can refer to it. */
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
 *
 * **This number is on the wrong scale, and on a phone it rejects nothing.** Found 2026-08-22.
 * The "median sharpness of 90" above is `score_video.py`'s figure, the variance of the Laplacian
 * over the *whole* frame. `FrameMetrics.sharpness` does not compute that: it takes a 3 by 3 grid
 * of 128-pixel tiles and returns the **largest** tile's variance, which is a different measure and
 * runs 2 to 6 times higher. Both were computed over the same 26 corpus frames:
 *
 *     whole frame (what this 12 was set against)   min 10, median  90, max 392
 *     max tile    (what the device actually sends) min 25, median 295, max 854
 *
 * So the value that rejects the blurriest frame of 26 in the eval is below every frame's device
 * reading, and the only blur test left is inert on the shipped path. Deliberately not corrected
 * here: the figures above come from JPEG frames decoded to grey, while the device measures the
 * camera's own YUV luma plane, and raising the floor on that approximation risks starving a
 * session of its eight censuses, which is worse than passing a blurry frame. It wants one reading
 * from a real phone, and there is a spawned task for it.
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
 * This was 0.2, read off the curve in `server/eval/score_grocer_occlusion.py`: on 1,442 crops of
 * real store shelves, items at or above 0.2 are named correctly 60.6% of the time against 68.1%
 * for the rest, and the gap narrows to three points by 0.3. On that corpus 0.2 is the better
 * value and 0.3 gives some signal away.
 *
 * That corpus photographs shelves facing forward, and the product photographs a trolley from
 * above. `isInFront` decides an item occludes another when its box ends lower in the frame, which
 * is a real depth cue facing a shelf and a much weaker one looking down into a basket, where
 * lower means further along the basket and most items lie in a single layer. Measured on the real
 * trolley, 0.2 fires on ordinary crowding:
 *
 *     really covered   0.2786  0.3720  0.9056   Muenster under an egg carton, salmon under the
 *                                                shopper's tote, a jar behind the apples
 *     not covered      0.2110  0.2646  0.2669  0.2720
 *
 * The four false ones are items lying beside their neighbours, and one is the shopper's tote
 * drawn as covered by the salmon lying underneath it, where the test is exactly backwards. The
 * video says the same thing independently: across 137 regions of the loaded trolley the hidden
 * fractions cluster between 0.08 and 0.24, which is the crowding band, with a separate tail above
 * 0.27, and 0.2 flags 26.3% of all regions against 10.9% at 0.3.
 *
 * Those two groups do not overlap, but the gap between them is 0.0066 wide, which is noise on
 * seven points rather than a separation. The value is not taken from that gap.
 *
 * It is taken from the video, where the same geometry is sampled 137 times: the hidden fractions
 * run 0.08 to 0.24 in a dense band, which is ordinary crowding, then jump to 0.27. 0.27 sits in
 * that break. At 0.2 the video flags 26.3% of all regions as covered, which no loaded trolley
 * justifies; at 0.27, 13.9%.
 *
 * On the stills 0.27 removes three of the four false flags and keeps all three real occlusions.
 * The one it keeps wrongly is the shopper's woven tote, at 0.2720, drawn as covered because the
 * salmon lies lower in the frame while the tote lies on top of it. That one is a non-product and
 * `isProduct` removes it for a different and better reason.
 *
 * This is a regression on the shelf corpus by that corpus's own measure, where the accuracy gap
 * between flagged and unflagged items is 7.5 points at 0.2 and about 3 by 0.3. It is taken
 * because the trolley is the use case CLAUDE.md names and the shelf corpus is a substitute for
 * it. Six countable trolley photographs is not many; more would settle it properly.
 *
 * Four other measures were tried and none separates the two cases at all. Mask against mask is
 * 0.00 everywhere, because a mask only labels what can be seen and never the hidden part of an
 * occluded item. Silhouette fill of the box runs 0.44 to 0.58 for real against 0.47 to 0.73 for
 * false. A neighbour's mask inside the subject's box runs 0.09 to 0.17 against 0.07 to 0.20.
 * Requiring the occluder to contain the subject's centre clears all four false flags and two of
 * the three real ones. Box overlap is the best of the five; only its threshold was wrong.
 *
 * The guard matters more than the threshold. Before enclosing boxes were excluded this flagged
 * 11.9% of crops at a 10.5 point deficit; now it flags 6.5% at 7.5. Fewer, and more of them
 * real: one whole-cart proposal used to mark every item in the cart as covered.
 *
 * This is per item. `OCCLUSION_THRESHOLD` below is a separate, scene-level verdict about
 * whether the whole cart needs walking around, and the two answer different questions.
 */
export const COVERED_FRACTION = 0.27;

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
