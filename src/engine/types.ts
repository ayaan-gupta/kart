export interface Sku {
  id: string;
  code: string;
  name: string;
  price: number;
  emoji: string;
  category: string;
}

export interface HaulItem {
  skuCode: string;
  qty: number;
}

export interface Haul {
  id: string;
  name: string;
  endedAt: number;
  items: HaulItem[];
}

export interface Detection {
  id: string;
  skuCode: string;
  detectedAt: number;
  /** the vision model's confidence for this recognition, 0..1 */
  confidence?: number;
}

export type ScanStatus = 'idle' | 'scanning';

export interface ScanSession {
  status: ScanStatus;
  startedAt: number | null;
  detections: Detection[];
  hint: string | null;
}
