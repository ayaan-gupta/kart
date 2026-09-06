# When there is credit again

`KART.md` is the record of what was measured and why. This is the short list of what is *pending* on
a working OpenAI account, in the order worth spending the first calls on. Everything here is blocked
on one thing only: `credit-probe.ts` returns `429 credit_balance_exhausted`.

Any endpoint implementing the **Responses API** works, not only the original account:

```bash
OPENAI_BASE_URL=https://your-endpoint/v1 server/.venv/bin/python server/eval/verify.py --model
```

Not a local model server — llama.cpp, vLLM, Ollama and mlx-vlm implement `/v1/chat/completions`, and
everything here goes through `openai.responses.create`. See `server/src/openai.ts`.

---

## 0. The three-pass measurement of the two-reading photo path, cut short on 2026-09-06

`clut-photos.ts --as-phone --repeat 3` on the final code got through eleven scans before the
account answered `429 credit_balance_exhausted`; passes two and three failed on every
photograph. `clut-photos-verify.json` is those eleven scans and says so in its summary. Run
it again first, before anything else on this list:

```bash
./scripts/serve.sh
node --env-file=server/.env.local server/node_modules/.bin/tsx \
  server/eval/pipeline/clut-photos.ts --as-phone --repeat 3 --out server/eval/clut-photos-verify.json
node server/node_modules/.bin/tsx server/eval/pipeline/clut-rescore.ts \
  server/eval/clut-photos-wide-compact.json server/eval/clut-photos-verify.json
```

**What would matter:** "asserted lines wrong" on the basket tier staying at zero across all
three passes (it was 0 of 31 on each of the two complete passes that exist), and the storage
tier's asserted-wrong lines being the two known classes only: a box read from its back panel,
and a second unit hidden behind the first. Then replace the table in CLUT.md, "Read wide, then
read close", with the three-pass numbers. The Luna arm of the close reader is worth a second
pass too, for the cost column, once the Sol number is settled.

## 3. The proposal filter — demoted, and probably not worth a census pass

`MIN_CATALOG_CONFIDENCE` in `server/src/enumerate.ts` is **0**, which is off. Set it to **0.6** and:

```bash
server/.venv/bin/python server/eval/verify.py --model
```

**Read the hundred-and-fifth section of `KART.md` before spending a call on this.** It cut invented
lines from 13 to 10 across two local census models, and then scoring what it drops against the
hand-labelled boxes showed **five proposals dropped, five covering a real product, none covering
nothing**. It does not remove junk; it removes real products the census tends to misname, and the
spurious lines fall because a badge never asked about cannot be misnamed.

Three of the five are `out_of_catalog`, so against a real store's catalog they would score above 0.60
and never be dropped — the change would be inert in the deployment this project assumes. That is why
it moved from first in this list to last.

**Ship it if** products found does not fall and lines-matching-nothing does. **Do not ship it if**
the four sparse trolleys stop being exact — they are the corpus's only clean cases, and a change
that dirties them is not worth the loaded trolleys it helps.

**And look at what it drops, not only at the totals.** `render_filter.py` draws it: on IMG_0254 the
four proposals removed are the second egg carton, the jar, the salmon and the asparagus — all real
products. The totals only improve because the unmarked sweep volunteers most of them back, and that
sweep is the least reliable channel in this pipeline. Three of the four are `out_of_catalog`, which
would not be true against a real store's catalog, so this is an argument for the filter being safer
in deployment than it looks here — not for trusting the corpus figure.

A test in `server/test/enumerate.test.ts` asserts the constant is zero. Raising it fails that test
first, on purpose: update the test in the same commit as the measurement, never before it.

## 1. Take requirement 3 for the first time — never measured at all

`census-live.ts` now prints each photograph's `occlusion` verdict and a per-photograph flagged count.
No shipped-model figure exists for it — the local 7B managed 5 of 6.

```bash
node --env-file=server/.env.local server/node_modules/.bin/tsx \
  server/eval/pipeline/census-live.ts --repeat=3
```

Read the `occlusion flagged N/3` lines. **What would matter:** IMG_0254 flagged on every pass and
the four sparse photographs on none. If IMG_0254 is *not* flagged, part of what `KART.md` counts as
recognition failure is a reporting failure, and the fix is in the prompt rather than the detector.

## 2. Ask the shipped model the one question whose input did not exist before

Every other refusal in `KART.md` re-ran a question the corpus had already answered. This one has not
been asked: the augmented region set puts a box on IMG_0254's yellow produce bag, and the shipped
census has never been shown it.

```bash
server/.venv/bin/python server/eval/augment_regions.py
node --env-file=server/.env.local server/node_modules/.bin/tsx \
  server/eval/pipeline/census-live.ts --frames=frames-augment15.json --repeat=3
```

**Set expectations from the picture, not the description.** Rendering what the augmentation adds
shows both new boxes are multi-product: one covers the Muenster pack *and* an egg carton, and the
one on the yellow bag also holds the purple bag and part of the baguette. An earlier draft of this
file called it "a clean crop". It is not, and the ninetieth already recorded that correction — the
box reaches the yellow bag, it does not isolate it.

So the likely outcome is the local 7B's: `purple cabbage`, because a crop containing a prominent
purple bag reasonably reads as one. If that is what the shipped model says, the item is closed on
the best evidence available. If it says anything matching "yellow" or "produce bag" despite the
purple, that is a real result and the corpus's most stubborn item is solved on the stills.

Either way it costs one census pass, which is why it is third rather than first.

## 4. Re-baseline

The photograph figures in `KART.md` predate the label correction in the ninetieth and the shelf
entries added in the seventy-third. `verify.py --model` re-measures both. Expect "photographs exact"
to be out of 10 per pass now rather than 6; products found is unaffected at 31.

---

## Not blocked on credit

- **The blur gate.** `MIN_KEYFRAME_SHARPNESS` is 12, set against a whole-frame measure, while the
  device reports the largest of a 3x3 tile grid and runs several times higher. On a phone it rejects
  nothing. A Debug build prints `[kart] device sharpness` every thirty frames; one reading from a
  real camera over a real trolley is the whole measurement.
- **The notice copy.** `COACH_COPY.unavailable` in `src/components/CoachNotice.tsx` is mine, not the
  product owner's, and is flagged as needing their wording. The file's other two strings carry "Do
  not reword these without asking".
- **The API key.** Rotation was deferred with "forget the openai key until everything is completely
  built". A key pasted into a chat transcript should be treated as exposed. Still outstanding.
