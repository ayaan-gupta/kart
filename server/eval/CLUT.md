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

## Qwen instead of Sol, measured on 2026-09-07

The proposal was to switch recognition to an open Qwen model: cheaper, open weights, and a
fine-tune available later. It was measured before it was adopted, against the same fifteen
photographs, the same labels and the same scorer, under a rule written down first: adopt only if
items found and quantities both hold and neither brands nor the unsure flagging regresses.

**Qwen does not pass that rule, and is not adopted.**

Nothing in the pipeline had to be rewritten to find that out. OpenRouter implements the Responses
API with `json_schema` strict mode, so `OPENAI_BASE_URL` plus `KART_PHOTO_MODEL` was the whole
port. `KART_OPENROUTER_PROVIDER` was added for the reason in the next section.

### The wide pass, one pass each

| wide reader | found | quantities | brands | invented | hidden flagged | seconds | per photo |
|---|---|---|---|---|---|---|---|
| gpt-5.6-sol (shipped) | 73/82 89% | 68/73 93% | 48/49 98% | 18 | 13/13 | 5.1 | $0.017 |
| qwen3.5-27b | 71/82 87% | 66/71 93% | 43/47 91% | 14 | 11/13 | 10.6 | $0.0019 |
| qwen3.5-27b, second pass | 69/82 84% | 63/69 91% | 41/47 87% | 13 | 12/13 | 9.3 | $0.0019 |
| qwen3-vl-235b-a22b | 54/82 66% | 51/54 94% | 39/40 98% | 6 | 7/13 | 9.7 | $0.0016 |

Two passes of qwen3.5-27b differ by three points on both recall and brands, which is this corpus's
own spread and not a real difference between them. Against Sol the brand gap is larger than that
spread in both passes. It reads PRIANO correctly on some photographs and as "Piano" on others,
which is the failure Luna and Terra have and Sol does not.

qwen3-vl-235b-a22b is the opposite animal: it matches Sol's brands exactly, invents a third as
many lines, and finds two thirds of the cart. Precise and quiet. That is a bad wide reader and an
interesting second one.

### Both readings, the shipped path, cart tier

| two readings | found | quantities | brands | asserted wrong | unsure, wrong / right | seconds | per photo |
|---|---|---|---|---|---|---|---|
| gpt-5.6-sol (shipped) | 36/37 97% | 35/36 97% | 27/27 100% | 0/31 | 2 / 4 | 7.1 | $0.066 |
| qwen3.5-27b | 32/37 86% | 29/32 91% | 23/25 92% | 6/31 | 2 / 3 | 12.5 | $0.0045 |
| qwen3-vl-235b-a22b | 29/37 78% | 27/29 93% | 22/23 96% | 0/16 | 3 / 10 | 10.5 | $0.0029 |

Sol and the 235B both assert nothing wrong. Sol finds 97% of the cart where the 235B finds 78%,
and asks the shopper to re-photograph four right items where the 235B asks for ten. Sol stays.

On four photographs with nothing to buy in them, qwen3.5-27b came back empty 4 of 4 with nothing
asserted and nothing unsure, matching Sol. Hallucinating groceries into a bare room is not where
it is weak.

### The gate needs its two readers to fail independently

qwen3.5-27b through both seats finds **fewer** items than qwen3.5-27b through the wide seat alone
(82% against 87% over all fifteen) and asserts more wrong lines on the cart tier (6/31 against
5/36 wide-only). The gate did not merely fail to help, it cost recall and bought nothing.

The reason is that both readings are the same weights making the same mistake, so agreement
certifies a correlated error instead of catching it. The gate's power comes from the two readers
being wrong about different things. That is why the 235B, whose errors are omissions rather than
misreadings, reaches 0/16 with the same machinery.

It also says what Qwen is actually for here: an independent second reader beside Sol, not a
replacement for both seats. Sol wide plus Qwen close could not be measured on 2026-09-07 because
the OpenAI account was still answering `429 credit_balance_exhausted`. It is the next arm to run.

### Two hazards that only appear when you run it

