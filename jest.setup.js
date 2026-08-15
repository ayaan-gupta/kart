// Require the mock once, outside Jest's module cache, so its in-memory
// storage survives `jest.resetModules()` calls in tests that simulate an
// app restart. If the factory below re-required the mock lazily instead,
// resetModules() would hand back a brand-new (empty) mock each time.
const mockAsyncStorage = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

// react-native-vision-camera throws at import time when it cannot find its native
// `NativeModules.CameraView`, which is always the case under Jest (there is no device or
// simulator backing the test run). frameProcessor.ts imports it for `VisionCameraProxy` and the
// `Frame` type, so any test that touches that module transitively needs this stub. Only the
// surface frameProcessor.ts actually calls is provided.
//
// This file runs directly under Jest, whose `jest` global this project's eslint config does not
// declare (the identical, pre-existing error on line 6's async-storage mock above is left as-is;
// not this task's to fix).
// eslint-disable-next-line no-undef
jest.mock('react-native-vision-camera', () => ({
  VisionCameraProxy: { initFrameProcessorPlugin: () => null },
}));

// expo-image (57.0.2) reaches for the native `ExpoObserve` module at import time to wire an
// oversized-image reporting integration, and calls `observe.getIntegrations()` on whatever it
// finds. jest-expo's auto-generated mock for that module exposes `addListener`, `configure`,
// `dispatchEvents`, `removeListeners` and `setBundleDefaults`, but not `getIntegrations`, so the
// real module throws at require time under Jest even though nothing in this app touches that
// integration. This never happens on a device, where the real native module has the full API.
// `ItemThumbnail` only needs the `Image` export, so the whole package is replaced with a
// minimal stand-in built on RN's own `Image`, which accepts and ignores the extra props
// (`contentFit`, `cachePolicy`, `transition`) without complaint.
// eslint-disable-next-line no-undef
jest.mock('expo-image', () => {
  const { Image } = require('react-native');
  return { Image };
});
