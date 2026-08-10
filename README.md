# Kart

Scan your groceries as you shop. Point the camera at your cart, watch items get recognized with
their real photos and added to your bag live, then finish the cart and keep a history of every
trip.

Built with Expo (React Native). The scan is genuinely live: `react-native-vision-camera` feeds
throttled camera frames to a native Swift Frame Processor Plugin that runs Apple Vision on-device
— saliency detection to find items in frame, the image classifier to read what they are, and text
recognition to disambiguate packaged goods by their label — no barcodes anywhere. A JS pipeline
matches that output against the product catalog and tracks each item across frames with a
forming (white outline) → tentative (amber, low confidence) → locked (green, counted) state
machine, so two physically distinct items of the same SKU each count on their own. Finished carts
persist across restarts via AsyncStorage. `scripts/classify-regions.swift` remains in the repo as
an offline calibration tool for validating the classifier against sample footage ahead of tuning
live thresholds, but it no longer drives the app itself.

## Run it

```bash
npm install
npx expo run:ios
```

Requires a custom dev build, not Expo Go — the live camera pipeline needs the native Vision frame
processor plugin (`ios/`, committed to this repo), which isn't in Expo Go's prebuilt binary. The
simulator has no real camera, so the scan feature's actual recognition can only be verified on a
physical device; everything else (including the whole app on the simulator) works normally.
Best on an iOS 26 device, where the floating chrome uses genuine Liquid Glass.

## The app

- **Home**: the Kart logo up top, monthly spend at a glance, your latest cart, and earlier trips
  as photo-collage cards.
- **Scan** (the orange plus): a live camera view over the groceries, like holding your phone above
  the cart. Items get a white outline as the model first notices them, amber if the read is still
  too unsure to trust, then a green tint once it's confidently counted; whatever is untinted is
  still left to scan. Recognized items pop up cardless with their photo, an orange check, name,
  and price, then drop into the bag. The bag is a white tray fixed to the bottom edge of the
  screen; tap or swipe it up and the full bag expands out of it, live, with a total and "Finish
  cart". A hint appears at the top, never blocking, if items seem to still be waiting to be
  scanned.
- **Cart detail**: every item with its photo, quantity, and price, plus the trip total.

## Structure

```
src/
  design/      tokens.ts, type.tsx (system font scale)
  engine/      catalog.ts, store.ts (carts + scan session, persisted via AsyncStorage)
  engine/liveVision/  geometry.ts, labelCatalog.ts, labelMatcher.ts, tracker.ts, pipeline.ts,
                       coverageHint.ts, frameProcessor.ts (the live recognition pipeline)
  components/  BagTray, DetectionRow, ItemHighlights, ProductImage, HaulCard,
               FloatingNav, GlassSurface, KartLogo, SkuTile, Button, IconButton, PressableScale
  app/         index (home), hauls (all carts), scan, haul/[id]
ios/
  Kart/        KartVisionFrameProcessorPlugin.swift/.m (native Vision frame processor)
```

## Media

- Logo: kart-logo.svg and kart-logo-animated.svg, provided by the owner. The animated version
  drives the launch loader (AnimatedKartLogo).
- Product photos: spoonacular ingredient CDN and Open Food Facts / Open Products Facts
  (community photos, CC licensed), fetched by scripts/fetch-images.mjs into assets/products.
  Demo use; recheck licenses before any commercial release.

Design notes: off-white surfaces, system font with weight-driven hierarchy, Kart orange as the
single accent, real product photos on white tiles, Liquid Glass only for floating chrome, springs
with no bounce, 44pt touch floor.
