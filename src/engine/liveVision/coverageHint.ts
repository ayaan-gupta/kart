import type { TrackedCandidate } from './types';

export function evaluateCoverageHint(
  candidates: TrackedCandidate[],
  lastLockedAt: number | null,
  now: number,
  hintActive: boolean,
  idleMs = 4000,
): { showHint: boolean } {
  if (hintActive) return { showHint: false };

  const hasUnresolved = candidates.some((c) => c.state === 'forming' || c.state === 'tentative');
  if (!hasUnresolved) return { showHint: false };

  const since = lastLockedAt ?? 0;
  if (now - since < idleMs) return { showHint: false };

  return { showHint: true };
}
