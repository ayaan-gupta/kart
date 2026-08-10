/** Normalized to the camera frame, origin top-left, values 0-1. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MatchResult {
  skuCode: string | null;
  /** 0-1. How confident this match is, combining the model's label confidence and, for
   * ambiguous labels, how well the OCR text matched the winning candidate's name. */
  matchConfidence: number;
}
