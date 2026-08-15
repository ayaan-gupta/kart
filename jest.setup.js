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
jest.mock('react-native-vision-camera', () => ({
  VisionCameraProxy: { initFrameProcessorPlugin: () => null },
}));