**The same model and schema returns an empty list, with no error, on some providers.** OpenRouter
routes a model id to whichever upstream it likes. qwen3-vl-235b-a22b with the shipped strict schema
returned `items: []` on every photograph through Alibaba and Novita, and read the photograph
correctly through Parasail and DeepInfra. Asked the same question in plain text with no schema,
the Alibaba endpoint answered "Priano Rigatoni, Hawaiian Brioche Buns, Priano Fusilli Bucati",
all three correct: the eyes were never the problem, the structured-output implementation was.
A cart that silently comes back empty is the worst failure this product has, and unpinned routing
produces it at random. qwen3.6-27b on Alibaba refuses a schema outright with
`'messages' must contain the word 'json' in some form`.

**Providers serve different image resolutions for the same request.** Qwen bills 32x32 px per
visual token, so input tokens are the resolution the model actually saw. The same photograph and
the same call:

| provider | input tokens | seconds | cost |
|---|---|---|---|
| DeepInfra | 1,783 | 6.8 | $0.0014 |
| Alibaba | 3,684 | 8.8 | $0.0013 |
| SiliconFlow | 16,981 | 25.8 | $0.0047 |

Alibaba's 3,684 is roughly native for the 2048px upload; DeepInfra is reading a much smaller
photograph, which is exactly how a brand becomes unreadable. An unpinned run measures a different
resolution on every call and cannot be reproduced, so `KART_OPENROUTER_PROVIDER` pins one upstream
with fallbacks off and every number above names the provider it was measured on.

### A prompt bug Qwen found and Sol had been hiding

The photograph call told the model to list products "in unmarkedItems". That is the *census*
schema's field. The photograph is answered against `photoJsonSchema`, whose array is `items`. Sol
read through the mismatch for as long as the path has existed. qwen3-vl-235b-a22b obeyed it and
returned an empty list. The wording is corrected, and `prompts.test.ts` now reads the field names
out of `photoJsonSchema` at runtime so the two cannot drift apart again.

Sol's rows in the tables above were measured with the old wording. Sol answered in `items`
regardless, so no movement is expected, but that is an expectation and not a measurement: the Sol
arms want a re-run when the account has credit.

## The switch was made on 2026-09-07, and what it costs

The section above measured Qwen against Sol and recommended keeping Sol. The owner's decision was
to switch anyway, which is the decision this project exists to serve, so the photograph tier now
defaults to `qwen/qwen3-vl-235b-a22b-instruct`. The 235B and not the cheaper 27B: the 27B asserts
six wrong lines in thirty-one and the bar is zero.

Re-measured through the shipped default, pinned to Parasail, fifteen photographs, one pass:

| cart tier | found | qty | brands | asserted wrong | unsure | s | $/photo |
|---|---|---|---|---|---|---|---|
| gpt-5.6-sol | 97% | 97% | 100% | 0 of 31 | 4 | 7.1 | $0.066 |
| qwen3-vl-235b-a22b | 78% | 93% | 96% | 0 of 7 | 22 | 5.8 | $0.0027 |

The unsure column is the one to read. Qwen clears the asserted-wrong bar partly by declining to
assert: seven sure lines where Sol produces thirty-one, and twenty-two things the shopper is asked
about where Sol asks about four. On the storage tier it does assert, and three of eight sure lines
are wrong there, so the bar is met on carts and missed on pantries.

This is a worse product today at a twenty-fourth of the price. It is defensible only because both
of its costs are the kind retrieval recovers. A missed item and an unresolved one are what a
catalog shortlist is for; a confidently misread brand, which is what the 27B produces and what got
Luna and Terra rejected, is not.

### The provider is part of the configuration

The first default here was DeepInfra, chosen from the provider table above, which was measured on
qwen3.5-27b. On the 235B it timed out eleven of the fifteen photographs against the service's own
twenty second ceiling. Same harness, same day, only the pin changed:

| pin | scans completed | seconds per cart photograph |
|---|---|---|
| DeepInfra | 4 of 15 | |
| Parasail | 15 of 15 | 5.8 |

A provider inherits nothing from a measurement of a different model, and the shipped default now
names one measured on the model it serves.

### What this configuration has still never been given

A catalog. Every number in this file, for every model, is a reader with no shortlist in front of
it: no enumerator endpoint is configured, so the `catalog:` line in `censusUserText` was empty in
all of them. The plan this switch comes from pairs an open-weight reader with retrieval over the
store's product list. Until one run has that, 78% is this configuration's floor rather than its
result. `docs/research/2026-09-07-retrieval-review.md` is the route there.

## The store's catalog, measured on 2026-09-09

