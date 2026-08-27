/**
 * The React Native globals the app's own modules assume, defined for a Node harness.
 *
 * Must be imported before anything under `src/`. ES modules evaluate in import order, so the
 * `import './rn-globals'` line at the top of `run.ts` runs this file first.
 *
 * `__DEV__` is the only one so far, and finding out it was needed is a fair advertisement for
 * the harness. `config.ts`'s `requestTimeoutMs()` reads it to decide whether the environment's
 * timeout override is allowed, Metro injects it into every app bundle, and Node does not. The
 * reference therefore threw a `ReferenceError` from inside `requestCensus`, which
 * `RecognitionSession.onCapture` caught along with every other error, so a replay reported four
 * successful censuses, zero failures, and an empty bag. Silent, and exactly the shape of the
 * defect this harness exists to catch.
 *
 * `true`, not `false`: a replay runs against the local model, which answers one region at a time
 * and needs minutes where the shipped model needs seconds, and `requestTimeoutMs()` honours the
 * environment override only in a development build. A harness pinned to the twenty-second
 * product timeout could never finish a local census.
 */
// Assigned through an index signature rather than a `declare global` block: react-native's own
// types already declare `__DEV__`, and the server's typecheck sees both, so a second declaration
// is a redeclaration error in one project and a missing property in the other.
(globalThis as Record<string, unknown>).__DEV__ = true;

export {};
