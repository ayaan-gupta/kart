# Kart

Scan your groceries as you shop. Point the camera at your cart, watch items get recognized with
their real photos and added to your bag live, then finish the cart and keep a history of every
trip.

Built with Expo (React Native). The scan is driven by real model output: Apple's Vision
classifier was run over each item's region of the bundled top-down footage, frame by frame
(scripts/classify-regions.swift). Each recognized item gets an outline the moment it is
recognized, then a green tint that stays for the session, so whatever is not tinted is what is
left to scan. Pop-ups show the model's actual peak score for that item (grape 61%, corn 91%,
strawberry 40%...). The garlic is real model failure turned into UX: Vision read it as onion
over garlic and never scored it cleanly, so the scanner flags it as uncounted before finally
accepting it without a match percentage. A live on-device pipeline slots into the same store
API.

## Run it

```bash
npm install
npx expo start --ios
```

Best on an iOS 26 simulator or device, where the floating chrome uses genuine Liquid Glass.

## The app

- **Home**: the Kart logo up top, monthly spend at a glance, your latest cart, and earlier trips
  as photo-collage cards.
- **Scan** (the orange plus): a top-down view over the groceries, like holding your phone above
  the cart. Items get outlined in place as the model recognizes them, then keep a green tint
  once counted; whatever is untinted is still left to scan. Recognized items also pop up
  cardless over the video with their photo, an orange check, name, and price, then drop into
  the bag. The bag is a white tray fixed to the bottom edge of the screen; tap or swipe it up and
  the full bag expands out of it, live, with a total and "Finish cart". Hints appear at the top
  with an icon, never blocking.
- **Cart detail**: every item with its photo, quantity, and price, plus the trip total.

## Structure

```
src/
  design/      tokens.ts, type.tsx (system font scale)
  engine/      catalog.ts, store.ts (carts + scan session), scanEngine.ts, recognitionTrack.ts
  components/  BagTray, DetectionRow, ScanFeed, ItemHighlights, ProductImage, HaulCard,
               FloatingNav, GlassSurface, KartLogo, SkuTile, Button, IconButton, PressableScale
  app/         index (home), hauls (all carts), scan, haul/[id]
```

## Media

- Logo: kart-logo.svg and kart-logo-animated.svg, provided by the owner. The animated version
  drives the launch loader (AnimatedKartLogo).
- Scan footage: Mixkit stock video (free license), a top-down spread of fruits and vegetables,
  cropped to portrait and bundled at assets/videos/scan.mp4.
- Product photos: spoonacular ingredient CDN and Open Food Facts / Open Products Facts
  (community photos, CC licensed), fetched by scripts/fetch-images.mjs into assets/products.
  Demo use; recheck licenses before any commercial release.

Design notes: off-white surfaces, system font with weight-driven hierarchy, Kart orange as the
single accent, real product photos on white tiles, Liquid Glass only for floating chrome, springs
with no bounce, 44pt touch floor.