Every number above this line is open-world naming. `ENUMERATOR_URL` has never been set in any
measurement this project has run, so `enumerateRegions` returned "no enumerator configured", the
census came back with no regions, and the `catalog:` line in `prompts.ts` never rendered. The
model was asked "what product on earth is this" and scored as though it had been asked "which of
the things this shop sells is this", which CLAUDE.md's closed-world section says is the wrong
question and sends tuning in the wrong direction.

The built retrieval leg matches picture against picture and wants a GPU and a Python environment
this machine no longer has. So the other leg was built: the reader answers in text, the catalog is
text, and text against text runs wherever the service runs. `server/src/catalog.ts` is the whole
of it, and `server/eval/corpus/clut/catalog.json` is a shop of 250 products, 48 of them in these
photographs and the rest siblings from the same brands' ranges, because a catalog holding only
the answers measures nothing.

It answers one of five things about a reading, and only the first two are evidence:

| | |
|---|---|
| `matched` | one entry fits, and clearly better than the next |
| `picked` | the text could not separate two, and the crop chose between them |
| `ambiguous` | two entries fit alike and the reading does not say which |
| `absent` | nothing this shop sells fits |
| `not-reached` | the two readings had already disagreed |

### Four arms over the fifteen photographs, basket tier

| | no catalog | catalog, shop listed in the prompt | catalog, retrieval only | and boxes, two passes |
|---|---|---|---|---|
| 1 every item reaches the bag | 31/37 84% | 33/37 89% | 34/37 **92%** | 60/74 81% |
| 2 quantities are right | 28/31 90% | 30/33 91% | 32/34 **94%** | 55/60 92% |
| &nbsp;&nbsp;brands right | 24/24 100% | 27/27 100% | 25/26 96% | 47/47 100% |
| 5 asserted lines wrong | 3/13 | 4/22 | **1/17** | **1/23** |
| lines matching nothing real | 2 | 2 | **0** | **0** |

Run with `clut-photos.ts` against the shipped service on Qwen 3 VL 235B through Parasail, then
re-scored together by `clut-rescore.ts`. The first three are one pass over fifteen photographs;
the fourth is two.

### Listing the shop in the wide prompt makes things worse

The second arm gives the census the shop's whole product list. It finds more, and it invents
differently. Two of clut7's lines came back as "Simply Nature organic chicken broth" and "Simply
Nature organic brown rice and quinoa fusilli", products of that shop which are not in that basket.
Named in the shop's own words they resolve against the catalog, the close read confirms them, and
they reach the shopper asserted. Without the list the same two inventions arrive as "Green
Packaging Snack" and "Nutrition Facts", and the catalog declines both.

A list is a menu. The gate's premise is that the two readings and the catalog are separate
witnesses, and a menu shown to all three at once is one witness wearing three hats. Retrieval
belongs where it is conditioned on one region's evidence, which is the shortlist each crop is
shown. `KART_PHOTO_STOCK_LIST=1` turns the arm back on and nothing else does.

### What the catalog catches, replayed over runs that predate it

Every line of a saved run is already labelled, so `catalog-replay.ts` asks what resolving each
line would have done, over 45 scans from three runs made before the catalog existed:

| | |
|---|---|
| lines the gate asserted | 100 |
| of those, wrong | 22 |
| wrong, and the catalog declines them | **18** |
| right, and the catalog declines them | 18 of 78 |

Asserted wrong falls from 22 to 4. All four are quantity errors, which the harness now classifies
rather than leaves to be read off a list: two readings agreeing that there is one box of Priano
rigatoni where there are two is a reading of a product this shop sells, and no text catalog can
see the difference. The cost is 18 of 78 right lines held back, each of which is a shopper asked
for a second photograph of something already correct.

The catalog is not a substitute for the close read. Replayed over the wide-only arms, where every
line is one reading with no second, it leaves 15 of 30 wrong lines still asserted, 11 of them on
the basket tier. Both witnesses are load-bearing.

### Two ways the catalog itself asserted something wrong, and what fixed them

Both were found by reading the lines a live run asserted, and both are now pinned in
`catalog.test.ts`.

A shortlist offered "Benton's chocolate chip cookies" for a box both readings had called Baker's
Corner. The close read copied it back and the line reached the shopper under a brand nothing had
read. A shortlist is for choosing a variety, not a brand, so an entry whose brand contradicts one
that was actually read is no longer offered. A brand nobody could read is not a contradiction and
those entries stay, because that is exactly what a crop is good at settling.

