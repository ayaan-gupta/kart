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

## Read wide, then read close, measured on 2026-09-06

The owner's next ask was for no mistakes, and for the shopper to see their own photograph with
what the app is sure of in green and what it is not in yellow, with "Please give me a better
image of this so I can confirm what it is." beside the yellow. The measured errors above are of
four kinds, and only some of them are reachable from one photograph: a brand misread (PRIANO's
stylised logo as Piano), two products lumped (a cookie box read as a second cake mix), a count
off by one (two stacked bags as one, three egg cartons as four), and an item mostly hidden.
Nothing reads what is not visible, so the target became two things, each measurable: every
line the app asserts is right, and every line it is not sure of is shown amber and asked about.

The way there is a second reading. The census places a box on every product; the phone cuts
each box out of its original photograph; a second call reads each crop on its own; and the
server asserts a line only when the two readings agree on the product, the brand and the count
(`server/src/reconcile.ts`). The spec is `docs/superpowers/specs/2026-09-06-photo-verification-design.md`.

### What the probe decided

`box-probe.ts` asks two questions before any of it was built: can the model place a box on
each product, and does a crop read what the wide pass misread. Every item on five photographs
came back boxed, tight enough to crop (`.cache/clut/boxes/` holds the drawn photographs). The
second question decided where the crop is cut from:

| the same jar of Simply Nature marinara, clut4 | read as |
|---|---|
| crop of the 2048 upload, 423 pixels wide | "Murphy's Naturals", 0.97 |
| crop of a 3072 upload, 641 pixels wide | "Merry Chef", 0.99 |
| crop of the original, 1117 pixels wide | "Simply Nature", 0.99 |

Two confident wrong brands from the pixels the upload keeps, the right one from the pixels it
throws away. So the phone cuts from its original (`prepareCrops`, 1536 on the long edge, padded
8%) and posts the crops to a second route, `/api/verify`; the review draws the boxes as soon as
the census answers and colours them when the close read lands. The same probe read PRIANO off
the rigatoni bag on every crop, counted the two stacked rigatoni bags as two where the wide pass
said one, and found the Campbell's tin no pass had found.

### Four things the first measurement changed

Each was found by running the harness and reading the flagged lines, and each is pinned by a
test.

1. **The close read is not told the wide count.** Told it, it echoed it: a shelf of three egg
   cartons was counted as five by a wide pass that had summed two entries, and the close read
   agreed with five. Counted on its own it says three. A different count now makes the line
   unsure, with the wide count left on it.
2. **The photograph census answers in its own compact schema** (`photoJsonSchema`: name, brand,
   count, confidence, isProduct, box in whole percentages), and the server derives the key with
   `productKey` and folds it into the census shape. The wide pass had been writing a hand-built
   key twice per product and taking 10 to 16 seconds on a fridge; it takes 4 to 7 now, and the
   key that used to drift is gone.
3. **The crop is padded 8%, not 12%, and the close read is told a neighbour is not a unit.** At
   12% a bag of the same brand beside the product was cut into the crop and counted as a second
   unit of it on five products. Legibility only gates a line that carries a brand: loose produce
   has no text to read, and a close read that called green onions illegible had not doubted
   that they were green onions.
4. **Two boxes one inside the other, on two names that share their words, are one object.** The
   wide pass named a package of beef ribs twice, and each close read confirmed its own hint, so
   the bag held two of one thing and both were sure. The survivor is kept and shown unsure.

### The numbers

`clut-photos.ts --as-phone` is the shipped path; `--no-verify` is the wide pass alone, on the
same compact schema, which is the "before" arm. Both cut from the same labels, corrected the
same day (below), and both report a fifth number: **asserted lines wrong**, the lines shown as
sure that were wrong or matched nothing real on the basket tier, which the gate exists to make
zero. "Unsure" lines are the gate's cost: right ones are photographs the shopper is asked for
without needing to be.

The three-pass run of the shipped path was cut short: the OpenAI account answered
`429 credit_balance_exhausted` after eleven scans, and passes two and three failed on every
photograph. So the numbers below are what exists, each column labelled with its size, and the
three-pass run is first on `WHEN-CREDIT-RETURNS.md`. Every column is scored against the same
corrected labels with `clut-rescore.ts`; the "before" column is the same wide pass the shipped
path starts with, and the last column is the wide pass alone on the previous day's schema, from
the table above, re-scored.

|  | Sol, single reading, 3 passes (09-05) | wide pass alone, 1 pass | **read twice, first 11 scans** | read twice, 1 complete pass, before the duplicate fold |
|---|---|---|---|---|
| photographs scanned | 45 | 15 | **11** | 15 |
| 1 every item reaches the bag | 223/246 91% | 73/82 89% | **51/57 89%** | 73/82 89% |
| &nbsp;&nbsp;of which, the basket | 108/111 97% | 35/37 95% | **36/37 97%** | 36/37 97% |
| 2 quantities are right | 200/223 90% | 68/73 93% | **48/51 94%** | 68/73 93% |
| &nbsp;&nbsp;brands right | 133/145 92% | 48/49 98% | **40/41 98%** | 47/48 98% |
| 3 hidden items are flagged | 39/39 | 13/13 | **9/9** | 13/13 |
| 5 asserted lines wrong, all | not measured | 5/72 | **2/43** | 5/64 |
| &nbsp;&nbsp;of which, the basket | | 2/34 | **0/31** | 0/31 |
| unsure lines, wrong / right | | 1 / 2 | **4 / 7** | 3 / 9 |
| seconds per photograph | 6.6 | 5.1 | **7.7** | 8.5 |
| dollars per photograph | 0.017 | | **0.066** | 0.074 |

