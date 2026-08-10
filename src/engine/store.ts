import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CATALOG, skuByCode } from './catalog';
import type { Detection, Haul, HaulItem, ScanSession } from './types';

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}_${++idCounter}_${Date.now().toString(36)}`;

const DAY = 24 * 60 * 60 * 1000;

/** Aggregate raw detections into bag lines, first-seen order. */
export function aggregate(detections: Detection[]): HaulItem[] {
  const order: string[] = [];
  const qty = new Map<string, number>();
  for (const d of detections) {
    if (!qty.has(d.skuCode)) order.push(d.skuCode);
    qty.set(d.skuCode, (qty.get(d.skuCode) ?? 0) + 1);
  }
  return order.map((skuCode) => ({ skuCode, qty: qty.get(skuCode) ?? 0 }));
}

export function haulTotal(items: HaulItem[]): number {
  return items.reduce((sum, it) => sum + (skuByCode.get(it.skuCode)?.price ?? 0) * it.qty, 0);
}

export function haulCount(items: HaulItem[]): number {
  return items.reduce((sum, it) => sum + it.qty, 0);
}

function seedHauls(): Haul[] {
  const now = Date.now();
  const make = (name: string, daysAgo: number, codes: Array<[string, number]>): Haul => ({
    id: nextId('haul'),
    name,
    endedAt: now - daysAgo * DAY,
    items: codes.map(([skuCode, qty]) => ({ skuCode, qty })),
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
  addDetection(skuCode: string, confidence?: number): void;
  setHint(hint: string | null): void;
  discardScan(): void;
  /** Ends the session and saves it as a haul. Returns the new haul id, or null when the bag is empty. */
  finishHaul(): string | null;
  setHasHydrated(value: boolean): void;
}

const idleScan: ScanSession = { status: 'idle', startedAt: null, detections: [], hint: null };

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
          scan: { status: 'scanning', startedAt: Date.now(), detections: [], hint: null },
        }));
      },

      addDetection(skuCode, confidence) {
        set((s) => {
          if (s.scan.status !== 'scanning') return s;
          const detection: Detection = {
            id: nextId('det'),
            skuCode,
            detectedAt: Date.now(),
            confidence,
          };
          return { scan: { ...s.scan, detections: [...s.scan.detections, detection] } };
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
        const items = aggregate(s.scan.detections);
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

      setHasHydrated(value) {
        set(() => ({ hasHydrated: value }));
      },
    }),
    {
      name: 'kart-hauls',
      storage: createJSONStorage(() => AsyncStorage),
      // Only hauls persist. Scan sessions are always transient, in-progress
      // work should not survive a restart, and re-seeding it is meaningless.
      partialize: (state) => ({ hauls: state.hauls }),
      onRehydrateStorage: () => (state) => {
        // Runs whether rehydration found stored data or not (and even after a storage read
        // failure, per zustand's persist middleware falling back to initial state) — this is
        // the one signal that the async AsyncStorage read has settled, so hauls now reflects
        // reality instead of the synchronous seed data.
        state?.setHasHydrated(true);
      },
    },
  ),
);

export { CATALOG };