Then a shortlist offered "Friendly Farms cottage cheese", scoring 0.36, for a tub both readings
had called Friendly Farms neufchatel, and the close read took it. The shortlist floor is now the
same bar the text has to clear on its own: a crop may choose between entries the text would have
accepted, and may not be talked into one it rejected.

### Half the photographs came back with no boxes at all

A product with no box is never cut out, never read a second time, and so can only ever be shown
as unsure. Qwen declines to place boxes all or nothing, on between 39% and 55% of answers
depending on the run, and the same photograph gets boxes on one pass and none on the next.
Rewriting the box instruction moved it from 50% to 61%, which is inside the run to run spread.

Asking once more works: 111 of 128 products placed, 87%, against 50% on the arm before it. It
costs a census call on the photographs that need one, and it is skipped when a second call would
not fit inside the request's budget, because eight of thirty scans were lost to the timeout when
it was not.

### Why lines were held back, and three defects that were mine

Asking the catalog to decline more is not the way to a better bag. The question worth asking is
why a line that was *right* was still shown in amber, and the saved runs answer it without a
single call. Basket tier, 44 scans across four runs, 78 right lines held back:

| | |
|---|---|
| the census placed no box on it, so nothing read it twice | 36 |
| it was boxed, but the close read never came back | 13 |
| one of the two readings was under 0.6 | 12 |
| the close read said the crop held a different product | 6 |
| the catalog: absent, or the packaging was unreadable | 8 |
| the two readings counted differently | 1 |

Three of those are defects in this code, not in the model.

**The boxes were being read in the wrong format.** Across all 939 boxes in every saved run, 227
have x+w or y+h past the edge of the frame, and 177 of those are a perfectly good rectangle if w
and h are the far edges rather than a size. "x 65, w 100" is not a box covering the whole width
starting two thirds across; it is one whose right edge is the right edge. Read literally,
`cropToBox` clamps it and the close read is handed a crop with a median of **1.9 times** the
product's actual area, and in the worst case nine times it, full of the neighbours a second
reading exists to exclude. `censusFromPhoto` now re-reads a box as corners when, and only when,
the literal reading is impossible and the corner reading is not; a box that fits inside the frame
is never touched, because there is nothing to touch it on.

**One slow crop lost every close read in the request.** The verify request raced a single
deadline, so one crop that never came back took the other twelve with it: eleven right lines on
clut4 and clut5 went amber in one run for that reason alone. Each crop now races its own
deadline at 80% of the budget, and a crop that misses it leaves only its own line unsure, which
is what `reconcile` already does with a failed one.

**A photograph with no boxes was accepted.** Covered above: asking once more takes boxed products
from 50% to 87%.

None of the three changes what the model is asked or how a line is judged. They are the
difference between a second reading looking at the product and looking at half the basket.

### The final build, scored end to end on 2026-09-11

Commit `1893c9e`: the text catalog, the box repair, the box retry, per-crop deadlines, and a cap
on what one answer may write. The fifteen photographs, two passes, Qwen 3 VL 235B on Parasail,
`clut-photos.ts --repeat 2 --resume`, saved as `clut-photos-fixed.json`. 29 of 30 scans: clut12's
second pass timed out on all three attempts. $0.130 for the 29, $0.0045 and 4.7 calls a
photograph. Beside the two runs it is compared with, re-scored with `clut-rescore.ts`:

| basket tier | no catalog | catalog, before the box fixes | final build |
|---|---|---|---|
| scans | 7 | 14 | 14 |
| found | 31/37 (84%) | 60/74 (81%) | 53/74 (72%) |
| found, on scans that named anything | 31/37 (84%) | 60/68 (88%) | 53/58 (91%) |
| quantities right | 28/31 (90%) | 55/60 (92%) | 49/53 (92%) |
| brands right | 24/24 | 47/47 | 42/43 (98%) |
| hidden flagged | 1/5 | 2/10 | 4/10 |
| asserted wrong | 3/13 | 1/23 | 1/27 |
| right but held back | 18 | 33 | 22 |

What improved: more lines are asserted and no more of them are wrong. 27 lines were shown as
sure and one was wrong, and that one is a count (clut4, one rigatoni where there are two), which
no reading of the name can catch. A third fewer right lines were held back in amber, 22 against
33, which is the box repair and the per-crop deadlines doing what the replay said they would.

