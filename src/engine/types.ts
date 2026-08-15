export interface Sku {
  id: string;
  code: string;
  name: string;
  price: number;
  emoji: string;
  category: string;
}

export interface HaulItem {
  /** Stable product key. See `productKey` in liveVision/fusion.ts. */
  key: string;
  name: string;
  brand: string | null;
  size: string | null;
  category: string;
  qty: number;
  /** Local file URI of a photo of this item, cut from the user's own camera frame. */
  thumbnailUri: string | null;
}

export interface Haul {
  id: string;
  name: string;
  endedAt: number;
  items: HaulItem[];
}

export type ScanStatus = 'idle' | 'scanning';

export interface ScanSession {
  status: ScanStatus;
  startedAt: number | null;
  /** The live bag, replaced wholesale on every fusion update rather than appended to. */
  items: HaulItem[];
  hint: string | null;
}
