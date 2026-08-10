import { RECOGNITION_TRACK, SCAN_VIDEO, TRACK_HINT } from './recognitionTrack';
import { useScanline } from './store';

/**
 * Replays the real recognition track in sync with the scan video. The clip
 * loops, but the scan timeline keeps counting across loops, so detections
 * keep landing on the second pass. Each item lands once per session, the way
 * a real scanner would not re-add things it already counted.
 */

let fired = new Set<number>();
let hintShown = false;
let hintTimer: ReturnType<typeof setTimeout> | null = null;
let lastTime = 0;
let loops = 0;

export function startScanEngine() {
  stopScanEngine();
  fired = new Set();
  hintShown = false;
  lastTime = 0;
  loops = 0;
  useScanline.getState().startScan();
}

export function onVideoTime(currentTime: number) {
  const store = useScanline.getState();
  if (store.scan.status !== 'scanning') return;

  // A jump backwards is the loop wrapping, not a seek.
  if (currentTime < lastTime - 0.5) loops += 1;
  lastTime = currentTime;
  const elapsed = loops * SCAN_VIDEO.durationSec + currentTime;

  for (let i = 0; i < RECOGNITION_TRACK.length; i++) {
    const entry = RECOGNITION_TRACK[i];
    if (!fired.has(i) && elapsed >= entry.atSec) {
      fired.add(i);
      store.addDetection(entry.skuCode, entry.confidence);
      if (hintShown && entry.skuCode === TRACK_HINT.clearOnSku) {
        if (hintTimer) clearTimeout(hintTimer);
        hintTimer = null;
        store.setHint(null);
      }
    }
  }

  if (!hintShown && elapsed >= TRACK_HINT.atSec) {
    hintShown = true;
    store.setHint(TRACK_HINT.text);
    hintTimer = setTimeout(() => useScanline.getState().setHint(null), 7000);
  }
}

export function stopScanEngine() {
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = null;
}