`clut-photos-verify.json` is the eleven scans; `clut-photos-verify-pass1.log` is the complete
pass that preceded it, whose JSON was not kept; `clut-photos-wide-compact.json` is the wide
pass alone. Cost is read off the service's `/usage` route before and after each run, at the
prices in `usage.ts`, and includes the wide pass.

**On the basket tier, the shipped use case, no line shown as sure was wrong**: 0 of 31 on each
of the two complete passes, with 97% of items found, 97% of quantities and every brand right,
against 2 of 34 for the wide pass alone. The basket photographs are the ones with complete
labels, so that number means what it says. Six lines were held back as unsure across those two
passes and four of them were right, which is the price: a shopper photographs an item again
that was already read correctly about once every three or four photographs.

### What is still asserted wrong, and why the second reading cannot catch it

Every asserted-wrong line that remains is on the storage tier, and every one is a case where
both readings read the same wrong thing off the same pixels:

- **A box read from its back.** clut8's Baker's Corner baking soda box shows only its back
  panel, which prints a recipe for chocolate chip cookies calling for the brand's chocolate
  morsels; wide and close both read "semi-sweet chocolate morsels", and on the box beside it,
  standing on its side, both read the side panel's "baking bar". Two lines, every pass. A person
  who could not turn the box over would guess the same.
- **A second unit hidden behind the first.** clut12's two Neufchâtel boxes stacked with only
  their ends showing were read as one by both. The label marks it hidden; the occlusion notice is
  raised on the photograph; the count stays wrong.
- **A brand both readings hallucinate alike.** On the complete pass before the fold, clut14's
  Simply Nature ground beef, upside down behind a drawer lid, was read as "Simple Truth Natural"
  by both readings at 0.98. The packet says Simply Nature at native resolution. The wide pass
  had listed the beef ribs beside it twice under two names, which is what the duplicate fold
  now catches; the brand it cannot.

The first and third are what a store catalog answers: neither "chocolate morsels" in that box
nor "Simple Truth" in that store is a product on the list, and the resolver would have to pick
from what is. That is the closed-world design in CLAUDE.md, still not built. The second is
CLAUDE.md's third requirement doing its job: the flag is raised, and the count waits for the
shopper to move the box.

What the gate held back and was right about, on the eleven scans: a jar of pasta sauce and a
tin the close read could not read, two bags of the same brand where the close read counted the
neighbour, and the stacked rigatoni where the wide pass counted one and the close read two.
Each of those is a photograph the shopper is asked for. The alternative, asserting them, was
wrong on the rigatoni.

### The close reader's tier

The close read runs on the photo model, Sol. `KART_VERIFY_MODEL` swaps it, and one pass with
gpt-5.6-luna reading the crops, against the same labels and the same wide pass:

| close reader, one pass | found | quantities | brands | asserted wrong | unsure, wrong / right | seconds | per photo |
|---|---|---|---|---|---|---|---|
| Sol (shipped) | 73/82 89% | 68/73 93% | 47/48 98% | 5/64 | 3 / 9 | 8.5 | $0.074 |
| Luna | 73/82 89% | 60/73 82% | 47/48 98% | 5/54 | 12 / 11 | 7.6 | $0.013 |

Luna reads the crops for a sixth of the price and asserts as many wrong lines while holding
back four times as many wrong ones and about as many right ones, and its counts are worse: it
disagrees with a right wide reading about as often as it catches a wrong one. Sol stays. Per photo at the prices in
`usage.ts`, read off the service's `/usage` route before and after each run; the Sol row is the
single pass that preceded the three-pass run below and includes the wide pass.

### Nothing to buy in the frame, again

`clut-negatives.ts --repeat 3` through the two-reading path: 12 of 12 scans came back empty,
nothing asserted and nothing unsure, the wine bottle named once and allowed.

### Labels corrected the same day

Three, each by zooming into the photograph at native resolution after a close reading disagreed
with the file, and each recorded in `labels.json`: clut8's orange Baker's Corner box is baking
soda (its back panel says so), not a cookie mix; clut11's Sempio is printed only as 샘표; clut7
holds three or four cans of black beans, the fourth mostly behind the others. And the Simply
Nature brown rice and quinoa fusilli's match terms were narrowed so the household's own jar of
loose quinoa on the same shelf stops scoring as that box. Earlier runs are re-scored with
`clut-rescore.ts`, which now prints the gate's numbers for any run that carried them.

## What the numbers do not cover

The basket tier's labels are complete, so both its recall and its count of lines matching nothing
real are meaningful. The storage tier's labels are **not exhaustive**: a pantry shelf holds dozens
of things, half of them behind other things, and `labels.json` lists only the ones a reader can
identify with confidence. Recall there is a lower bound and is meaningful. The count of lines
matching nothing real is **not** a hallucination count on that tier, because most such lines name
something really there that the file does not list.

Three labels were corrected on 2026-09-04 by going back to the photograph after a model answer
disagreed with one. `labels.json` records which.
