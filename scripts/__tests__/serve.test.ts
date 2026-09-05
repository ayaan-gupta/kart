import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';

/**
 * The recognition service is the thing the phone dials, and until this script existed nothing
 * started it. `scripts/setup.sh` built and installed the app and then printed an instruction to
 * run `npm run serve` by hand, so a phone that reached the Mac found nothing on 4310 and every
 * scan came back "unavailable". On the machine that wrote this, the service was running, but
 * from a process started before the last change to `server/src/prompts.ts`, so the phone was
 * talking to code that a measurement had already replaced. Both are the same fault: nobody
 * owned the service's lifetime.
 *
 * These run the real script in a throwaway repository with a fake `npm` on PATH that stands up
 * a stub of the service, because the decisions being tested (is it running, is it ours, is it
 * stale, did it die) are made from the port and the process table, not from the service's
 * code. Every case cleans up whatever it started.
 */

const SCRIPT = path.resolve(__dirname, '..', 'serve.sh');

const OK_SERVER = `
const http = require("http");
http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, routes: ["/api/census", "/api/identify"] }));
}).listen(Number(process.env.PORT));
`;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no port'));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

function get(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

function listenerPids(port: number): number[] {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
    });
    return [...new Set(out.split('\n').filter(Boolean).map(Number))];
  } catch {
    return [];
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function makeRepo(npmBody: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kart-serve-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts', 'serve.sh'));
  fs.mkdirSync(path.join(root, 'server', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'server', 'api'), { recursive: true });
  fs.mkdirSync(path.join(root, 'server', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'server', 'src', 'prompts.ts'), 'export const rule = 0;\n');
  fs.writeFileSync(path.join(root, 'server', 'api', 'census.ts'), 'export default 1;\n');
  fs.writeFileSync(path.join(root, 'server', 'scripts', 'serve.ts'), '// stub\n');
  fs.writeFileSync(path.join(root, 'server', 'package.json'), '{"name":"stub"}\n');
  fs.mkdirSync(path.join(root, 'bin'));
  fs.writeFileSync(
    path.join(root, 'bin', 'npm'),
    `#!/usr/bin/env bash\necho "$*" >> "${root}/npm-calls.log"\n${npmBody}\n`,
  );
  fs.chmodSync(path.join(root, 'bin', 'npm'), 0o755);
  return root;
}

const STARTS_OK = `exec node -e '${OK_SERVER.replace(/'/g, "'\\''")}'`;
const DIES = `echo "[serve] OPENAI_API_KEY is not set, so nothing could be recognized." >&2\nexit 1`;

function run(root: string, port: number, args: string[] = [], extraEnv: Record<string, string> = {}) {
  return spawnSync('bash', [path.join(root, 'scripts', 'serve.sh'), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
      PORT: String(port),
      ...extraEnv,
    },
  });
}

/**
 * A stand-in for /usr/libexec/ApplicationFirewall/socketfilterfw, answering the two questions
 * serve.sh asks it in the words the real tool uses on macOS 26.
 */
function fakeFirewall(root: string, mode: 'off' | 'on' | 'blockall'): string {
  const file = path.join(root, 'bin', 'socketfilterfw');
  const state = mode === 'off' ? 'Firewall is disabled. (State = 0)' : 'Firewall is enabled. (State = 1)';
  const block =
    mode === 'blockall'
      ? 'Firewall has block all state set to enabled.'
      : 'Firewall has block all state set to disabled.';
  fs.writeFileSync(
    file,
    `#!/usr/bin/env bash\ncase "$1" in\n  --getglobalstate) echo "${state}";;\n  --getblockall) echo "${block}";;\nesac\n`,
  );
  fs.chmodSync(file, 0o755);
  return file;
}

function npmCalls(root: string): number {
  const file = path.join(root, 'npm-calls.log');
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length;
}

function ageFile(file: string, secondsFromNow: number) {
  const t = new Date(Date.now() + secondsFromNow * 1000);
  fs.utimesSync(file, t, t);
}

