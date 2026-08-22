export interface Sku {
  id: string;
  code: string;
  name: string;
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
  /**
   * Other thumbnail files this item owns, so deleting the haul reclaims all of them.
   *
   * `bagLines` folds two lines that turn out to be one product, and a thumbnail is saved under the
   * resolved key of whichever track earned it, so both folded keys can have a file. Only one URI
   * can be shown, and without this the other would sit on disk forever after the haul is deleted.
   *
   * Optional, so hauls saved before this existed load unchanged and need no migration bump.
   */
  extraThumbnailUris?: string[];
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
