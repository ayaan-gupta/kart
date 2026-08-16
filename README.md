<p align="center">
  <img src="assets/images/kart-logo.svg" width="72" alt="Kart logo" />
</p>

<h1 align="center">Kart</h1>
<p align="center">Scan your groceries as you shop, live, with your camera.</p>

<p align="center">
  <img alt="Platform" src="https://img.shields.io/badge/platform-iOS-black">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue">
</p>

Point your phone's camera over your cart and Kart tracks what's in it in real time, and
scans any barcode that comes into view. Each item gets outlined the moment the camera finds it,
tints green once it's confidently counted, and drops into your bag with a photo cropped from
your own camera frame. Finish the cart and it joins your trip history, persisted across launches.

## How it works

Detection and tracking run on-device, live, through a native Swift frame processor. Naming and
counting go through Kart's own recognition service:

1. **Detect**: `VNGenerateForegroundInstanceMaskRequest` finds each distinct item's mask in
   every throttled camera frame.
2. **Track**: a JS-side tracker with Kalman prediction follows each mask across frames through a
   tentative → confirmed → lost state machine, so two of the same product each keep their own
   identity as the camera moves.
3. **Scan barcodes**: `VNDetectBarcodesRequest` runs on the same frame. A decoded UPC is looked
   up against Open Food Facts and, once resolved, is treated as ground truth for that item; see
   the ODbL attribution shown wherever that data appears.
4. **Recognize**: a sharp, still frame is sent to Kart's own recognition service (`server/`),
   which asks a vision model to name and count what it sees and folds the result back onto the
   tracked items. An item the model is unsure about gets a second, closer look: a tight crop of
   just that item, sent for identification on its own.

`docs/counting-rule.md` describes how a running count survives the camera panning away and back
without double-counting or losing an item the model temporarily loses sight of.

No Anthropic or Claude model is used anywhere in this pipeline. The recognition service's API
key lives only in its own server environment and never reaches the app or a client-visible log.

## Features

- Live camera recognition with real-time item outlines and confidence states
- Barcode scanning for an instant, ground-truth identification when a UPC is visible
- A photo of each scanned item, cropped from your own camera, not a stock photo
- Cart history that persists across app restarts
- Native iOS 26 Liquid Glass chrome

## Tech stack

- **Expo (React Native)** + Expo Router, TypeScript
- **react-native-vision-camera** for the camera pipeline and frame processors
- **Apple Vision** (Swift) for on-device instance segmentation and barcode detection
- A small server (`server/`, deployed on Vercel) proxying frames to OpenAI's vision models for
  naming and counting, and to Open Food Facts for barcode lookups
- **Zustand** with AsyncStorage for state and persistence
- **Reanimated** for the interface

## Getting started

```bash
npm install
npx expo run:ios
```

Requires a custom dev build, not Expo Go, and a physical iOS device. The Simulator has no
camera, so live recognition can only be verified on real hardware; everything else runs fine in
the Simulator. Best on iOS 26, where the floating chrome uses genuine Liquid Glass.

## Project structure

```
src/
  app/                 Screens: home, hauls, scan, cart detail
  components/          BagTray, ItemHighlights, HaulCard, GlassSurface, ...
  design/              Design tokens and type scale
  engine/              Catalog, store (carts + scan session, persisted)
  engine/liveVision/   The live recognition pipeline: tracker, fusion/counting rule,
                       barcode lookup, keyframe pacing, coverage hints
ios/Kart/              Native Swift Vision frame processor
server/                Kart's own recognition service (census + identify), deployed on Vercel
```

## License

MIT. See [LICENSE](LICENSE).
