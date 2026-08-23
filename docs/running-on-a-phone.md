# Running Kart on a phone

Everything measured in `server/eval/KART.md` was measured through the eval harness, which feeds
the pipeline a cached region set and calls the recognition handlers as functions. None of that
path involves a phone, a network, or a running server. This file is what the same pipeline needs
in order to run on a phone, and what was verified about each part.

The app installed from a build made today does **not** name anything, and the reason is
configuration rather than recognition. There are three gaps, and only one of them is the model.

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

With both done, `xcodebuild ... -destination 'platform=iOS,name=<your iPhone>'` installs it, and a
free-account build runs for seven days before it needs re-signing.

**The app has never been run on a physical phone.** Everything up to signing is verified; the
install is not, and nothing in this repository can substitute for the two steps above.

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
ENUMERATOR_URL=http://127.0.0.1:4320 node --env-file=server/.env.local \
  server/node_modules/.bin/tsx server/scripts/serve.ts
```

`api/census.ts` and `api/identify.ts` are Vercel functions and nothing in the repository ever
bound a socket, which is why this exists. It prints the exact line to put in the app's `.env`:

```
[serve]   EXPO_PUBLIC_KART_API_URL=http://192.168.1.20:4310
```

`GET /` on that address from the phone's browser separates "wrong address or firewall" from
"recognition failed" before any scanning is attempted.

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
