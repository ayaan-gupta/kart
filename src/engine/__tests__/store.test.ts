import AsyncStorage from '@react-native-async-storage/async-storage';

describe('useScanline persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.resetModules();
  });

  it('keeps a finished haul after a simulated app restart', async () => {
    const { useScanline } = require('../store');
    useScanline.getState().startScan();
    useScanline.getState().addDetection('0417', 0.61);
    const haulId = useScanline.getState().finishHaul();
    expect(haulId).not.toBeNull();

    await useScanline.persist.rehydrate();
    const countBeforeRestart = useScanline.getState().hauls.length;

    // Simulate an app restart: fresh module registry, same underlying AsyncStorage.
    jest.resetModules();
    const restarted = require('../store').useScanline;
    await restarted.persist.rehydrate();

    expect(restarted.getState().hauls.length).toBe(countBeforeRestart);
    expect(restarted.getState().hauls.find((h: { id: string }) => h.id === haulId)).toBeDefined();
  });

  it('seeds demo hauls only on a genuinely empty store', async () => {
    const { useScanline } = require('../store');
    await useScanline.persist.rehydrate();
    expect(useScanline.getState().hauls.length).toBeGreaterThan(0);
  });
});
