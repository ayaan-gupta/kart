# Cart photo eval corpus

Photos of real loaded grocery carts, with hand-written ground truth.

## Labelling rules

Write down every item a careful human can identify in the photo.

- `name`: the most specific name a shopper would use. "Kellogg's Froot Loops" not "cereal".
  Include size when it is legible ("family size", "64 oz").
- `brand`: the brand alone, or null for unbranded produce.
- `qty`: how many distinct physical units of that product are in the cart. One bunch of
  bananas is 1. Two identical bags of chips is 2.
- `occluded`: true if a human can tell the item is there but cannot fully see it, for
  example a box mostly hidden under other items.

Do not list items you cannot actually see. The eval scores the model against what is
genuinely visible, so guessing here corrupts the recall number.

## What the photos have to be photos of

Ten openly licensed cart photographs were collected for the detector work, and measuring
against them turned up a corpus problem worth stating before anyone collects more.

Only five depicted the thing this app does: a loaded cart seen roughly bird's eye with loose
items in view. The other five were a parking lot of tied grocery bags, a frame 60% filled by a
handwritten shopping list, a side view of bread bags, a cart holding nothing but identical water
multipacks, and one similar. Averaging a recall number over all ten does not measure the product,
it measures the corpus, and tuning against it optimises for the wrong photograph.

So: collect photos a shopper would actually take at the checkout queue. Bird's eye or close to
it, cart filling most of the frame, items loose rather than bagged. Variety belongs in lighting,
cart type, density and product mix, not in whether the cart is the subject.

Record the source URL and licence of every photo in a manifest next to it as you add it. The
first ten were collected without one, which is why they cannot be committed here.

## Status

No photos are committed. The `ground-truth.json` file currently contains an empty object
placeholder. Both the images directory and ground truth must be populated before the eval
harness produces meaningful accuracy numbers.

Note that `ground-truth.json` scores naming, which is a different question from whether the
detector found the item at all. Detector recall is measured separately, against one labelled
point per item; see `docs/enumeration-recall.md`.
