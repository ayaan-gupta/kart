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

export type CandidateState = 'forming' | 'tentative' | 'locked';

export interface TrackedCandidate {
  id: string;
  box: Box;
  skuCode: string | null;
  confidence: number;
  state: CandidateState;
  lastSeenAt: number;
  /** When the current skuCode guess first reached greenConfidence, continuously. Null if not currently above it. */
  stableSince: number | null;
}

export interface TrackerConfig {
  iouMatchThreshold: number;
  lossToleranceMs: number;
  yellowConfidence: number;
  greenConfidence: number;
  minDwellMs: number;
}

export interface MatchedRegion {
  box: Box;
  skuCode: string | null;
  confidence: number;
}

export interface TrackerEvent {
  type: 'locked';
  candidateId: string;
  skuCode: string;
  confidence: number;
}

/** One candidate label the classifier proposed for a region, most confident first. */
export interface LabelCandidate {
  label: string;
  confidence: number;
}

export interface RawRegion {
  box: Box;
  /** Candidate labels in descending confidence order. The top entry is often a generic
   * hypernym with no catalog mapping, so consumers should try each in order. */
  labels: LabelCandidate[];
  ocrText?: string;
}

export interface PipelineState {
  candidates: TrackedCandidate[];
}
