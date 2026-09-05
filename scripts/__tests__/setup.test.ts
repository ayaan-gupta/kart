import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

/**
 * `scripts/setup.sh` is the one command a stranger runs after cloning, on a Mac this project has
 * never seen, with a phone plugged in. Its promise is that nothing else is needed: it installs
 * what is missing, asks for the one thing only the person has (the OpenAI key), works out the
 * Apple team and the Mac's address, builds, installs, and starts the service.
 *
 * These run the real script in a throwaway repository with fake Apple and Homebrew tools on
 * PATH and a throwaway HOME, because every decision it makes is made from what those tools say
 * and every side effect lands in HOME or the repository. Each fake logs its calls, so a test can
 * say not only what the script printed but what it did, and in what order.
 */

const SCRIPTS = path.resolve(__dirname, '..');

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

function listenerPids(port: number): number[] {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
    return [...new Set(out.split('\n').filter(Boolean).map(Number))];
  } catch {
    return [];
  }
}

const OK_SERVER = `
const http = require("http");
http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, routes: ["/api/census"] }));
}).listen(Number(process.env.PORT));
`;

interface Machine {
  /** What `xcode-select -p` answers. */
  xcodeSelect: 'xcode' | 'clt' | 'none';
  /** Whether an Xcode.app exists where the script looks. */
  xcodeApp: boolean;
  firstLaunchDone: boolean;
  /** Apple team identifiers with a live certificate on this Mac. */
  certTeams: string[];
  /** Teams Xcode's own preferences know about, when no certificate exists yet. */
  prefTeams: string[];
  /** Whether `node` is on PATH at all. */
  node: boolean;
  pod: boolean;
  brew: boolean;
  /** After how many `xctrace list devices` calls the phone shows up; Infinity for never. */
  phoneAfterCalls: number;
  phoneOs: string;
  sdk: string;
  /** What arrives on stdin: the key prompt reads one line. */
  stdin: string;
}

const DEFAULT: Machine = {
  xcodeSelect: 'xcode',
  xcodeApp: true,
  firstLaunchDone: true,
  certTeams: ['ABCDE12345'],
  prefTeams: [],
  node: true,
  pod: true,
  brew: true,
  phoneAfterCalls: 0,
  phoneOs: '26.0',
  sdk: '26.0',
  stdin: 'sk-test-0123456789\n',
};

class Rig {
  root: string;
  home: string;
  bin: string;
  state: string;
  brewPrefix: string;
  log: string;
  xcodeApps: string;
  port = 0;

