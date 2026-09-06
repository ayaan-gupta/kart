# Fifteen cluttered photographs: what a real kitchen changed

Every other corpus here photographs goods against a background that was chosen. The shelf corpus
is Indian retail shelves, the cart corpus is haul photographs mostly taken on tables, RPC is
products on a turntable, and the kart corpus is one trolley in one shop. This one is fifteen
photographs the owner took of their own kitchen on 2026-08-15: a loaded basket on a worktop with
the day's post, a book, a mask and a red cup around it; a home pantry shelf; and the inside of a
refrigerator, down to the shopper's own sandals in the frame.

Provenance is in `corpus/clut/manifest.json`, the labels are in `corpus/clut/labels.json`, and
the files are the owner's and are not committed. One command:

    npm run serve --prefix server
    node --env-file=server/.env.local server/node_modules/.bin/tsx \
      server/eval/pipeline/clut-photos.ts --repeat 3

Each photograph is scanned into a **fresh** bag, so what is measured is what one press of the
button puts in front of the shopper, with no help from anything scanned before it. Three passes,
always, because two scans of one photograph differ in a name, a count, and occasionally in whether
a product is seen at all: a single pass is an anecdote.

## Where this stands

Three passes over fifteen photographs, 81 labelled products, at $0.0006 a photograph.

|  | before | after |
|---|---|---|
| 1 every item reaches the bag | 118/240 **49%** | 193/243 **79%** |
| &nbsp;&nbsp;of which, the basket | 97/111 87% | 100/111 **90%** |
| &nbsp;&nbsp;of which, pantry and fridge | 21/129 16% | 93/132 **70%** |
| 2 quantities are right | 107/118 91% | 148/193 77% |
| &nbsp;&nbsp;brands right | 61/79 77% | 104/125 **83%** |
| 3 hidden items are flagged | 22/39 | 25/39 |
| 4 unsure items are flagged | 5/19 | 8/32 |
| scene gate correct | 21/45 | 41/45 |
| seconds per photograph | 5.2 | 5.7 |

"Before" is `687ef13`, measured against the label set as it stood at that commit, which was
missing clut13's mayonnaise and called clut12's bag greens rather than cucumbers. That flatters
it by at most three products in 240.

Requirement 2 falls because it is now measured over 75 more products, and the ones the gate used
to hide are the hard ones: how many eggs, how many apples in a crisper drawer.

## The one change that did it

The subject gate emptied the response on 18 of 24 scans of the pantry and the refrigerator. It was
built to stop a photograph of a shop's shelves filling the bag, which it does, and a household's
own storage was never a case it was told about. Rule 0 now names it and says what separates the
two from the goods themselves rather than from the furniture: door shelves and a salad crisper,
packets already opened, food decanted into the household's own jars, a sponge in among the food,
one of a thing rather than a row of it, no price labels anywhere.

**Shop protection is unchanged**, which is the entire risk of that change. `scene-gate.ts`, three
passes over twelve labelled photographs, before and after: cart 18/18, product 6/6, shelf 12/12.
The four real shop shelves are still emptied.

## One alternative was researched and refused

**Telling the model to read the brand letter by letter.** The measured errors are PRIANO read as
Primo, Piano and Pallano, and a Simply Nature jar read as Rao's Homemade: the model substituting
the famous neighbour. Rule 2 was given a paragraph forbidding exactly that, with those two
examples named.

It bought nothing. Brands went 83% to 82% overall and 82% to 84% on the basket tier, both inside
the run-to-run spread on 75 samples, and the subject verdict on the basket tier went from 18/21 to
10/21 (harmlessly, since none of those were "shelf", but it is movement where none was wanted).
Reverted. The brand misread is real and still open; a longer prompt is not the lever.

## What the phone sends, measured on 2026-09-05

The phone no longer sends the photograph. It sends `prepareUpload`'s bounded JPEG of it, a 2048
long edge at quality 0.85 (`src/engine/liveVision/uploadImage.ts`), because the whole file was a
7.6MB request body for one basket photograph and a 48MP phone would have tripped the service's
12MB limit outright. The census reads at 1536 either way, so the question was whether resizing
twice and compressing twice costs anything. `--as-phone` runs the shipped bound through this
harness with sharp standing in for the device; `--long-edge` and `--quality` sweep it.

Three passes each, the same day, against the same service, all four requirements. The original
file was re-run too, because the committed column above was one draw:

|  | committed (09-04) | original, re-run | **phone: 2048 / 0.85** | phone: 3072 / 0.90 |
|---|---|---|---|---|
| 1 every item reaches the bag | 193/243 79% | 185/243 76% | 189/243 **78%** | 194/243 80% |
| 2 quantities are right | 148/193 77% | 145/185 78% | 159/189 **84%** | 152/194 78% |
| &nbsp;&nbsp;brands right | 104/125 83% | 92/120 77% | 99/127 **78%** | 90/125 72% |
| 3 hidden items are flagged | 25/39 | 24/39 | **24/39** | 25/39 |
| 4 unsure items are flagged | 8/32 | 8/33 | **7/31** | 8/33 |
| lines matching nothing real | 45 | 42 | **36** | 39 |
| scene gate correct | 41/45 | 37/45 | **35/45** | 30/45 |
| scans emptied by the gate | 0 | 0 | **1** | 0 |

