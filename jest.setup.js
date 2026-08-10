// Require the mock once, outside Jest's module cache, so its in-memory
// storage survives `jest.resetModules()` calls in tests that simulate an
// app restart. If the factory below re-required the mock lazily instead,
// resetModules() would hand back a brand-new (empty) mock each time.
const mockAsyncStorage = require('@react-native-async-storage/async-storage/jest/async-storage-mock');
jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
