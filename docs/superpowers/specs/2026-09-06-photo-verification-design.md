# Photo verification and confidence gating

Date: 2026-09-06. Status: being built. The owner asked for three things in one message and said
not to come back until all three are done, so this spec records the decisions rather than
asking for them.

1. Recognition of a photographed cart with, as near as can be reached, no mistakes.
2. A confidence gate in the app: after a photograph, the shopper sees their own photograph with
   every item the model is sure of highlighted green and every item it is not sure of highlighted
   yellow, with the sentence "Please give me a better image of this so I can confirm what it is."
   A second photograph of the yellow item replaces the yellow line.
3. Research: whether a fine-tuned open-weight Qwen would do better than GPT, and what the
   literature and open source offer. Two research agents write `docs/research/`.

## What "zero mistakes" can mean for one photograph

The measured errors on the owner's fifteen photographs (`server/eval/CLUT.md`) are of four
kinds, and only some of them are reachable by a better model:

| kind | example | reachable from one photograph? |
|---|---|---|
| a brand misread | PRIANO's stylised logo read as Piano, Pri Ano, Pri | yes: a close crop reads it |
| two products lumped | a cookie-mix box read as a second cake-mix box | yes: a close crop separates them |
| a count off by one | two stacked identical bags read as one, three egg cartons read as four | partly: a close crop counts the cartons; two stacked bags stay ambiguous |
| an item mostly hidden | a Campbell's tin showing its red base behind the Nutella | no: nothing reads what is not visible |

So the target is not "every line right from one photograph", which no reader of the photograph can
reach. It is two things, each measurable:

- **Every line the app asserts is right.** A line shown green has been read twice, wide and close,
  and the two readings agree on the product, the brand and the count.
- **Every line the app is not sure of is shown yellow and asked about.** Disagreement between the
  two readings, an illegible crop, or low confidence from either reading makes a line yellow, and
  the shopper is asked for a better photograph of that item. The second photograph replaces the
  yellow line.

Hidden items stay under CLAUDE.md's third requirement, the occlusion notice, which every Sol pass
already raises on the photographs that have one.

## Architecture

### Server: read wide, then read close

`runCensus` with no marks is the photograph path. It becomes two stages inside one request:

1. **Wide pass.** One call to the photo model (Sol, effort none) on the 2048 upload, under
   `PHOTO_SYSTEM_PROMPT`. The schema gains one field per unmarked item: `box`, the normalized
   bounding rectangle `{x, y, w, h}` (origin top left, 0 to 1, in the frame the model was shown)
   enclosing every visible unit of that product. It is nullable so the model can decline to place
   an item it cannot box.
2. **Close pass.** For every product the wide pass reported with a box, the server cuts the box
   out of the same upload (padded), and asks the photo model one question per crop, all crops in
   parallel: what is this, what brand is printed, how many units of it are in the crop, is the
   packaging legible, and does the crop show the product the wide pass described. The hint is the
   wide reading. The prompt is `VERIFY_SYSTEM_PROMPT`, a new prompt, and `verifyJsonSchema`.
3. **Reconcile.** A pure function `reconcile(wide, close)` decides per item:
   - agreed: the close pass says the crop matches the wide reading, brands agree (or one is null
     and the other is a legible read, in which case the read brand is taken), counts agree, and
     both confidences are at or above 0.6. The line is sure. Confidence is the mean of the two.
   - otherwise unsure: confidence is capped at 0.5, below `UNSURE_BELOW`, so the existing bag
     flag fires. The displayed brand is the close pass's when it is legible and confident,
     because a close read of printed text beats a wide one; when the close pass says the crop is
     not the product the wide pass described and could read what it is, the line becomes that
     product. The count on an unsure line is the wide pass's.
   - "legible" only gates a line that carries a brand. Loose produce has no text to read.
   - an item with no box or whose crop fails gets no close pass and is unsure.

