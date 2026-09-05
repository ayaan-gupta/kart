# Running Kart on a phone

Everything measured in `server/eval/KART.md` was measured through the eval harness, which feeds
the pipeline a cached region set and calls the recognition handlers as functions. None of that
path involves a phone, a network, or a running server. This file is what the same pipeline needs
in order to run on a phone, and what was verified about each part.

The app installed from a build made today does **not** name anything, and the reason is
configuration rather than recognition. There are three gaps, and only one of them is the model.

## Where this stands on 2026-09-05

The build installed on 2026-08-27 was signed by a free Apple ID, so it stopped launching on
2026-09-03, and it predates the photograph screen in any case. Re-signing needs a Mac with
Xcode. The Mac this repository is checked out on has only the Command Line Tools (see
`scripts/setup.sh --check`), so the next install has to come from another Mac, and two things
that would have broken that install on any Mac that had built before were found and fixed on
this date: the setup skipped `npm install` and `pod install` whenever the directories existed,
so a pull that added `expo-image-picker` built against a tree without it; and nothing started
the recognition service, so the first scan came back "unavailable". Both are covered by
`scripts/__tests__/`. The recognition service on this Mac is up on the checked-out code and
answers at the name the app dials; `server/eval/pipeline/clut-photos.ts --api
http://Ayaans-MacBook-Pro.local:4310` proves that from the network side.

### The same day, after a phone report of "took a picture, nothing happened"

No output came with the report, and the app at the time could not have produced any: a failed
photograph showed "Scanning isn't working right now" and nothing else. What could be proven
from a Mac with no Xcode was proven. The shipped photograph screen, from a Release web export
(`npx expo export --platform web`) served on this Mac and driven in a browser, took the clut1
basket photograph from the library picker through the shipped `requestCensus`, the service at
the name the app dials, `applyCensus`, and `BagTray`, to "Added 4 items" in six seconds. So the
button, the client, the service and the bag all work end to end. What that leaves is the two
hops a browser cannot stand in for, the phone's camera and the phone's wifi, and the app said
nothing about either. Four changes:

1. **The screen says why.** Under the notice, one line names the failure and the address that
   was tried: "Nothing answered at http://Name.local:4310. Is ./scripts/serve.sh running on
   that Mac, and is this phone on its wifi? On iPhone, Settings > Kart > Local Network must be
   on." `src/engine/liveVision/scanFailure.ts`. Read that line before anything else.
2. **The upload is bounded.** The phone sent the whole file: 7.6MB for one basket photograph,
   measured, and the service refuses anything over 12MB decoded, which a 48MP phone produces on
   its own. The photograph is now resized on the device to a long edge of 2048 and re-encoded as
   JPEG before it is sent (`uploadImage.ts`, through `expo-image-manipulator`). The census reads
   at 1536, so nothing it uses is lost. This adds a native module, so the next build needs
   `pod install`; `scripts/setup.sh` does that when `node_modules` is newer than the Pods.
3. **A photograph waits 30 seconds**, not the live scan's 20, so the service's own 25 second
   budget answers before the phone gives up (`PHOTO_REQUEST_TIMEOUT_MS`).
4. **`scripts/serve.sh` says what to check from the phone**, prints the address to open in the
   phone's Safari, and warns when this Mac's firewall is set to block all incoming connections,
   which refuses every phone with no message anywhere.

The most likely cause of that report is the first fix of the day: on the Mac that built the
app, the setup of the time never started the service, so the phone dialed a port with nothing
on it. The line in fix 1 would have said so.

### And then the reading itself

