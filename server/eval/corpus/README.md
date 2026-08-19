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

## Open sources have been searched and do not have these photographs

Worth recording so nobody spends another afternoon on it. Searched 2026-08-18:

| source | query | usable |
|---|---|---|
| Openverse, all CC licences | "grocery cart groceries" | 50 results, 12 downloadable, **0 usable** |
| Openverse | "shopping trolley food" | 2 results |
| Openverse | "supermarket cart items" | 0 results |
| Wikimedia Commons | "shopping cart groceries filled" | book scans, no photographs |
| Wikimedia Commons | Category:Shopping carts | mostly audio pronunciation files and empty carts |

Every one of the twelve downloadable images was an empty cart, a cart line drawing, clip art,
a rank of nested carts outside a shop, or a store interior. Not one showed a loaded cart.

The reason is obvious in hindsight. People photograph carts as objects, or as stock imagery of
shopping. Almost nobody photographs the inside of their own full cart, and the few who do are
posting to social platforms under terms that do not permit redistribution.

So this corpus has to be shot deliberately. It is not a search problem.

## What to shoot

Fifteen to twenty photographs, each of a genuinely loaded cart, from roughly above, cart filling
most of the frame, items loose rather than bagged.

Vary: how full the cart is, how much things are stacked, lighting (daylight near the door versus
strip lighting at the back), cart type, and product mix. Do not vary whether the cart is the
subject.

At least four pairs shot for occlusion specifically: the same cart photographed twice, once with
an item buried under others and once with that item plainly visible. Nothing else measures
whether the occlusion warning fires when it should, which is currently untested.

## Status

No photos are committed. The `ground-truth.json` file currently contains an empty object
placeholder. Both the images directory and ground truth must be populated before the eval
harness produces meaningful accuracy numbers.

Nothing in this project has yet measured whether hidden items are flagged as hidden, or whether
uncertain items are flagged as uncertain. Those are two of the four things the product has to do
(see the testing standard in `CLAUDE.md`) and both are unmeasured for want of this corpus.

Note that `ground-truth.json` scores naming, which is a different question from whether the
detector found the item at all. Detector recall is measured separately, against one labelled
point per item; see `docs/enumeration-recall.md`.
