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

describe('a folded bag line owns more than one thumbnail file', () => {
  // `bagLines` folds two lines that turn out to be one product, and a thumbnail is saved under the
  // resolved key of whichever track earned it, so both folded keys can have a file. Only one can be
  // shown. Before `extraThumbnailUris` the other was never reclaimed and sat on disk forever after
  // the haul was deleted.
  const folded = {
    key: 'oreo::oreo',
    name: 'Oreo',
    brand: 'Oreo',
    size: null,
    category: 'snacks',
    qty: 1,
    mergedKeys: ['sku:kart_oreo'],
  };

  beforeEach(() => {
    jest.resetModules();
  });

  it('shows one picture and carries the rest', () => {
    const { useScanline } = require('../store');
    useScanline.getState().startScan();
    useScanline.getState().setBag([folded], {
      'oreo::oreo': 'file:///a.jpg',
      'sku:kart_oreo': 'file:///b.jpg',
    });
    const [item] = useScanline.getState().scan.items;
    expect(item.thumbnailUri).toBe('file:///a.jpg');
    expect(item.extraThumbnailUris).toEqual(['file:///b.jpg']);
  });

  it('falls back to a folded key when the surviving key has no picture', () => {
    // The case the fold created: the file is filed under the key the fold dropped.
    const { useScanline } = require('../store');
    useScanline.getState().startScan();
    useScanline.getState().setBag([folded], { 'sku:kart_oreo': 'file:///b.jpg' });
    const [item] = useScanline.getState().scan.items;
    expect(item.thumbnailUri).toBe('file:///b.jpg');
    expect(item.extraThumbnailUris).toEqual([]);
  });

  it('does not list the same file twice when both keys resolved to it', () => {
    const { useScanline } = require('../store');
    useScanline.getState().startScan();
    useScanline.getState().setBag([folded], {
      'oreo::oreo': 'file:///a.jpg',
      'sku:kart_oreo': 'file:///a.jpg',
    });
    const [item] = useScanline.getState().scan.items;
    expect(item.thumbnailUri).toBe('file:///a.jpg');
    expect(item.extraThumbnailUris).toEqual([]);
  });

  it('leaves an unfolded line with no extras', () => {
    const { useScanline } = require('../store');
    useScanline.getState().startScan();
    useScanline.getState().setBag(
      [{ key: '::bananas', name: 'Bananas', brand: null, size: null, category: 'Produce', qty: 1 }],
      { '::bananas': 'file:///c.jpg' },
    );
    const [item] = useScanline.getState().scan.items;
    expect(item.extraThumbnailUris).toEqual([]);
  });
});

describe('an unsure line stays unsure in the bag', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.resetModules();
  });

  it('setBag carries the flag onto the item, and a haul keeps it', () => {
    const { useScanline } = require('../store');
    useScanline.getState().startScan();
    useScanline.getState().setBag(
      [
        { key: '::assorted chocolates', name: 'Assorted chocolates', brand: null, size: null, category: 'other', qty: 1, unsure: true },
        { key: '::bananas', name: 'Bananas', brand: null, size: null, category: 'Produce', qty: 1, unsure: false },
      ],
      {},
    );
    const items = useScanline.getState().scan.items;
    expect(items.find((i: { name: string }) => i.name === 'Assorted chocolates')?.unsure).toBe(true);
    expect(items.find((i: { name: string }) => i.name === 'Bananas')?.unsure).toBe(false);
    const haulId = useScanline.getState().finishHaul();
    const haul = useScanline.getState().hauls.find((h: { id: string }) => h.id === haulId);
    expect(haul.items.find((i: { name: string }) => i.name === 'Assorted chocolates')?.unsure).toBe(true);
  });

  it('migrates a stored item without the flag as sure', () => {
    const items = migrateHaulItems([{ key: '::x', name: 'X', qty: 1 }]);
    expect(items[0].unsure).toBeFalsy();
  });
});
