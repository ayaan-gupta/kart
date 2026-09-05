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

## What the numbers do not cover

The basket tier's labels are complete, so both its recall and its count of lines matching nothing
real are meaningful. The storage tier's labels are **not exhaustive**: a pantry shelf holds dozens
of things, half of them behind other things, and `labels.json` lists only the ones a reader can
identify with confidence. Recall there is a lower bound and is meaningful. The count of lines
matching nothing real is **not** a hallucination count on that tier, because most such lines name
something really there that the file does not list.

Three labels were corrected on 2026-09-04 by going back to the photograph after a model answer
disagreed with one. `labels.json` records which.