  constructor() {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'kart-setup-'));
    this.home = path.join(this.root, 'home');
    this.bin = path.join(this.root, 'bin');
    this.state = path.join(this.root, 'state');
    this.brewPrefix = path.join(this.root, 'brew');
    this.log = path.join(this.root, 'calls.log');
    this.xcodeApps = path.join(this.root, 'Applications');
    for (const d of [this.home, this.bin, this.state, this.xcodeApps]) fs.mkdirSync(d, { recursive: true });
  }

  file(rel: string, body: string) {
    const f = path.join(this.root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }

  tool(name: string, body: string, dir = this.bin) {
    const f = path.join(dir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, `#!/bin/bash\nset -u\nLOG="$KART_TEST_LOG"; STATE="$KART_TEST_STATE"; ROOT="$KART_TEST_ROOT"\n${body}\n`);
    fs.chmodSync(f, 0o755);
  }

  calls(): string[] {
    return fs.existsSync(this.log) ? fs.readFileSync(this.log, 'utf8').split('\n').filter(Boolean) : [];
  }

  read(rel: string): string {
    const f = path.join(this.root, rel);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  }

  /** The repository a clone would have, minus everything the script is expected to create. */
  repo() {
    for (const s of ['setup.sh', 'install-on-device.sh', 'serve.sh', 'lib/deps.sh']) {
      const to = path.join(this.root, 'scripts', s);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(SCRIPTS, s), to);
    }
    this.file('package.json', '{"name":"kart","scripts":{"typecheck":"tsc"}}\n');
    this.file('package-lock.json', '{}\n');
    this.file('server/package.json', '{"name":"kart-server","scripts":{"serve":"node serve"}}\n');
    this.file('server/package-lock.json', '{}\n');
    this.file('server/src/prompts.ts', 'export const rule = 0;\n');
    this.file('server/api/census.ts', 'export default 1;\n');
    this.file('server/scripts/serve.ts', '// stub\n');
    this.file('ios/Podfile', "platform :ios, '17.0'\n");
    this.file('ios/Podfile.lock', 'PODS:\n  - ExpoModulesCore (57.0.0)\n');
    fs.mkdirSync(path.join(this.root, 'ios', 'Kart.xcworkspace'), { recursive: true });
    this.file('.env.example', 'EXPO_PUBLIC_KART_API_URL=\n');
  }

  machine(m: Machine) {
    const realNode = process.execPath;
    const realNodeDir = path.dirname(realNode);
    fs.writeFileSync(path.join(this.state, 'xcode-select-path'),
      m.xcodeSelect === 'xcode' ? '/Applications/Xcode.app/Contents/Developer' : m.xcodeSelect === 'clt' ? '/Library/Developer/CommandLineTools' : '');
    if (m.xcodeApp) fs.mkdirSync(path.join(this.xcodeApps, 'Xcode.app', 'Contents', 'Developer'), { recursive: true });
    if (m.firstLaunchDone) fs.writeFileSync(path.join(this.state, 'first-launch-done'), '');
    fs.writeFileSync(path.join(this.state, 'sdk'), m.sdk);
    fs.writeFileSync(path.join(this.state, 'phone-after-calls'), String(m.phoneAfterCalls));
    fs.writeFileSync(path.join(this.state, 'phone-os'), m.phoneOs);
    fs.writeFileSync(path.join(this.state, 'xctrace-calls'), '0');

    // One self-signed certificate per team, OU carrying the identifier, the way Apple's do.
    let pems = '';
    for (const team of m.certTeams) {
      const key = path.join(this.state, `${team}.key`);
      const crt = path.join(this.state, `${team}.pem`);
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '30',
        '-subj', `/CN=Apple Development: Test (${team})/OU=${team}/O=Test/C=US`], { stdio: 'ignore' });
      pems += fs.readFileSync(crt, 'utf8');
    }
    fs.writeFileSync(path.join(this.state, 'certs.pem'), pems);
    if (m.prefTeams.length > 0) {
      fs.writeFileSync(path.join(this.state, 'teams'),
        `{\n    "test@example.com" =     (\n${m.prefTeams.map((t) => `        {\n            teamID = ${t};\n            teamName = "Test Team";\n            teamType = Individual;\n        }`).join(',\n')}\n    );\n}\n`);
    }
    fs.writeFileSync(path.join(this.state, 'accounts'), '{\n    "IDE.Identifiers.Prod" =     (\n        "test@example.com"\n    );\n}\n');

    this.tool('sudo', 'echo "sudo $*" >> "$LOG"; exec "$@"');
    this.tool('xcode-select', `case "$1" in
  -p) p="$(cat "$STATE/xcode-select-path")"; [ -n "$p" ] || exit 2; echo "$p";;
  -s) echo "$2" > "$STATE/xcode-select-path";;
  *) exit 1;;
esac`);
    this.tool('xcodebuild', `echo "xcodebuild $*" >> "$LOG"
case "$1" in
  -version) echo "Xcode 26.3"; echo "Build version 17E200";;
  -checkFirstLaunchStatus) [ -f "$STATE/first-launch-done" ];;
  -runFirstLaunch) touch "$STATE/first-launch-done";;
  -license) exit 0;;
  *)
    case " $* " in
      *" -showBuildSettings "*)
        mkdir -p "$ROOT/build/Release-iphoneos/Kart.app"
        echo "    BUILT_PRODUCTS_DIR = $ROOT/build/Release-iphoneos"
        echo "    FULL_PRODUCT_NAME = Kart.app";;
      *" build "*) echo "** BUILD SUCCEEDED **";;
    esac;;
esac`);
    this.tool('xcrun', `echo "xcrun $*" >> "$LOG"
case "$1 $2" in
  "--sdk iphoneos") cat "$STATE/sdk";;
  "xctrace list")
    n=$(( $(cat "$STATE/xctrace-calls") + 1 )); echo "$n" > "$STATE/xctrace-calls"
    echo "== Devices =="
    echo "This Mac ($(ioreg -rd1 -c IOPlatformExpertDevice | awk -F'"' '/IOPlatformUUID/{print $4}'))"
    after="$(cat "$STATE/phone-after-calls")"
    if [ "$after" != "Infinity" ] && [ "$n" -gt "$after" ]; then echo "Test Phone ($(cat "$STATE/phone-os")) (00008120-000A1B2C3D4E5F67)"; fi
    echo "== Simulators ==";;
  "devicectl device") echo "App installed: dev.kart.test";;
esac`);
    this.tool('security', `case "$1" in
  find-certificate) cat "$STATE/certs.pem";;
  find-identity) echo "  1 valid identities found";;
  *) exit 1;;
esac`);
    this.tool('defaults', `case "$3" in
  DVTDeveloperAccountManagerAppleIDLists) cat "$STATE/accounts";;
  IDEProvisioningTeams) [ -f "$STATE/teams" ] && cat "$STATE/teams" || exit 1;;
  *) exit 1;;
esac`);
    const podBody = `echo "pod $*" >> "$LOG"
case "$1" in
  --version) echo "1.16.2";;
  install) mkdir -p Pods; cp Podfile.lock Pods/Manifest.lock;;
esac`;
    if (m.pod) this.tool('pod', podBody);
    fs.writeFileSync(path.join(this.state, 'pod.body'), podBody);
    this.tool('npm', `case " $* " in
  *" run serve "*) exec "${realNode}" -e '${OK_SERVER.replace(/'/g, "'\\''")}';;
  *" install "*)
    echo "npm $* envlocal=$([ -f "$ROOT/server/.env.local" ] && echo yes || echo no)" >> "$LOG"
    dir="."; case " $* " in *" --prefix "*) ;; esac
    mkdir -p node_modules; touch node_modules/.package-lock.json;;
  *" typecheck "*) echo "npm $*" >> "$LOG"; exit 0;;
  *) echo "npm $*" >> "$LOG";;
esac`);
    // The Homebrew installer, as `curl -fsSL <url>` would fetch it: it puts a fake brew in the
    // prefix the script was told to use. Every other curl goes to the real one, because serve.sh
    // uses curl to ask the service whether it is up.
    this.tool('curl', `case "$*" in
  *Homebrew/install*)
    echo "curl $*" >> "$LOG"
    cat <<'INSTALLER'
mkdir -p "$KART_BREW_PREFIX/bin"
cat > "$KART_BREW_PREFIX/bin/brew" <<'BREW'
#!/bin/bash
echo "brew $*" >> "$KART_TEST_LOG"
case "$1" in
  shellenv) echo "export PATH=\\"$KART_BREW_PREFIX/bin:\\$PATH\\"";;
  --prefix) echo "$KART_BREW_PREFIX";;
  install)
    case "$2" in
      node) ln -sf "$KART_TEST_NODE" "$KART_BREW_PREFIX/bin/node";;
      cocoapods) { echo '#!/bin/bash'; echo 'set -u'; echo 'LOG="$KART_TEST_LOG"; STATE="$KART_TEST_STATE"; ROOT="$KART_TEST_ROOT"'; cat "$KART_TEST_STATE/pod.body"; } > "$KART_BREW_PREFIX/bin/pod"; chmod +x "$KART_BREW_PREFIX/bin/pod";;
    esac;;
esac
BREW
chmod +x "$KART_BREW_PREFIX/bin/brew"
INSTALLER
    ;;
  *) exec /usr/bin/curl "$@";;
esac`);
    if (m.brew) {
      // A Mac that already has Homebrew: the same fake, already installed at the prefix.
      fs.mkdirSync(path.join(this.brewPrefix, 'bin'), { recursive: true });
      const brew = path.join(this.brewPrefix, 'bin', 'brew');
      fs.writeFileSync(brew, `#!/bin/bash
echo "brew $*" >> "$KART_TEST_LOG"
case "$1" in
  shellenv) echo "export PATH=\\"$KART_BREW_PREFIX/bin:\\$PATH\\"";;
  --prefix) echo "$KART_BREW_PREFIX";;
  install)
    case "$2" in
      node) ln -sf "$KART_TEST_NODE" "$KART_BREW_PREFIX/bin/node";;
      cocoapods) { echo '#!/bin/bash'; echo 'set -u'; echo 'LOG="$KART_TEST_LOG"; STATE="$KART_TEST_STATE"; ROOT="$KART_TEST_ROOT"'; cat "$KART_TEST_STATE/pod.body"; } > "$KART_BREW_PREFIX/bin/pod"; chmod +x "$KART_BREW_PREFIX/bin/pod";;
    esac;;
esac
`);
      fs.chmodSync(brew, 0o755);
    }
    // PATH: the fakes, the system, and node only when the machine has it. Homebrew's own bin is
    // deliberately absent even when brew exists, which is how a fresh terminal on a Mac with
    // Homebrew installed but not yet in the profile looks.
    const pathParts = [this.bin, ...(m.node ? [realNodeDir] : []), '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
    return { PATH: pathParts.join(':'), realNode };
  }

  async run(m: Partial<Machine> = {}, args: string[] = []) {
    const machine = { ...DEFAULT, ...m };
    this.repo();
    const { PATH, realNode } = this.machine(machine);
    this.port = await freePort();
    const r = spawnSync('bash', [path.join(this.root, 'scripts', 'setup.sh'), ...args], {
      cwd: this.root,
      encoding: 'utf8',
      input: machine.stdin,
      timeout: 120000,
      env: {
        PATH,
        HOME: this.home,
        LANG: 'en_US.UTF-8',
        PORT: String(this.port),
        KART_TEST_LOG: this.log,
        KART_TEST_STATE: this.state,
        KART_TEST_ROOT: this.root,
        KART_TEST_NODE: realNode,
        KART_BREW_PREFIX: this.brewPrefix,
        KART_XCODE_APPS: this.xcodeApps,
        KART_PHONE_WAIT_SECONDS: '6',
        KART_FIREWALL_TOOL: path.join(this.root, 'no-such-firewall'),
      },
    });
    return { ...r, out: `${r.stdout}\n${r.stderr}` };
  }

  cleanup() {
    for (const pid of listenerPids(this.port)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

describe('scripts/setup.sh on a Mac that has everything', () => {
  let rig: Rig;
  beforeEach(() => {
    rig = new Rig();
  });
  afterEach(() => rig.cleanup());

  it('goes from a clone to an installed app and a running service in one run', async () => {
    const r = await rig.run();
    expect(r.out).toMatch(/Installed\./);
    expect(r.status).toBe(0);
    const calls = rig.calls();
    expect(calls.some((c) => /^npm .*install/.test(c) && !/--prefix server/.test(c))).toBe(true);
    expect(calls.some((c) => /^pod install/.test(c))).toBe(true);
    expect(calls.some((c) => /^xcodebuild .*build$/.test(c) || /^xcodebuild .* build/.test(c))).toBe(true);
    expect(calls.some((c) => /^xcrun devicectl device install/.test(c))).toBe(true);
    expect(rig.read('.env')).toMatch(/^EXPO_PUBLIC_KART_API_URL=http:\/\/.+:4310$/m);
    expect(rig.read('.kartrc')).toContain('KART_TEAM_ID=ABCDE12345');
    expect(rig.read('.kartrc')).toContain('KART_BUNDLE_ID=dev.kart.abcde12345');
    expect(rig.read('server/.env.local')).toBe('OPENAI_API_KEY=sk-test-0123456789\n');
    expect(r.out).not.toContain('sk-test-0123456789');
  });

  it('asks for the key before the slow installs, so the person can walk away', async () => {
    await rig.run();
    const installs = rig.calls().filter((c) => /^npm .*install/.test(c));
    expect(installs.length).toBeGreaterThan(0);
    for (const call of installs) expect(call).toMatch(/envlocal=yes/);
  });

  it("tells Xcode's build phase where node is, for a Mac whose node is not on the system PATH", async () => {
    await rig.run();
    const env = rig.read('ios/.xcode.env.local');
    expect(env).toMatch(/^export NODE_BINARY="\/.*\/node"$/m);
  });

  it('--check changes nothing and installs nothing', async () => {
    const r = await rig.run({}, ['--check']);
    expect(r.status).toBe(0);
    expect(rig.calls().filter((c) => /^(npm|pod install|xcodebuild .* build|sudo|brew|curl)/.test(c))).toEqual([]);
    expect(fs.existsSync(path.join(rig.root, '.env'))).toBe(false);
    expect(fs.existsSync(path.join(rig.root, '.kartrc'))).toBe(false);
    expect(fs.existsSync(path.join(rig.root, 'server', '.env.local'))).toBe(false);
  });
});

describe('scripts/setup.sh on a Mac that is missing things', () => {
  let rig: Rig;
  beforeEach(() => {
    rig = new Rig();
  });
  afterEach(() => rig.cleanup());

  it('points the command line tools at an installed Xcode itself, instead of stopping', async () => {
    const r = await rig.run({ xcodeSelect: 'clt', xcodeApp: true });
    expect(rig.calls()).toContainEqual(expect.stringMatching(/^sudo xcode-select -s .*Xcode\.app\/Contents\/Developer$/));
    expect(r.out).toMatch(/Installed\./);
  });

  it('still stops, precisely, when Xcode is not installed at all', async () => {
    const r = await rig.run({ xcodeSelect: 'clt', xcodeApp: false });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/App Store/);
    expect(rig.calls().filter((c) => /^npm/.test(c))).toEqual([]);
  });

  it("runs Xcode's first launch and accepts the licence itself", async () => {
    const r = await rig.run({ firstLaunchDone: false });
    expect(rig.calls()).toContainEqual(expect.stringMatching(/^sudo xcodebuild -runFirstLaunch/));
    expect(rig.calls()).toContainEqual(expect.stringMatching(/^sudo xcodebuild -license accept/));
    expect(r.out).toMatch(/Installed\./);
  });

  it('installs Homebrew, Node and CocoaPods when none of them is there', async () => {
    const r = await rig.run({ node: false, pod: false, brew: false });
    const calls = rig.calls();
    expect(calls).toContainEqual(expect.stringMatching(/^curl .*Homebrew\/install/));
    expect(calls).toContainEqual(expect.stringMatching(/^brew install node/));
    expect(calls).toContainEqual(expect.stringMatching(/^brew install cocoapods/));
    // The next terminal has to find them too.
    expect(rig.read('home/.zprofile')).toMatch(/brew shellenv/);
    expect(r.out).toMatch(/Installed\./);
  });

  it('uses a Homebrew that is installed but not yet on PATH, rather than installing a second one', async () => {
    const r = await rig.run({ node: false, pod: false, brew: true });
    const calls = rig.calls();
    expect(calls.filter((c) => /Homebrew\/install/.test(c))).toEqual([]);
    expect(calls).toContainEqual(expect.stringMatching(/^brew install node/));
    expect(r.out).toMatch(/Installed\./);
  });

  it("takes the team from Xcode's own accounts when no certificate has been made yet", async () => {
    const r = await rig.run({ certTeams: [], prefTeams: ['ZYXWV98765'] });
    expect(rig.read('.kartrc')).toContain('KART_TEAM_ID=ZYXWV98765');
    expect(r.out).toMatch(/Installed\./);
  });

  it('waits for the phone to be plugged in and trusted, then carries on', async () => {
    const r = await rig.run({ phoneAfterCalls: 2 });
    expect(r.out).toMatch(/[Ww]aiting/);
    expect(r.out).toMatch(/Installed\./);
  });

  it('finishes the Mac side and says what to do when no phone ever appears', async () => {
    const r = await rig.run({ phoneAfterCalls: Infinity });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/not attached/i);
    expect(rig.read('server/.env.local')).toContain('OPENAI_API_KEY=');
    expect(rig.calls().filter((c) => /^xcodebuild .* build/.test(c))).toEqual([]);
  });

  it('stops when the phone runs an iOS newer than this Xcode can build for', async () => {
    const r = await rig.run({ phoneOs: '27.1', sdk: '26.0' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/[Uu]pdate Xcode/);
  });
});