describe('scripts/serve.sh', () => {
  let root = '';
  let port = 0;

  beforeAll(() => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
  });

  beforeEach(async () => {
    port = await freePort();
  });

  afterEach(() => {
    for (const pid of listenerPids(port)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = '';
  });

  test('starts the service when nothing is listening, and waits until it answers', async () => {
    root = makeRepo(STARTS_OK);
    const r = run(root, port);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(npmCalls(root)).toBe(1);
    expect(JSON.parse(await get(port)).ok).toBe(true);
    expect(r.stdout).toContain(String(port));
  });

  test('leaves a service alone when it is already up on current code', async () => {
    root = makeRepo(STARTS_OK);
    expect(run(root, port).status).toBe(0);
    const [before] = listenerPids(port);
    const r = run(root, port);
    expect(r.status).toBe(0);
    expect(npmCalls(root)).toBe(1);
    expect(listenerPids(port)).toEqual([before]);
    expect(r.stdout).toMatch(/already running/i);
  });

  test('restarts a service whose source changed after it started', async () => {
    root = makeRepo(STARTS_OK);
    expect(run(root, port).status).toBe(0);
    const [before] = listenerPids(port);
    ageFile(path.join(root, 'server', 'src', 'prompts.ts'), +5);
    const r = run(root, port);
    expect(r.status).toBe(0);
    expect(npmCalls(root)).toBe(2);
    const [after] = listenerPids(port);
    expect(after).not.toBe(before);
    expect(alive(before)).toBe(false);
    expect(JSON.parse(await get(port)).ok).toBe(true);
    expect(r.stdout).toMatch(/restart/i);
  });

  test('refuses to touch a port held by something that is not the service', async () => {
    root = makeRepo(STARTS_OK);
    const stranger = http.createServer((_req, res) => res.end('not kart'));
    await new Promise<void>((resolve) => stranger.listen(port, resolve));
    try {
      const r = run(root, port);
      expect(r.status).not.toBe(0);
      expect(r.stderr + r.stdout).toContain(String(port));
      expect(npmCalls(root)).toBe(0);
      expect(await get(port)).toBe('not kart');
    } finally {
      await new Promise<void>((resolve) => stranger.close(() => resolve()));
    }
  });

  test('--stop stops the one it started and leaves the port free', async () => {
    root = makeRepo(STARTS_OK);
    expect(run(root, port).status).toBe(0);
    const [pid] = listenerPids(port);
    const r = run(root, port, ['--stop']);
    expect(r.status).toBe(0);
    expect(alive(pid)).toBe(false);
    expect(listenerPids(port)).toEqual([]);
  });

  test('--status reports without starting anything', async () => {
    root = makeRepo(STARTS_OK);
    const down = run(root, port, ['--status']);
    expect(down.status).not.toBe(0);
    expect(npmCalls(root)).toBe(0);
    expect(run(root, port).status).toBe(0);
    const up = run(root, port, ['--status']);
    expect(up.status).toBe(0);
    expect(npmCalls(root)).toBe(1);
  });

  test('reports a service that died on startup, with what it said', () => {
    root = makeRepo(DIES);
    const started = Date.now();
    const r = run(root, port);
    expect(r.status).not.toBe(0);
    expect(r.stderr + r.stdout).toContain('OPENAI_API_KEY is not set');
    expect(Date.now() - started).toBeLessThan(10000);
    expect(listenerPids(port)).toEqual([]);
  });
});

/**
 * A service that is running is not the same as a service a phone can reach. On the Mac that
 * wrote this, both faults so far were on this side of the wifi; the next one will not be, and
 * the phone cannot say what it sees. So the script says what to check from the phone, and warns
 * about the one setting on the Mac that silently refuses every phone.
 */
describe('scripts/serve.sh reachability', () => {
  let root = '';
  let port = 0;

  beforeEach(async () => {
    port = await freePort();
  });

  afterEach(() => {
    for (const pid of listenerPids(port)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('says how to check from the phone, with the address it should open', () => {
    root = makeRepo(STARTS_OK);
    const r = run(root, port, [], { KART_FIREWALL_TOOL: fakeFirewall(root, 'off') });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`from the phone[^\\n]*http://[^ ]+:${port}`, 'i'));
    expect(r.stdout).toMatch(/"ok"/);
  });

  it('warns when this Mac blocks all incoming connections, which no phone gets through', () => {
    root = makeRepo(STARTS_OK);
    const r = run(root, port, [], { KART_FIREWALL_TOOL: fakeFirewall(root, 'blockall') });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/blocks all incoming/i);
    expect(r.stdout + r.stderr).toMatch(/System Settings/);
  });

  it('mentions the firewall only when it is on', () => {
    root = makeRepo(STARTS_OK);
    const off = run(root, port, [], { KART_FIREWALL_TOOL: fakeFirewall(root, 'off') });
    expect(off.stdout + off.stderr).not.toMatch(/firewall/i);
    expect(run(root, port, ['--stop']).status).toBe(0);
    const on = run(root, port, [], { KART_FIREWALL_TOOL: fakeFirewall(root, 'on') });
    expect(on.stdout + on.stderr).toMatch(/firewall is on/i);
    expect(on.stdout + on.stderr).not.toMatch(/blocks all incoming/i);
  });

  it('says nothing about a firewall tool that is not there, as on Linux', () => {
    root = makeRepo(STARTS_OK);
    const r = run(root, port, [], { KART_FIREWALL_TOOL: path.join(root, 'no-such-tool') });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/firewall/i);
  });
});
