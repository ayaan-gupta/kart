// src/engine/liveVision/__fixtures__/capturedFrameLabInstances.ts
//
// Real AppleInstanceMaskDetector output for assets/dev/cart-lab-sample.png, captured by running
// the exact, unmodified detector code (ios/Kart/AppleInstanceMaskDetector.swift +
// ios/Kart/MaskContour.swift) as a macOS command-line binary via
// `swiftc ... scripts/dump-detector-json/main.swift`, not fabricated and not hand-drawn.
//
// Exists because VNGenerateForegroundInstanceMaskRequest cannot run inside the iOS Simulator at
// all (Vision error code 9, "Could not create inference context" - see
// .superpowers/sdd/2026-08-14-kart-fusion-and-ui/simulator-e2e-report.md), confirmed by the
// live Frame Lab run in the Simulator throwing that exact error on every call, and by the same
// detector code succeeding outside the Simulator sandbox against this same image (`npm run
// bench:detector`). src/app/dev/frame-lab.tsx's "replay captured Vision output" mode uses this
// so the rest of the pipeline - ByteTrack, fusion, the overlay, the bag - can still be shown
// running against real detector geometry, honestly labelled as a replay, not a live Simulator run.
import type { DetectedInstance } from '../types';

export const CAPTURED_FRAME_LAB_INSTANCES: DetectedInstance[] = [
  {
    box: { x: 0.433333, y: 0.081944, w: 0.17963, h: 0.225 },
    polygon: [0.511111, 0.081944, 0.534259, 0.081944, 0.564815, 0.09375, 0.590741, 0.119444, 0.606482, 0.152778, 0.608333, 0.23125, 0.573148, 0.288194, 0.537037, 0.30625, 0.49537, 0.302083, 0.458333, 0.273611, 0.439815, 0.239583, 0.433333, 0.175694, 0.447222, 0.132639, 0.47037, 0.102083, 0.510185, 0.082639],
    score: 0.919434,
  },
  {
    box: { x: 0.080556, y: 0.136806, w: 0.282407, h: 0.185417 },
    polygon: [0.098148, 0.136806, 0.35463, 0.140278, 0.362037, 0.148611, 0.356482, 0.315278, 0.338889, 0.321528, 0.102778, 0.321528, 0.086111, 0.315278, 0.082407, 0.147222, 0.097222, 0.1375],
    score: 0.919434,
  },
  {
    box: { x: 0.683333, y: 0.136806, w: 0.234259, h: 0.15625 },
    polygon: [0.7, 0.136806, 0.911111, 0.140972, 0.916667, 0.148611, 0.911111, 0.288194, 0.903704, 0.292361, 0.692593, 0.290278, 0.683333, 0.280556, 0.683333, 0.15, 0.699074, 0.1375],
    score: 0.919434,
  },
  {
    box: { x: 0.137037, y: 0.456944, w: 0.317593, h: 0.211111 },
    polygon: [0.151852, 0.456944, 0.44537, 0.459028, 0.453704, 0.467361, 0.453704, 0.657639, 0.448148, 0.663194, 0.440741, 0.667361, 0.14537, 0.665278, 0.137037, 0.655556, 0.137037, 0.46875, 0.150926, 0.457639],
    score: 0.919434,
  },
  {
    box: { x: 0.572222, y: 0.497917, w: 0.244444, h: 0.184028 },
    polygon: [0.680556, 0.497917, 0.750926, 0.508333, 0.784259, 0.527778, 0.80463, 0.55, 0.815741, 0.602778, 0.788889, 0.648611, 0.734259, 0.677083, 0.675, 0.68125, 0.619444, 0.663194, 0.584259, 0.631944, 0.572222, 0.602083, 0.572222, 0.577083, 0.588889, 0.542361, 0.632407, 0.510417, 0.67963, 0.498611],
    score: 0.919434,
  },
];