What fell: found, from 81% to 72%. All of it is one failure. On three of the fourteen basket
scans the model answered with an empty list (clut6 once, clut7 twice), taking 16 products with
them, against one scan and six products in the run before. Where it named anything at all it
found 91%, the best of the three. The empty answer is not new and is not caused by anything
here: across every saved run since Qwen became the photo tier, **26 of 127 scans** came back
empty, usually inside three seconds, and the same photograph is often read in full on the next
pass (clut7 was empty on 5 of 9, clut14 on all 8). This run drew more of them on the basket tier.

The storage tier is unchanged at 42/84 (50%), with 13 lines matching nothing labelled against 6.
Twelve of the fourteen such lines were shown as unsure. The two that were sure are both celery on
clut15 with the brand given as the string "Null".

Two things surfaced that the run was not designed to find. The first answer the cap cut off
began as a census and ended in thousands of characters of newlines; the second wrote 198
characters, reached `"box":`, and then wrote 5,809 characters of whitespace. The model stalls on
exactly the one field that may be an object or null, and pretty-prints everything else, which
costs it two to three times the tokens compact JSON would. The Mac also went to sleep on battery
with its lid shut partway through; two scans that spanned it were dropped and re-scanned, and the
driver now runs only with the lid open.

### Asking an empty answer again, and the census on one line, measured the same night

