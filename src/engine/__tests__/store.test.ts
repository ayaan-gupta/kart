import AsyncStorage from '@react-native-async-storage/async-storage';
import { migrateHaulItems } from '../store';

describe('useScanline persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.resetModules();
  });

  it('keeps a finished haul after a simulated app restart', async () => {
    const { useScanline } = require('../store');
    useScanline.getState().startScan();
    useScanline.getState().setBag(
      [{ key: '::grapes', name: 'Seedless red grapes', brand: null, size: null, category: 'Produce', qty: 1 }],
      {},
    );
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

describe('migrateHaulItems', () => {
  it('converts a legacy SKU haul to the identity shape', () => {
    // Hauls saved before this change persist as { skuCode, qty }. The demo catalog is still in
    // the repo, so the name is recoverable and nothing is lost.
    const migrated = migrateHaulItems([{ skuCode: '0411', qty: 2 }]);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].name).toBe('Bananas');
    expect(migrated[0].qty).toBe(2);
    expect(migrated[0].thumbnailUri).toBeNull();
  });

  it('drops a legacy row whose SKU is no longer in the catalog', () => {
    expect(migrateHaulItems([{ skuCode: 'gone', qty: 1 }])).toEqual([]);
  });

  it('passes through rows that are already in the new shape', () => {
    const row = { key: '::bananas', name: 'Bananas', brand: null, size: null, category: 'Produce', qty: 1, thumbnailUri: null };
    expect(migrateHaulItems([row])).toEqual([row]);
  });

  it('survives a persisted value that is not an array', () => {
    expect(migrateHaulItems(null)).toEqual([]);
    expect(migrateHaulItems({ nope: true })).toEqual([]);
  });

  it('drops a row with a non-positive quantity', () => {
    expect(migrateHaulItems([{ skuCode: '0411', qty: 0 }])).toEqual([]);
  });
});

describe('deleteHaul thumbnail ownership', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.resetModules();
  });

  it("does not break a newer haul's picture when an older haul for the same product is deleted", async () => {
    const { useScanline } = require('../store');
    const { saveThumbnail } = require('../thumbnails');
    const { File } = require('expo-file-system');

    const line = {
      key: '::bananas',
      name: 'Bananas',
      brand: null,
      size: null,
      category: 'Produce',
      qty: 1,
    };

    // Haul A: bananas, bought first, with its own saved thumbnail.
    useScanline.getState().startScan();
    const uriA: string | null = await saveThumbnail(line.key, 'AAAA');
    useScanline.getState().setBag([line], { [line.key]: uriA as string });
    const haulIdA = useScanline.getState().finishHaul();

    // Haul B: bananas again, on a later trip, with a second, distinct saved thumbnail. Before
    // the fix this would have reused haul A's file for the same product key.
    useScanline.getState().startScan();
    const uriB: string | null = await saveThumbnail(line.key, 'BBBB');
    useScanline.getState().setBag([line], { [line.key]: uriB as string });
    const haulIdB = useScanline.getState().finishHaul();

    expect(uriA).not.toBeNull();
    expect(uriB).not.toBeNull();
    expect(uriA).not.toBe(uriB);

    await useScanline.getState().deleteHaul(haulIdA);

    // Haul A is gone and its own picture is reclaimed.
    expect(useScanline.getState().hauls.find((h: { id: string }) => h.id === haulIdA)).toBeUndefined();
    expect(new File(uriA as string).exists).toBe(false);

    // Haul B survives with its item still pointing at its own, still-existing file.
    const survivor = useScanline.getState().hauls.find((h: { id: string }) => h.id === haulIdB);
    expect(survivor).toBeDefined();
    expect(survivor.items[0].thumbnailUri).toBe(uriB);
    expect(new File(survivor.items[0].thumbnailUri).exists).toBe(true);
  });
});
