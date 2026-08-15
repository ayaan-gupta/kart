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