**The shipped bound is indistinguishable from the original file** on every requirement, inside
the spread the re-run itself shows. The larger 3072 / 0.90 bound bought nothing and read fewer
brands, so it was not taken; a bigger upload is not a better one.

**Two things the re-run says about the numbers above it.** Brands moved 83% to 77% with nothing
changed but the day, so the brand figure has a spread of about six points on 125 samples, and
the committed column was a favourable draw. And the scene verdict on the basket tier went from
18/21 to 13/21 on the same photographs and the same prompt (12/21 and 6/21 on the two bounded
runs), all of it "product" where "cart" was expected and none of it "shelf", so no basket scan
was emptied; the one emptied scan in the shipped column is on the storage tier, where the gate
is right 23 or 24 times in 24 on every run. That verdict is a measurement to watch, not one this
change made.

```
node --env-file=server/.env.local server/node_modules/.bin/tsx \
  server/eval/pipeline/clut-photos.ts --as-phone --repeat 3 --out server/eval/clut-photos-phone.json
```

`clut-photos-phone.json` is that run. The other two columns are the same command without
`--as-phone`, and with `--long-edge 3072 --quality 0.9`.

## The tier is the lever, measured on 2026-09-05

The owner's benchmark is that ChatGPT reads these photographs completely. ChatGPT runs
gpt-5.6-sol, the flagship tier, with reasoning, on the whole image, under a one-line question.
The census ran gpt-5.6-luna, the smallest tier, at reasoning "none", on a 1536 composite, under
sixteen rules written for badges. `plain-baseline.ts` varies those one at a time: it calls the
model directly with a one-paragraph question and scores the answer with the same labels and
the same scorer as the pipeline.

**First the scorer had to be fixed.** It handed every matching line to the first label that
matched it, so two labels sharing a word ("cracker", "milk", "beef") could never both be found:
the first was scored with a doubled quantity and the second as a miss, on every tier alike.
It also compared accented text raw, so "Neufchâtel" never matched "neufchatel". That is what
pinned "found" at 79% for Luna and Sol alike. `clut-scoring.ts` now assigns each line to one
label, most specific phrase first, and `clut-rescore.ts` re-scores any saved run without a
call. Two clut13 labels were corrected at the same time; `labels.json` says which.

One pass each, 82 labelled products, the corrected scorer and labels throughout:

|  | found | quantities | brands | hidden flagged | seconds | per photo |
|---|---|---|---|---|---|---|
| pipeline as shipped that morning (Luna, 16 rules, 1536) | 66/82 80% | 89% | 35/44 80% | 7/13 | 4.9 | |
| Luna, one paragraph, full image | 67/82 82% | 88% | 34/45 76% | 12/13 | 4.6 | $0.001 |
| Terra, low | 68/82 83% | 91% | 35/45 78% | 13/13 | 9.1 | $0.01 |
| Terra, medium | 68/82 83% | 90% | 36/45 80% | 13/13 | 9.9 | $0.01 |
| **Sol, none** | **73/82 89%** | **89%** | **44/47 94%** | **12/13** | **5.4** | **$0.02** |
| Sol, low | 74/82 90% | 88% | 41/48 85% | 12/13 | 14.8 | $0.03 |
| Sol, medium | 73/82 89% | 89% | 45/48 94% | 12/13 | 33.3 | $0.05 |

Per-photo cost is at the prices in `server/src/usage.ts`, the September 2026 rates.

**The prompt was never the gap.** The one-paragraph question scores the same as the sixteen
rules on Luna, and the same on Sol whichever way it is asked. **The tier is.** Luna and Terra
read PRIANO as Piano, Primo, Prano and Praino across every pass, and the Simply Nature marinara
as Muir Glen or Rao's; Sol reads them. **Reasoning buys Sol nothing** its eyes do not have:
"none" and "medium" tie on every requirement and "none" is six times faster, so the photo path
now runs Sol at "none" under `PHOTO_SYSTEM_PROMPT`, and the pipeline's own three-pass number is
in the next table. The live scan's census stays on Luna: it is fused from several calls and its
bakeoff was measured on that.

**Through the shipped path**, `clut-photos.ts --as-phone --repeat 3`, the phone's own upload
bound and the service's own call, before and after the change. "Before" is the same morning's
Luna run re-scored with the corrected scorer, so the two columns differ only in the tier and
the prompt:

