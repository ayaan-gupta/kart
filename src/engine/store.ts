import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CATALOG } from './catalog';
import type { BagLine } from './liveVision/fusion';
import { deleteHaulThumbnails } from './thumbnails';
import type { Haul, HaulItem, ScanSession } from './types';

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}_${++idCounter}_${Date.now().toString(36)}`;

const DAY = 24 * 60 * 60 * 1000;

export function haulCount(items: HaulItem[]): number {
  return items.reduce((sum, it) => sum + it.qty, 0);
}

/**
 * Brings persisted hauls forward to the identity shape.
 *
 * Hauls saved before open vocabulary hold `{ skuCode, qty }`. The demo catalog is still in the
 * repo, so their names are recoverable and no user data is thrown away. Rows whose SKU is gone
 * are dropped rather than shown as a blank line.
 */
export function migrateHaulItems(raw: unknown): HaulItem[] {
  if (!Array.isArray(raw)) return [];
  const out: HaulItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const qty = typeof row.qty === 'number' ? row.qty : 0;
    if (qty <= 0) continue;

    if (typeof row.key === 'string' && typeof row.name === 'string') {
      out.push({
        key: row.key,
        name: row.name,
        brand: typeof row.brand === 'string' ? row.brand : null,
        size: typeof row.size === 'string' ? row.size : null,
        // Only when the row says so: a haul saved before the flag existed keeps its shape.
        ...(row.unsure === true ? { unsure: true } : {}),
        category: typeof row.category === 'string' ? row.category : 'Grocery',
        qty,
        thumbnailUri: typeof row.thumbnailUri === 'string' ? row.thumbnailUri : null,
      });
      continue;
    }

    if (typeof row.skuCode === 'string') {
      const sku = CATALOG.find((s) => s.code === row.skuCode);
      if (!sku) continue;
      out.push({
        key: `::${sku.name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()}`,
        name: sku.name,
        brand: null,
        size: null,
        category: sku.category,
        qty,
        thumbnailUri: null,
      });
    }
  }
  return out;
}

function seedHauls(): Haul[] {
  const now = Date.now();
  const make = (name: string, daysAgo: number, codes: [string, number][]): Haul => ({
    id: nextId('haul'),
    name,
    endedAt: now - daysAgo * DAY,
    items: migrateHaulItems(codes.map(([skuCode, qty]) => ({ skuCode, qty }))),
  });
  return [
    make('Sunday restock', 1, [
      ['0411', 2], ['1121', 1], ['1122', 1], ['2231', 1], ['0414', 1],
      ['4455', 1], ['5564', 1], ['0413', 1], ['1124', 1], ['6672', 1],
    ]),
    make('Weeknight dinners', 3, [
      ['3341', 2], ['4451', 1], ['4452', 1], ['0415', 2], ['0416', 1], ['2234', 1], ['1125', 1],
    ]),
    make('Snack run', 6, [
      ['5561', 1], ['5562', 2], ['5563', 1], ['5564', 1], ['5566', 1],
    ]),
    make('Monthly stock-up', 9, [
      ['6671', 1], ['6673', 1], ['6674', 1], ['4453', 1], ['4454', 1], ['4456', 1],
      ['4457', 4], ['4458', 2], ['1126', 2], ['3342', 2], ['7782', 1], ['1123', 1],
    ]),
    make('Taco night', 13, [
      ['3342', 1], ['2234', 2], ['1125', 1], ['0415', 3], ['0416', 1], ['0413', 2], ['5561', 1],
    ]),
    make('Breakfast reset', 19, [
      ['1122', 2], ['3344', 1], ['2232', 1], ['5566', 1], ['1124', 1], ['0417', 1], ['5565', 1],
    ]),
  ];
}

interface ScanlineState {
  hauls: Haul[];
  scan: ScanSession;
  /** True once the persist middleware has finished reading AsyncStorage (or failed and fell
   * back to seed data). False for the brief window right after app launch where `hauls` is
   * still the synchronous seeded demo data, before any real persisted carts have loaded. */
  hasHydrated: boolean;

  startScan(): void;
  /**
   * Replaces the live bag. Called on every fusion update.
   *
   * Wholesale replacement rather than appending is the point: quantity comes from the
   * counting rule, which can revise a number downward when the in-view clamp fires. An
   * append-only log cannot express "there are fewer of these than I thought".
   */
  setBag(lines: BagLine[], thumbnails: Record<string, string>): void;
  setHint(hint: string | null): void;
  discardScan(): void;
  /** Ends the session and saves it as a haul. Returns the new haul id, or null when the bag is empty. */
  finishHaul(): string | null;
  /** Removes a haul and reclaims the thumbnail files it owned. */
  deleteHaul(id: string): Promise<void>;
  setHasHydrated(value: boolean): void;
}

/** Every thumbnail file a bag line owns: its own key first, then any key folded into it. */
function ownedThumbnails(
  line: { key: string; mergedKeys?: string[] },
  thumbnails: Record<string, string>,
): string[] {
  const keys = [line.key, ...(line.mergedKeys ?? [])];
  const seen = new Set<string>();
  const uris: string[] = [];
  for (const key of keys) {
    const uri = thumbnails[key];
    if (uri && !seen.has(uri)) { seen.add(uri); uris.push(uri); }
  }
  return uris;
}

const idleScan: ScanSession = { status: 'idle', startedAt: null, items: [], hint: null };

function haulName(date: Date): string {
  const h = date.getHours();
  const daypart = h < 11 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
  return `${daypart} cart`;
}

export const useScanline = create<ScanlineState>()(
  persist(
    (set, get) => ({
      hauls: seedHauls(),
      scan: idleScan,
      hasHydrated: false,

      startScan() {
        set(() => ({
          scan: { status: 'scanning', startedAt: Date.now(), items: [], hint: null },
        }));
      },

      setBag(lines, thumbnails) {
        set((s) => {
          if (s.scan.status !== 'scanning') return s;
          const items: HaulItem[] = lines.map((line) => ({
            key: line.key,
            name: line.name,
            brand: line.brand,
            size: line.size,
            category: line.category,
            qty: line.qty,
            unsure: line.unsure ?? false,
            // `line.key` first, then any key folded into this line: the picture is stored under
            // the resolved key of whichever track earned it, which may be the one the fold dropped.
            //
            // Every key this line owns can have a file, because the fold merges two lines that
            // turned out to be one product and a thumbnail is saved under whichever key earned it.
            // One is shown; the rest are carried so `deleteHaul` can reclaim them rather than
            // leaving them on disk forever.
            thumbnailUri: ownedThumbnails(line, thumbnails)[0] ?? null,
            extraThumbnailUris: ownedThumbnails(line, thumbnails).slice(1),
          }));
          return { scan: { ...s.scan, items } };
        });
      },

      setHint(hint) {
        set((s) => (s.scan.status === 'scanning' ? { scan: { ...s.scan, hint } } : s));
      },

      discardScan() {
        set(() => ({ scan: idleScan }));
      },

      finishHaul() {
        const s = get();
        const items = s.scan.items;
        if (items.length === 0) {
          set(() => ({ scan: idleScan }));
          return null;
        }
        const haul: Haul = {
          id: nextId('haul'),
          name: haulName(new Date()),
          endedAt: Date.now(),
          items,
        };
        set((st) => ({ hauls: [haul, ...st.hauls], scan: idleScan }));
        return haul.id;
      },

      async deleteHaul(id) {
        const haul = get().hauls.find((h) => h.id === id);
        set((s) => ({ hauls: s.hauls.filter((h) => h.id !== id) }));
        if (haul) {
          await deleteHaulThumbnails(haul.items.flatMap(
            (it) => [it.thumbnailUri, ...(it.extraThumbnailUris ?? [])]));
        }
      },

      setHasHydrated(value) {
        set(() => ({ hasHydrated: value }));
      },
    }),
    {
      name: 'kart-hauls',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      // Hauls saved under version 1 hold `{ skuCode, qty }` items. `migrateHaulItems` brings
      // them forward to the identity shape using the still-present demo catalog; a haul left
      // with no items after migration (every SKU it held has since vanished from the catalog)
      // is dropped rather than kept as an empty shell.
      migrate: (persisted) => {
        const state = persisted as { hauls?: unknown[] } | undefined;
        if (!state?.hauls) return { hauls: [] };
        const hauls: Haul[] = state.hauls
          .map((h) => {
            const haul = h as { id: string; name: string; endedAt: number; items?: unknown };
            return { ...haul, items: migrateHaulItems(haul.items) };
          })
          .filter((h) => h.items.length > 0);
        return { hauls };
      },
      // Only hauls persist. Scan sessions are always transient, in-progress
      // work should not survive a restart, and re-seeding it is meaningless.
      partialize: (state) => ({ hauls: state.hauls }),
      onRehydrateStorage: () => (state) => {
        // Runs whether rehydration found stored data or not (and even after a storage read
        // failure, per zustand's persist middleware falling back to initial state). This is
        // the one signal that the async AsyncStorage read has settled, so hauls now reflects
        // reality instead of the synchronous seed data.
        state?.setHasHydrated(true);
      },
    },
  ),
);

export { CATALOG };
