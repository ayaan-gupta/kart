<p align="center">
  <img src="assets/images/kart-logo.svg" width="72" alt="Kart logo" />
</p>

<h1 align="center">Kart</h1>
<p align="center">Scan your groceries as you shop, live, with your camera.</p>

<p align="center">
  <img alt="Platform" src="https://img.shields.io/badge/platform-iOS-black">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue">
</p>

Point your phone's camera over your cart and Kart recognizes what's in it in real time. No
barcodes, no manual entry. Each item gets outlined the moment the camera finds it, tints green
once it's confidently counted, and drops into your bag with its real product photo and price.
Finish the cart and it joins your trip history, persisted across launches.

## How it works

Kart runs Apple's Vision framework on-device, live, through a native Swift frame processor:

1. **Find**: `VNGenerateObjectnessBasedSaliencyImageRequest` locates the most salient regions
   in each throttled camera frame.
2. **Read**: each region is classified (`VNClassifyImageRequest`) and OCR'd
   (`VNRecognizeTextRequest`) to disambiguate packaged goods that look alike.
3. **Track**: a JS-side IoU tracker follows each item across frames through a forming →
   tentative → locked confidence state machine, so two of the same product each count as their
   own unit.
4. **Match**: labels and OCR text resolve against the product catalog; a lock fires exactly
   once per physical item.

No barcode scanning, no cloud calls. Everything runs on-device.

## Features

- Live camera recognition with real-time item outlines and confidence states
- Real product photos and pricing pulled into every scan
- Cart history that persists across app restarts
- Native iOS 26 Liquid Glass chrome

## Tech stack

- **Expo (React Native)** + Expo Router, TypeScript
- **react-native-vision-camera** for the camera pipeline and frame processors
- **Apple Vision** (Swift) for on-device saliency detection, classification, and text recognition
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
  engine/liveVision/   The live recognition pipeline: tracker, label matcher, coverage hints
ios/Kart/              Native Swift Vision frame processor
```

## License

MIT. See [LICENSE](LICENSE).
