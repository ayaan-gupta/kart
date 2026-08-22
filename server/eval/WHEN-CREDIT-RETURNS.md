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

## 1. Validate the proposal filter — the only pending change that improves the bag

`MIN_CATALOG_CONFIDENCE` in `server/src/enumerate.ts` is **0**, which is off. Set it to **0.6** and:

```bash
server/.venv/bin/python server/eval/verify.py --model
```

Measured through two local census models, it cut invented lines from 13 to 10 and lifted exact
photographs from 4 of 6 to 5. It is near-inert on the video, so the scan path carries little risk
either way.

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

## 2. Take requirement 3 for the first time

`census-live.ts` now prints each photograph's `occlusion` verdict and a per-photograph flagged count.
No shipped-model figure exists for it — the local 7B managed 5 of 6.

```bash
node --env-file=server/.env.local server/node_modules/.bin/tsx \
  server/eval/pipeline/census-live.ts --repeat=3
```

Read the `occlusion flagged N/3` lines. **What would matter:** IMG_0254 flagged on every pass and
the four sparse photographs on none. If IMG_0254 is *not* flagged, part of what `KART.md` counts as
recognition failure is a reporting failure, and the fix is in the prompt rather than the detector.

## 3. Ask the shipped model the one question whose input did not exist before

Every other refusal in `KART.md` re-ran a question the corpus had already answered. This one has not
been asked: the augmented region set puts a box on IMG_0254's yellow produce bag, and the shipped
census has never been shown it.

```bash
server/.venv/bin/python server/eval/augment_regions.py
node --env-file=server/.env.local server/node_modules/.bin/tsx \
  server/eval/pipeline/census-live.ts --frames=frames-augment15.json --repeat=3
```

Both outcomes are worth having. Named as anything matching "yellow" or "produce bag", the corpus's
most stubborn item is solved on the stills. Named `purple cabbage` — which is what the local 7B says
— it is closed on the strongest evidence available: a clean crop, the shipped model, still wrong.

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
