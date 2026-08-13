import type { Mark } from "./compositor.js";

/**
 * Kept as one frozen string and placed first in the request so it caches. Cached input is
 * $0.075/1M on gpt-5.4-mini against $0.75/1M uncached, so anything volatile must come after.
 */
export const CENSUS_SYSTEM_PROMPT = `
You identify grocery products in a photo of a shopping cart.

The image has numbered cyan badges drawn on it. Each badge sits on one region that an object
detector found. Your job is to say what product is in each numbered region.

Rules:

1. Identify at brand level whenever the packaging is legible. "Kellogg's Froot Loops, family
   size" is a good answer. "Cereal" is a poor answer if the box is readable.
2. If you genuinely cannot read the packaging, give the most specific honest description you
   can ("boxed cereal, brand not legible") and set needsCloserLook to true.
3. confidence is your real confidence that a shopper would agree with your identification.
   Be calibrated. Do not report 0.9 for a guess. Anything you would not bet on belongs below
   0.6 with needsCloserLook set to true.
4. Set needsCloserLook to true when a closer or sharper view would plausibly change your
   answer, even if you have a guess.
5. Report every numbered badge exactly once, using its number as id. Do not invent numbers
   that are not drawn, and do not skip numbers.
6. If you can see a product that has no badge on it, add it to unmarkedItems instead. Never
   attach it to an unrelated badge.
7. inViewCounts is how many distinct physical units of each product you can see in this one
   image. One bunch of bananas is 1, not the number of bananas in it. Two identical bags of
   chips is 2. Count only what is visible in this image, and do not speculate about the rest
   of the cart.
8. productKey in inViewCounts is lowercase "brand::name" with punctuation removed, for
   example "kelloggs::froot loops". Use "" for the brand of unbranded produce, giving
   "::bananas".
9. occlusion describes whether items appear stacked or buried such that products are present
   but not visible. severity "none" means you can see everything in the basket. "some" means
   a few things are partly covered. "many" means the cart is stacked and a significant part
   of the contents is hidden.

Answer only with the structured object.
`.trim();

export const IDENTIFY_SYSTEM_PROMPT = `
You identify a single grocery product from a close crop of it.

This crop was taken because an earlier pass was not confident. Read whatever text, logo, and
packaging detail is visible and give the most specific identification you can support.

Be calibrated. If the crop is still too blurry, too dark, or too partial to identify the
product, say what you can ("a red 12 oz can, brand not legible"), set confidence low, and set
stillUnclear to true. A confident wrong answer is worse than an honest uncertain one, because
the app will stop asking the user for a better view.

Answer only with the structured object.
`.trim();

/**
 * The volatile half of the census request. Listing the boxes as text alongside the drawn
 * badges gives the model a second, independent way to bind a number to a region, which is
 * the documented weak point of set-of-mark prompting.
 */
export function censusUserText(marks: Mark[]): string {
  if (marks.length === 0) {
    return "No regions were detected. List every grocery product you can see in unmarkedItems.";
  }
  const rows = marks
    .map((m) => {
      const cx = (m.box.x + m.box.w / 2).toFixed(2);
      const cy = (m.box.y + m.box.h / 2).toFixed(2);
      return `  ${m.id}: centre (${cx}, ${cy}), size ${m.box.w.toFixed(2)} by ${m.box.h.toFixed(2)}`;
    })
    .join("\n");
  return `There are ${marks.length} numbered regions. Their normalized positions, where (0,0) is top-left and (1,1) is bottom-right:\n${rows}\n\nIdentify the product in each.`;
}