The response keeps its shape. `unmarkedItems[]` gains `box` and, for the harness and the record,
`verification: { close, agreed }`. `confidence` is the reconciled one, so a client that knows
nothing of boxes still shows a disagreement as "Not sure".

Why the second reading is a crop and not a second wide pass: two wide passes agree on the errors
that matter most. Every consistent count error in CLUT.md is consistent across three passes, and
the brand misread repeats on 5 of 42 readings. A crop shows the model the label at the upload's
full resolution, where the wide pass saw it at roughly 1400 pixels across the whole frame, and
that is the only thing about the input that changes. The cost is one small call per product,
in parallel, so latency grows by one call rather than by the number of products.

Why the crop is cut from the phone's original and not from the 2048 upload: the probe
(`server/eval/pipeline/box-probe.ts`) decided it. A crop of the upload had the model read a jar
of Simply Nature marinara as "Murphy's Naturals" at 0.97, a crop of a 3072 upload as "Merry
Chef" at 0.99, and the same crop of the original as "Simply Nature". So the phone cuts each box
out of its original with expo-image-manipulator (`prepareCrops`, bounded at 1536 on the long
edge, padded 8%), and posts the crops with the wide readings to a second route, `/api/verify`.
Two round trips, and the review shows the boxes as soon as the first returns.

Two things the first measurement changed. The close read is not told the wide count, because
told it, it echoed it; it counts on its own, and a different count makes the line unsure, with
the wide count left on the line. And the photograph census answers in its own compact schema
(`photoJsonSchema`: name, brand, count, confidence, isProduct, box in whole percentages), which
the server folds into the census shape; that halved the wide pass's output tokens and its time.

### Client: the review

`scanPhoto` returns, besides the bag, `items`: what this photograph showed, one entry per product
with its key, name, brand, count, whether it is sure, and its box. `prepareUpload` returns the
upload's oriented width and height beside the base64, because the boxes are in the upload's
frame and the review draws the upload itself, so the two cannot disagree by an EXIF rotation.

`PhotoReview` is a new component: the upload, fitted inside the screen above the bag tray, with
one rectangle per item, green for sure and amber for unsure, each with the product name in a
chip. Below the photograph, the notice: when any item is unsure, the owner's sentence, "Please give
me a better image of this so I can confirm what it is." as a new `CoachKind` `confirm`. Two
controls: "Retake" returns to the live camera; the shutter and Library work from the review too.

The next photograph after a review with unsure items is a **confirmation photograph**. The request
carries the unsure items' names as `confirming`, which the server puts into the user text so the
model reads those products carefully and names them the same way. On the result, in fusion:

- a sure sighting replaces an unsure census identity with the same folded name, taking its key,
  name, brand and confidence, and the quantity is the larger of the two;
- `bagLines`' name fold, which already joins two lines that differ only in brand, prefers the
  sure line's identity over the unsure one's rather than keeping whichever came first.

Both are rules in `fusion.ts` with tests; the screen holds no counting rule.

### What is measured before this ships

`clut-photos.ts` records per line the reconciled confidence, sure or unsure, the box, and both
readings, and reports beside the four requirements:

- **asserted wrong**: sure lines whose product, brand or count is wrong. The number to drive to
  zero.
- **unsure and right**: lines flagged unsure that were in fact right, the cost of the gate.
- **unsure and wrong**: the gate doing its job.
- seconds and dollars per photograph.

Three passes, fifteen photographs, against the same labels, before and after; the negatives
harness re-run to show the gate does not invent. A box-rendering harness writes every photograph
with its boxes drawn, and a sample is looked at, because a box that misses the item is a crop
of the wrong thing and no number here catches that.

## Out of scope

- Prices: blocked on the owner's explicit confirmation, unchanged.
- The live scan path: untouched. The photograph path is a second caller of the same fusion.
- A store catalog: the closed-world design in CLAUDE.md still holds, and this spec does not add
  one. The research reports say what a catalog or a fine-tune would add on top of this.
