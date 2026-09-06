# Research notes

Written on 2026-09-06, when the owner asked whether a fine-tuned open-weight Qwen would do
better than GPT for reading a photographed cart, and what the literature and open source offer
towards zero mistakes. Each report was written by an agent from primary sources, with every
number cited; read the sources before acting on a number.

| report | question | one-line answer |
|---|---|---|
| [Qwen fine-tuning](2026-09-06-qwen-finetune.md) | Should we fine-tune Qwen instead of, or beside, gpt-5.6-sol? | Not yet. Zero-shot Qwen3.5-27B leads GPT-5 on OCR benchmarks and costs a tenth as much hosted, and the hotel story has a published analogue (Hospitality-VQA, LoRA on 5,000 photos, 78.7 to 92.0), but no fine-tune recovers items with no visible pixels, a private GPU costs $785 to $2,500 a month, and OpenAI's own fine-tuning is closing. The decisive experiment is a one-day, under $1 zero-shot run of Qwen3.5-27B through the existing harness. |
| [Recognition literature](2026-09-06-recognition-literature.md) | What raises one-photograph recognition from 90% towards 100%? | Five things, ranked: a catalog retrieval head with the VLM choosing among candidates (brands from 92% towards 97 to 98%); crop-and-re-ask at native resolution (built the same day, see `server/eval/CLUT.md`); a promptable detector for counts; agreement between readings as the confidence signal instead of the model's own number (built the same day); a second photograph for flagged regions merged in code (built the same day). Items hidden in a pile are provably uncountable from one view. |

What was built from them is in `docs/superpowers/specs/2026-09-06-photo-verification-design.md`
and measured in `server/eval/CLUT.md`, "Read wide, then read close". What was not built, and
why, is in the final section of each report.
