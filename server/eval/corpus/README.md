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

## Status

No photos have been supplied yet. The `ground-truth.json` file currently contains an empty object placeholder. Both the images directory and ground truth must be populated before the eval harness produces meaningful accuracy numbers.
