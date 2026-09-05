import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { PHOTO_REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS, requestTimeoutMs } from '../config';

/**
 * `requestTimeoutMs` reads an environment override, and until this file existed nothing checked
 * what it would accept.
 *
 * The override is a development affordance: the local stand-in vision model answers one region at
 * a time and needs minutes where the shipped model needs seconds, so `.env` on the development
 * machine carries 900000. Nothing stopped that reaching a Release build except a comment in
 * `.env` asking the reader not to ship it, and `.env` is consumed at build time by whoever runs
 * the build.
 *
 * Shipping it fails in the worst available direction. A hung request would hold the scan for
 * fifteen minutes rather than failing at twenty seconds, `censusFailures` would never rise, and
 * the "scanning isn't working" notice keys off that count, so it could not appear either. The
 * shopper would watch a live camera quietly adding nothing, with no error and no explanation.
 */

const KEY = 'EXPO_PUBLIC_KART_REQUEST_TIMEOUT_MS';

declare const global: { __DEV__: boolean };

describe('requestTimeoutMs', () => {
  const originalEnv = process.env[KEY];
  const originalDev = global.__DEV__;

  beforeEach(() => {
    delete process.env[KEY];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[KEY];
    else process.env[KEY] = originalEnv;
    global.__DEV__ = originalDev;
  });

  it('is the product default when nothing is set', () => {
    global.__DEV__ = false;
    expect(requestTimeoutMs()).toBe(REQUEST_TIMEOUT_MS);
  });

  it('honours the override in a development build', () => {
    // The affordance has to keep working, or a local run against the slow stand-in model cannot
    // finish and the harness stops being able to exercise the real client at all.
    global.__DEV__ = true;
    process.env[KEY] = '900000';
    expect(requestTimeoutMs()).toBe(900_000);
  });

  it('ignores the override in a release build', () => {
    // The regression this exists for. A build carrying `.env`'s development value would hang a
    // scan for fifteen minutes and never show the unavailable notice.
    global.__DEV__ = false;
    process.env[KEY] = '900000';
    expect(requestTimeoutMs()).toBe(REQUEST_TIMEOUT_MS);
  });

  it('falls back to the default for values that are not a positive number', () => {
    // A malformed .env line should not disable the timeout. Zero and negatives are the dangerous
    // ones: passed to setTimeout they fire immediately, aborting every request before it starts.
    global.__DEV__ = true;
    for (const bad of ['', '   ', 'soon', '0', '-1', 'NaN']) {
      process.env[KEY] = bad;
      expect(requestTimeoutMs()).toBe(REQUEST_TIMEOUT_MS);
    }
  });
});

describe('PHOTO_REQUEST_TIMEOUT_MS', () => {
  it('outlasts the service budget, so the server answers before the phone gives up', () => {
    // server/src/http.ts races recognition against 25 seconds and returns a clean error when
    // it loses. A phone budget below that abandons a call the server is still paying for and
    // reports "timeout" where the server was about to say what happened.
    expect(PHOTO_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(25_000);
    expect(PHOTO_REQUEST_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS);
  });
});
