import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * `scripts/setup.sh` decided whether to install dependencies by whether the directory existed:
 * `[ ! -d node_modules ]`, `[ ! -d server/node_modules ]`, `[ ! -d ios/Pods ]`. Right on a fresh
 * clone and wrong on every Mac that had built once: after a pull that added `expo-image-picker`
 * to package.json (2026-09-02), the app's node_modules had no such package, the Release bundle
 * could not resolve the import, and the build failed on a machine where the same script had
 * succeeded a week before. The pods have the same shape of fault, because Expo links native
 * modules from node_modules at `pod install` time, so a new native dependency needs a new pod
 * install even when ios/Pods is present.
 *
 * These test the two decisions in isolation, on directories built to order, with mtimes set by
 * hand so the cases are exact rather than timing dependent.
 */

const LIB = path.resolve(__dirname, '..', 'lib', 'deps.sh');

function decide(fn: string, arg: string): boolean {
  const r = spawnSync('bash', ['-c', '. "$0" && ' + fn + ' "$1"', LIB, arg], { encoding: 'utf8' });
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(`${fn} exited ${r.status}: ${r.stderr}`);
  }
  return r.status === 0;
}

let root = '';
const at = (seconds: number) => new Date(Date.now() - 1000 * 1000 + seconds * 1000);

function write(rel: string, seconds: number, body = 'x\n') {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  fs.utimesSync(file, at(seconds), at(seconds));
}

beforeAll(() => {
  expect(fs.existsSync(LIB)).toBe(true);
});

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kart-deps-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('needs_npm_install', () => {
  test('when node_modules is missing', () => {
    write('package.json', 0);
    write('package-lock.json', 0);
    expect(decide('needs_npm_install', root)).toBe(true);
  });

  test('when node_modules exists but npm never finished writing it', () => {
    write('package.json', 0);
    write('package-lock.json', 0);
    fs.mkdirSync(path.join(root, 'node_modules'));
    expect(decide('needs_npm_install', root)).toBe(true);
  });

  test('when the lockfile changed after the last install, which is what a pull does', () => {
    write('package.json', 0);
    write('node_modules/.package-lock.json', 10);
    write('package-lock.json', 20);
    expect(decide('needs_npm_install', root)).toBe(true);
  });

  test('when package.json changed after the last install', () => {
    write('package-lock.json', 0);
    write('node_modules/.package-lock.json', 10);
    write('package.json', 20);
    expect(decide('needs_npm_install', root)).toBe(true);
  });

  test('not when the install is newer than both manifests', () => {
    write('package.json', 0);
    write('package-lock.json', 10);
    write('node_modules/.package-lock.json', 20);
    expect(decide('needs_npm_install', root)).toBe(false);
  });
});

describe('needs_pod_install', () => {
  function installed(seconds: number, lock = 'PODS:\n  - A (1.0)\n') {
    write('ios/Podfile', 0);
    write('ios/Podfile.lock', seconds, lock);
    write('ios/Pods/Manifest.lock', seconds, lock);
    write('node_modules/.package-lock.json', 0);
  }

  test('when ios/Pods is missing', () => {
    write('ios/Podfile', 0);
    write('ios/Podfile.lock', 0);
    expect(decide('needs_pod_install', root)).toBe(true);
  });

  test('when the pulled Podfile.lock no longer matches what is installed', () => {
    installed(10);
    write('ios/Podfile.lock', 20, 'PODS:\n  - A (1.0)\n  - B (2.0)\n');
    expect(decide('needs_pod_install', root)).toBe(true);
  });

  test('when node_modules changed after the pods were installed, since Expo links pods from it', () => {
    installed(10);
    write('node_modules/.package-lock.json', 20);
    expect(decide('needs_pod_install', root)).toBe(true);
  });

  test('when the Podfile itself changed after the pods were installed', () => {
    installed(10);
    write('ios/Podfile', 20);
    expect(decide('needs_pod_install', root)).toBe(true);
  });

  test('not when the installed manifest matches the lockfile and nothing is newer', () => {
    installed(10);
    expect(decide('needs_pod_install', root)).toBe(false);
  });
});