|  | Luna, 16 rules, 1 pass | Sol, photo prompt, 3 passes | **Sol, with the product gate, 3 passes** |
|---|---|---|---|
| 1 every item reaches the bag | 66/82 80% | 218/246 89% | 222/246 **90%** |
| &nbsp;&nbsp;of which, the basket | 32/37 86% | 105/111 95% | 105/111 **95%** |
| &nbsp;&nbsp;of which, pantry and fridge | 34/45 76% | 113/135 84% | 117/135 **87%** |
| 2 quantities are right | 59/66 89% | 192/218 88% | 195/222 **88%** |
| &nbsp;&nbsp;brands right | 35/44 80% | 129/144 90% | 132/144 **92%** |
| 3 hidden items are flagged | 7/13 | 39/39 | **39/39** |
| 4 unsure items are flagged | 7/31 | 9/36 | 8/39 |
| lines matching nothing real, all tiers | 13 | 69 | **49** |
| seconds per photograph | 4.9 | 6.5 | 6.6 |

`clut-photos-sol.json` is the gated run, the shipped path as it stands. The gate ("Nothing to
buy in the frame", below) drops what the model itself says is not a product, which is where the
twenty fewer lines matching nothing real went; it dropped nothing labelled. Requirement 4 did not move and is the open one: an
illegible product still comes back with a confident guess more often than not, on either tier.
The remaining basket-tier brand errors are one bag: PRIANO's stylised logo read as "Piano",
"Pri Ano" or "Pri" on 5 of 42 readings. A first draft of the photo prompt said to read the brand
letter by letter; that produced "Pri An O" and was dropped, and the run without it is the one
above, identical on every requirement.

**What no tier finds**, one pass each, all of them alike: a Campbell's tin showing only its red
base behind the Nutella, a cookie mix box, sponges, a whey tub, a Freshpak box, butter, a
packaged chicken under the apples, and clut13's second milk carton. They are the mostly hidden
things in the pantry and fridge photographs, and the shipped answer to them is the occlusion
notice, which every Sol pass raises on 12 of the 13 photographs that have something hidden.

## Nothing to buy in the frame, measured on 2026-09-05

A tester photographed a table and the bag said "assorted chocolates". Two things have to hold
for that not to happen: the model must be allowed to answer "nothing", and what it does report
must be shown as sure or unsure according to its own confidence, because the shopper had no way
to tell a guess from a reading.

`corpus/clut/negatives.json` cuts four rectangles out of the clut originals and
`clut-negatives.ts` sends them through the shipped photo path. Three hold nothing to buy at all:
a desk with a book, a wallet and papers; a bare countertop; floor tiles and the shopper's feet.
The fourth is the hard case, the top strip of a refrigerator with leftovers in the household's
own tubs and the neck of a wine bottle, where the bottle is a real product and the tubs are
not. Three passes each, before and after today's change, and once more through the server as it
was before Sol (`675a304`, Luna under the sixteen badge rules), which is the code the tester most
likely had:

|  | three empty scenes, 9 scans | the fridge strip, 3 scans |
|---|---|---|
| Luna, 16 rules (`675a304`) | 9/9 empty | not run |
| Sol, photo prompt, before the gate | 9/9 empty | "food leftovers" at 0.54 and "bottled beverage" at 0.45, every pass |
| **Sol, photo prompt, with the gate** | **9/9 empty** | **3/3 empty**, the bottle named once and allowed |

An empty scene does not produce a product on any tier, so the report is not an empty-scene
invention these crops can reproduce; it reads as an object on the tester's table misread and
then asserted. What the fridge strip shows is the gate doing its job on exactly that shape of
error: an object that is food but not a product, which the model listed at a confidence below
its own guessing line and the bag would have asserted. Two changes, both kept:

1. **`isProduct` on every unmarked item.** The photo prompt now defines a product as something a
   supermarket sells, as it is sold, and lists what is not (leftovers, food in the household's
   own container, a drink in a glass, tableware, a book, a phone, furniture). The model answers
   the question per item, the same field a badge has always carried under rule 8, and the server
   drops anything it answers false to, with its count. It also says in words that a table, a
   desk, a room or a person has no products in it and that empty lists are the right answer.
2. **Unsure lines are flagged in the bag.** Both prompts have always told the model that a guess
   belongs below 0.6. The bag now shows a line below that as "Not sure" in amber, first on its
   subtitle, instead of asserting it like any other line. That is CLAUDE.md's fourth requirement
   arriving on the screen for the first time.

The fifteen positives were re-run through the gate to make sure it drops nothing real; the row is
in the shipped-path table above.

## What the numbers do not cover

The basket tier's labels are complete, so both its recall and its count of lines matching nothing
real are meaningful. The storage tier's labels are **not exhaustive**: a pantry shelf holds dozens
of things, half of them behind other things, and `labels.json` lists only the ones a reader can
identify with confidence. Recall there is a lower bound and is meaningful. The count of lines
matching nothing real is **not** a hallucination count on that tier, because most such lines name
something really there that the file does not list.

Three labels were corrected on 2026-09-04 by going back to the photograph after a model answer
disagreed with one. `labels.json` records which.