The owner's next report was that ChatGPT reads these photographs completely and the app does
not. ChatGPT runs gpt-5.6-sol; the census ran gpt-5.6-luna, the smallest tier, chosen for cost.
Measured one tier at a time on the fifteen clut photographs (`server/eval/CLUT.md`, "The tier
is the lever"), Luna and Terra misread brands on every pass and no prompt changes that; Sol
reads them, and reads them as well with reasoning off as on, in five seconds. The photo path
now runs Sol at reasoning "none" under a short prompt of its own (`MODELS.photo` in
`server/src/openai.ts`, `PHOTO_SYSTEM_PROMPT` in `server/src/prompts.ts`); the live scan is
unchanged. A photo costs about two cents against a twentieth of one, which is the price of the
brands being right. Pull under `server/` and run `./scripts/serve.sh`; nothing on the phone
changes.

## The three gaps

| | what is missing | what the app does without it | verified |
|---|---|---|---|
| 1 | `EXPO_PUBLIC_KART_API_URL` | never names anything: every request returns `unconfigured` | yes, both ways: a build with no `.env` has no endpoint in its bundle, and a build with one has it |
| 2 | `ENUMERATOR_URL` | degraded mode: no outlines, no catalog shortlist, 72% of units | yes, the server logged `enumeration degraded: no enumerator configured` |
| 3 | OpenAI credit | nothing is recognized at all, unless the local fallback below is used | yes, `429 credit_balance_exhausted` |

Gap 1 is the one that matters most and costs nothing to close. Gap 2 is closed locally by the
host added below. Gap 3 is the user's account, and is now optional: a local vision model can
answer the census instead, worse and slower but with no account at all.

Note what still works with all three missing: the camera, the tracker, the outlines, and the
barcode fast path, which resolves against Open Food Facts directly from the phone and is the only
part of recognition that needs no server at all.

## What was verified about the build itself

A Release build for real iPhone hardware succeeds:

```bash
xcodebuild -workspace ios/Kart.xcworkspace -scheme Kart -configuration Release \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

`** BUILD SUCCEEDED **`, and the binary is `arm64`, `platform IOS`, `minos 17.0`. That is the
device slice, not the simulator's.

That build skips signing. Asking for a real signed device build says exactly what is missing:

```bash
xcodebuild -workspace ios/Kart.xcworkspace -scheme Kart -configuration Release \
  -destination 'generic/platform=iOS' -allowProvisioningUpdates build
```

```
error: No Accounts: Add a new account in Accounts settings.
error: No profiles for 'dev.ayaangupta.kart' were found.
** BUILD FAILED **
```

So the install is blocked on two specific things, not on anything about the pipeline:

1. **Xcode has no Apple ID signed in.** A development certificate for
   `ayaangupta2009@icloud.com` is already in the keychain, but Xcode itself has no account, so it
   cannot create a provisioning profile. Fix in Xcode, Settings, Accounts. This needs the account
   password, so it is yours to do and not something a tool should be handed.
2. **No device is registered.** A free Apple ID can sign for a device only after that device is
   attached once by cable, which is what registers its identifier and lets Xcode issue the
   profile. After the first cable pairing, later installs can go over wifi.

With both done, `./scripts/install-on-device.sh` does the rest in one command. It checks both
prerequisites first and names whichever is missing, because the two failures look alike from the
outside and neither error mentions the real cause.

One trap worth recording, since checking for the account is the obvious thing to get wrong: the
Xcode preference key exists even when no account is signed in, holding an empty list. On this
machine `defaults read com.apple.dt.Xcode DVTDeveloperAccountManagerAppleIDLists` succeeds and
prints `IDE.Identifiers.Prod = ( )` while a signing build still fails with "No Accounts". The
first version of that script tested for the key and reported an Apple ID that was not there. A
codesigning identity in the keychain is not a substitute either, and there is one here: the
identity signs the binary, the profile names the device, and only an account can make a profile.

A free-account build runs for seven days before it needs re-signing.

**The app is now installed on a physical phone.** `./scripts/setup.sh` signed a Release build and
`xcrun devicectl` copied it across, on 2026-08-27: `** BUILD SUCCEEDED **`, then `App installed`
with `bundleID: dev.kart.9h4c3nf3sz`. Xcode issued a fresh provisioning profile for that
identifier on its own through `-allowProvisioningUpdates`, so both prerequisites above are now
met on this machine and the install path is verified rather than assumed.

What that run does **not** establish is that recognition works on the phone. It proves the build
signs, installs and launches. The camera path, meaning `AVCaptureSession` and VisionCamera's JSI
marshalling of a `Frame` into a worklet runtime, is still the one hop nothing in this repository
covers: `server/eval/replay/` replays everything either side of it on the Mac, and
`probeWorkletBoundary` covers part of the boundary itself. A scan on the phone is still the only
thing that closes it.

The identifier in that run is not the committed default, and that is the mechanism working as
intended rather than a mistake. App IDs are unique across the whole developer program, so
`scripts/setup.sh` derives one per Apple team; the team that owns `dev.ayaangupta.kart` keeps it,
because a changed identifier installs a second copy of the app beside the first rather than
replacing it.

## The development timeout cannot reach a shipped build

`.env` here carries `EXPO_PUBLIC_KART_REQUEST_TIMEOUT_MS=900000`, fifteen minutes, because the
local stand-in vision model answers one region at a time. The product default is twenty seconds.

Shipping that value would fail in the worst available direction: a hung request would hold the
scan for fifteen minutes instead of failing at twenty seconds, `censusFailures` would never rise,
and the "scanning isn't working" notice keys off that count, so it could not appear either. A
shopper would watch a live camera quietly adding nothing.

`requestTimeoutMs()` in `src/engine/liveVision/config.ts` now ignores the override entirely when
`__DEV__` is false. Verified in the built artifact rather than only in a test: the string
`900000` does not appear anywhere in a Release `main.jsbundle` for device, because Metro inlines
`__DEV__` as false and eliminates the branch.

## Running the whole pipeline from this machine

Two servers, both binding every interface so a phone on the same wifi can reach them. Neither is
a deployment: no TLS, no auth, no rate limiting. Do not run them on a network you do not trust.

### 1. The enumerator, which finds the regions

```bash
PORT=4320 server/.venv/bin/python server/enumerator/local.py
```

It loads Grounding DINO on MPS in about three seconds and prints what it is missing. `GET /`
reports the same thing, so a degraded run is visible without reading the log:

```json
{"ok": true, "device": "mps", "polygons": "bounding boxes", "catalog": false}
```

`polygons: bounding boxes` means SAM2 is not installed, so outlines are rectangles rather than
silhouettes. `server/enumerator/README.md` scores that difference: boxes alone cover 0.902 of
hand-labelled items against 0.924 refined. To get silhouettes, install SAM2 and point
`SAM_CHECKPOINT` at `sam2.1_hiera_tiny.pt`.

`catalog: false` means no SKU shortlist, so the census is asked an open-world question about each
badge instead of being offered the store's own products. Point `CATALOG_INDEX` at a built index
to change that.

**This host reproduces the measured region set.** Against the cached regions every figure in
`KART.md` was computed from: IMG_0252 10 regions against 10 cached, IMG_0254 11 against 11, and
**21 of 21 match at IoU 0.7 or better**, most between 0.98 and 1.00. It is the same detector with
the same prompts and threshold because it imports them from `regions.py` rather than restating
them.

Measured speed on an M-series Mac, which is the reason the deployment rents an A10G:

| input | forward passes | time |
|---|---|---|
| a scan keyframe | 2 | **3.9s** |
| a sharp photograph | 15 | ~20s |

The split is `PAIRED_PRODUCE_SHARPNESS` in `regions.py`: a sharp image gets the produce nouns two
to a prompt, which is fourteen passes and was measured better on photographs and worse on scans.
A scan session is capped at eight census calls, so four seconds a call is usable; twenty is not,
and photographs are the slow case rather than the live one.

### 2. The recognition service

```bash
echo 'ENUMERATOR_URL=http://127.0.0.1:4320' >> server/.env.local
./scripts/serve.sh
```

`scripts/serve.sh` is how the service is normally run, and `scripts/setup.sh` calls it, so a
phone set up by the script has something to dial without anyone typing a second command. It
starts the service detached from the terminal, leaves it alone when it is already up on the
checked-out code, and restarts it when anything under `server/` or `server/.env.local` is newer
than the running process, which is why the line above is enough to switch the enumerator on.
`--status` reports, `--stop` stops. Until it existed the install ended by printing `npm run
serve` for the reader to type, and a phone that reached the Mac found nothing on 4310.

The same thing by hand, in the foreground, with the log on the terminal:

```bash
ENUMERATOR_URL=http://127.0.0.1:4320 node --env-file=server/.env.local \
  server/node_modules/.bin/tsx server/scripts/serve.ts
```

`api/census.ts` and `api/identify.ts` are Vercel functions and nothing in the repository ever
bound a socket, which is why this exists. It prints the exact line to put in the app's `.env`:

```
[serve]   EXPO_PUBLIC_KART_API_URL=http://192.168.1.20:4310
```

`GET /` on that address from the phone's browser separates "wrong address or firewall" from
"recognition failed" before any scanning is attempted. The service also logs one line per
request with the caller's address, so a launch that reaches the laptop shows up there without
anyone reading anything off the phone.

That printed address is a DHCP lease, and it dies the moment the laptop joins a different
network or tethers to a phone. Because the value is inlined at build time, a dead address means
a full native rebuild, which is a bad trade for walking into a different room. So prefer the
laptop's Bonjour name, `scutil --get LocalHostName` plus `.local`, and list the literal
addresses under `EXPO_PUBLIC_KART_API_FALLBACKS` for networks that block mDNS. The app probes
the list once at launch, uses the first that answers, and re-probes if that one later stops
answering mid-session.

Reaching a local address at all needs `NSLocalNetworkUsageDescription` in the app's
`Info.plist`, which iOS requires before it will even ask the shopper for permission. Without
it there is no prompt and no access, and every request fails as `offline` while the camera
keeps running, which looks exactly like recognition being broken. It is set in `app.json` under
`ios.infoPlist`; if a scan names nothing on a device but works in the simulator, check that the
permission was granted in Settings before suspecting the model.

### 3. The app

Put that line in `.env` at the repository root (`.env.example` documents it), then rebuild. The
value is inlined into the JS bundle at build time, so **changing it requires a rebuild**, not a
restart.

## The app calling the server, verified

`frame-lab.tsx` has a fourth run mode, `server`, which uses the real `requestCensus` and
`requestIdentify` instead of the local fixtures the other modes use. It exists because until it
did, **nothing in the app had ever made a network call**: `devFixtures.ts` states plainly that its
stand-ins were written "because it is not deployed and there is no key", so a full bag of named
items on screen proved the pipeline and proved nothing about reaching a service.

Reach it with a Debug build (the Frame Lab native module is Debug only), from the home screen's
logo on a long press, then "Run against the recognition server".

What a run does, verified end to end on a simulator with both servers above running:

1. the endpoint is in the built JavaScript bundle, where a build without `.env` has none,
2. the app forms and confirms tracks, encodes a keyframe, and POSTs to the service,
3. the service takes the app's marks and calls the model,
4. it fails at `429 credit_balance_exhausted`,
5. and the app shows "Scanning isn't working right now, so nothing is being added to your cart."
   with the bag at zero.

Step 5 is the `unavailable` notice being driven by a real failure for the first time. Note that
the service does not enumerate on these requests: the app sends marks, and `api/census.ts` only
enumerates for a client that sends none.

**This was a simulator, not a phone.** What it establishes is that the app can reach a recognition
service. What still needs real hardware is `MIN_KEYFRAME_SHARPNESS`, the live detector, and the
scan experience.

## What this was tested with, and where it stopped

A real corpus photograph posted through the full chain reached the model and failed at
`429 credit_balance_exhausted`, with the enumerator reporting 9 regions and no degraded mode.
That is the whole path working except the account: request parsing, image decode, region
enumeration, mark composition, and the call itself.

The redaction discipline held under test. The wire response was the fixed string
`{"error":"Recognition failed"}` and the log contained no fragment of the key.

## Running with no OpenAI account at all

`server/localvlm/serve.py` answers the census contract from weights on this machine, using the
per-crop method `server/eval/pipeline/census_local.py` established. `runCensus` takes it only when
`LOCAL_CENSUS_URL` is set, and is unchanged when it is not.

```bash
PORT=4330 server/.venv/bin/python server/localvlm/serve.py
```

Then start the recognition service with all three pointed at each other, and with both timeouts
raised, because the local model answers one region at a time:

```bash
ENUMERATOR_URL=http://127.0.0.1:4320 LOCAL_CENSUS_URL=http://127.0.0.1:4330 \
  RECOGNITION_TIMEOUT_MS=900000 node --env-file=server/.env.local \
  server/node_modules/.bin/tsx server/scripts/serve.ts
```

The app needs its own budget raised too, in `.env`, because its default is 20 seconds:

```
EXPO_PUBLIC_KART_REQUEST_TIMEOUT_MS=180000
```

**Both defaults are the product values and neither should ship raised.** 25s on the server exists
because Vercel kills the function at 30s; 20s in the app exists because a shopper will not wait
longer than that.

### What it is worth

Measured on IMG_0252 through the whole stack, HTTP 200 in 113 seconds: Oreo, cauliflower, Granny
Smith apples, bread and baguette named correctly, brussels sprouts named "brocolli sprouts", two
answers plainly wrong and one duplicated. The ninety-sixth section of `KART.md` puts the same
model at 18 of 22 against the shipped 20 of 22 on the alignment metric.

It is the difference between a machine with no credit recognizing nothing and recognizing most of
a trolley. It is not the product.

`LOCAL_CONFIDENCE` in that file is 0.6, above `GREEN_CONFIDENCE`, and the reason is written there:
at 0.5 every item waited for a closer look, the closer look calls `identify`, and `identify` needs
the credit this path exists to avoid, so the bag stayed empty on every run.