Commits `5b1fc08` and `0093567`: an answer naming no products is asked once more, the census is
asked for compact JSON on one line, a brand written as "null" is none, and a second asking that
runs out of time keeps the first answer. Same fifteen photographs, two passes, saved as
`clut-photos-retry.json`, 29 of 30 scans (clut12's second pass failed all three attempts),
$0.138. The first nine scans ran on `5b1fc08` before the deadline fix; none of them used a retry
that ran out of time, so the fix cannot change them.

The harness changed underneath this run too, and it matters for comparing seconds and failures.
Until `5caefa3` every photo harness gave the census the live scan's 20 seconds, where the phone
gives a photograph 30 (`src/app/photo.tsx`) and the server answers inside 25. Every earlier run
scored a photograph that took 20 to 25 seconds as a timeout the phone would not have had. Twenty
of this run's 29 scans had the phone's deadline.

| basket tier | first run tonight (`1893c9e`) | this run |
|---|---|---|
| found | 53/74 (72%) | 63/74 (85%) |
| empty answers | 3 of 14 scans | 0 of 14 |
| quantities right | 49/53 (92%) | 55/63 (87%) |
| brands right | 42/43 (98%) | 48/52 (92%) |
| hidden flagged | 4/10 | 4/10 |
| asserted wrong | 1/27 | 2/39 |
| right but held back | 22 | 18 |
| seconds a photograph | 13.0 | 16.1 |

The storage tier: found 42/84 (50%) to 54/84 (64%), hidden flagged 12/15 to 15/15, nothing
asserted wrong in 21 sure lines.

**What improved.** No scan came back empty, on either tier. In the 20 scans whose service log
survives, the retry for an empty answer never fired, so the first answer was never empty: clut14,
empty on all eight earlier Qwen scans, was read 5/5 and 4/5 at the first asking. The only change
that could do that is asking for the object on one line. (The log of the first nine scans was
overwritten when the service restarted.) Found rose thirteen points on the basket tier and fourteen
on the storage tier. clut12, which timed out on every attempt at 20 seconds, finished its first
pass in 15.5.

**What fell.** Quantities from 92% to 87% and brands from 98% to 92% on the basket tier. Half the
new count errors and both new brand errors are clut7, which was empty last run and so scored
nothing: on one pass the model gave every product in it the brand "Campbells" and a count of 2,
and the close read held four of those five lines back. The rest are the same as before: clut4's
rigatoni read as one where there are two, clut5's bronze cut read as two where there is one,
clut6's PRIANO read as "Palano" and "Paiano". The one wrong line asserted is that rigatoni,
now on both passes: both readings say one, so nothing in the gate can see it. Seconds went up by
three, which is the retries and the longer deadline letting slow photographs finish.

**What was measured wrong.** "Asserted wrong" used to sum every line a label was given, sure and
unsure together, and then call each sure line wrong when the total was. Printed that way this run
reads 4/39. Two of the four were a sure "2 x Campbell's cream of mushroom" for two tins, blamed
because an unsure line for a different product carrying the same borrowed brand ("pesto
(Campbells)", "chickpeas (Campbells)") was counted into its total. `clut-scoring.ts` now also
gives `assertedOutcomes`, which judges each sure line on the sure lines alone, and
`clut-rescore.ts` prints both. Every line the new verdict turned from wrong to right, across all
four runs it was applied to, was checked by hand: ten, all of the same shape, a right sure line
next to a wrong unsure one. Re-scored: no catalog 5/25 (was 6), catalog before the box fixes 0/29
(was 3), first run tonight 1/40 (3), this run 2/60 (6).

**What still fails.** Two loops the output cap caught this run, both a product repeated rather
than whitespace: clut12's "lactose free milk, Friendly Farms", which is what every clut12 failure
tonight has been, and clut9's "crackers, Savoritz". The products written before a loop starts
are a complete, usable answer that is currently thrown away.

### Stopping a loop where it starts, measured on the two photographs that loop

Commit `ff6a33f`: the photo census is streamed, and an answer is stopped at the third writing of
one product, at a run of whitespace, or at the request's deadline. Every product whose writing was
finished is kept once, the repeated one below the unsure line (`src/salvage.ts`). The cap fell
from 2,000 tokens to 1,200. It had assumed 80 tokens a second, and Parasail's median on 2026-09-11
was 29 (51 at the 90th percentile, OpenRouter's endpoint statistics), so a loop reached no cap
before the 25 second deadline failed the request.

The change alters a scan only when its answer is stopped, so only the two photographs that loop
were scanned again, two passes each, $0.0114 as billed by OpenRouter. `clut-photos-salvage.json`
is `clut-photos-retry.json` with those four scans replaced or added, and is labelled as that
mix. Basket tier: no photograph re-scanned, every number unchanged.

| scan | retry build | this build |
|---|---|---|
| clut12 pass 1 | 3/6 found, 15.5s, no loop | 1/6 found, 5.5s, stopped (loop) |
| clut12 pass 2 | failed, all three attempts | 1/6 found, 16.0s, stopped (loop) |
| clut9 pass 1 | 5/6 found, 16.9s | 5/6 found, 27.7s, no stop |
| clut9 pass 2 | 6/6 found, 24.0s (one failed attempt first) | 6/6 found, 9.4s, second asking stopped (stall) |

Storage tier over the merged file: found 54/84 (64%) became 53/90 (59%), because the scan that
failed is now scored. Counting that failure as the empty bag the shopper got, it is 54/90 before
and 53/90 after. Asserted wrong 0/21 became 1/22; hidden flagged 15/15 became 16/16.

**What worked.** No scan failed. Three of the four answers were stopped early and kept what came
before, and the stall on clut9's second asking was cut at 403 characters instead of running to the
deadline, which took that scan from 24.0 to 9.4 seconds.

**What did not.** On both clut12 passes the loop began at the first product: "lactose free milk,
Friendly Farms" three times inside 507 characters. There was nothing before it to keep, so the bag
got the milk, unsure and right, and none of the other five products. clut12 has looped on five of
the six attempts tonight whose service log survives, and the one that did not found 3/6.

**The wrong line asserted is not the salvage.** clut9's first pass read two boxes of sea salt
crackers where there is one sea salt and one rosemary sourdough, on the retry build too. There it
was unsure because that answer had placed no boxes; here the second asking placed them, the crop
held both boxes, and the close read counted the same two. It is the rigatoni miscount's shape:
both readings agree on a count and the gate has nothing to disagree with.

**Cost accounting.** A stopped stream sends no usage, so the service's token count misses those
calls. `clut-photos.ts` now also records what OpenRouter billed (`cost.billedUsd`, from the free
key endpoint). Whether Parasail stops generating when the stream is closed is not documented;
OpenRouter lists it as neither honouring nor ignoring cancellation, and the 1,200 cap bounds it.

## What the numbers do not cover

The basket tier's labels are complete, so both its recall and its count of lines matching nothing
real are meaningful. The storage tier's labels are **not exhaustive**: a pantry shelf holds dozens
of things, half of them behind other things, and `labels.json` lists only the ones a reader can
identify with confidence. Recall there is a lower bound and is meaningful. The count of lines
matching nothing real is **not** a hallucination count on that tier, because most such lines name
something really there that the file does not list.

Three labels were corrected on 2026-09-04 by going back to the photograph after a model answer
disagreed with one. `labels.json` records which.
