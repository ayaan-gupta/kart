# Should we fine-tune an open Qwen VLM instead of (or beside) gpt-5.6-sol?

Research memo, 2026-09-06. Sources are numbered [S#] and listed at the end. Numbers reported by a model vendor about its own model are marked "vendor".

## Summary

- Open Qwen vision models are Apache 2.0, ground natively, and now beat GPT-5-class models on OCR and match or beat them on counting. Qwen3.5-27B (Feb 2026): OCRBench 89.4, CountBench 97.8, RealWorldQA 83.7 vs GPT-5-mini 82.1, 91.0, 79.0 [S5]. Independent OCRBench v2 (June 2026): Qwen3.6-35B-A3B 65.5 vs GPT-5 55.5 [S14]. No OCR or counting benchmark for gpt-5.6 itself was found.
- The hotel story has a published analogue: Hospitality-VQA (5,000 hotel photos, LoRA on one RTX 4090) lifted Qwen2.5-VL-7B from 78.7 to 92.0 and past GPT-5 zero-shot on most sub-tasks [S22].
- Fine-tuning plausibly fixes the PRIANO-type logo misread, per-store SKU naming, counting conventions and JSON discipline. It cannot recover items with no visible pixels; every model collapses on dense or occluded counting [S15][S16][S17].
- OpenAI is closing fine-tuning (new orgs blocked 7 May 2026, everyone cut off 6 Jan 2027) and gpt-5.6-sol is listed as not fine-tunable [S26][S27].
- Hosted zero-shot Qwen costs about $0.001 to $0.002 per 2048px photo versus $0.017 today. A 24/7 GPU for a private LoRA costs $785 to $2,500 a month, break-even 46k to 150k photos a month [S31][S33][S36].
- Smallest decisive experiment: run Qwen3.5-27B and Qwen3-VL-235B zero-shot through the existing 15-photo harness (under $1, one day). Only if they land within a few points of sol, label 300 to 500 cart photos and LoRA an 8B to 9B model (about $50 compute, 2 to 3 weeks; labelling is the real cost).

## 1. Which Qwen vision models exist

| Family | Open sizes | Licence | Released | Notes |
|---|---|---|---|---|
| Qwen2.5-VL | 3B, 7B, 32B, 72B | Apache 2.0 for 3B/7B; 72B under the Qwen licence [S6][S7] | Jan 2025 | 28 px per token; boxes in absolute pixels of the resized image |
| Qwen3-VL | 2B, 4B, 8B, 32B dense; 30B-A3B, 235B-A22B MoE; Instruct and Thinking | Apache 2.0 [S1] | 23 Sep to 21 Oct 2025 [S1] | 32 px per token; 256K context; OCR in 39 languages [S2] |
| Qwen3.5 | 0.8B, 2B, 4B, 9B, 27B, 35B-A3B, 122B-A10B, 397B-A17B; natively multimodal (early fusion) | Apache 2.0 [S4] | 16 Feb to 2 Mar 2026 [S4] | 262K context |
| Qwen3.6 | 27B, 35B-A3B, multimodal | Apache 2.0 [S8] | Apr 2026 | |
| Qwen3.8 | 27B dense, multimodal; the 2.4T-A95B checkpoint is text-only under a custom licence | Apache 2.0 (27B) [S9][S10] | 14 Aug 2026 | Qwen3.7 has no open weights [S10] |

Grounding. Qwen3-VL emits JSON such as `[{"bbox_2d":[x1,y1,x2,y2],"label":"..."}]`. The report states: "Different from Qwen2.5-VL, we adopt a normalized coordinate system scaled to the range [0, 1000]" [S2]; divide by 1000 and multiply by width or height. Qwen2.5-VL used absolute pixels on its 28-px resized grid [S2]. Qwen3.5 and 3.6 report RefCOCO and ODinW, so they ground [S5][S8]; I found no primary statement of their convention.

Image tokens. Qwen3-VL uses 16 px patches merged 2x2, so 32x32 px per token [S3]; default `longest_edge` is 16,777,216 px [S11], so a 2048x1536 photo is not downscaled and costs 64x48 = 3,072 visual tokens.

Qwen3-VL report Tables 2 to 4 (vendor; GPT-5 at "high" reasoning, "minimal" in brackets) [S2], plus the Qwen3.5-27B card [S5]:

| Benchmark | Qwen3-VL-8B-Instruct | Qwen3-VL-32B-Instruct | Qwen3-VL-235B-Instruct | GPT-5 high (minimal) | GPT-5-mini | GPT-5-nano | Qwen3.5-27B |
|---|---|---|---|---|---|---|---|
| OCRBench (/1000) | 896 | 895 | 920 | 810 (787) | 821 | 753 | 894 |
| OCRBench v2 en | 65.4 | 67.4 | 67.1 | 53.0 (48.2) | 52.6 | 48.1 | n/a |
| DocVQA | 96.1 | 96.9 | 97.1 | 91.5 (89.6) | 90.5 | 88.2 | n/a |
| CountBench | 80.5 (Thinking 91.5) | 94.9 | 93.0 | 91.7 (87.8) | 91.0 | 80.0 | 97.8 |
| RealWorldQA | 71.5 | 79.0 | 79.2 | 82.8 (77.3) | 79.0 | 71.8 | 83.7 |
| RefCOCO avg | 89.1 | 91.9 | 91.9 | 66.8 | none | none | 90.9 |
| ODinW-13 mAP | 44.7 | 46.6 | 48.6 | none | none | none | 41.1 |

Independent: OCRBench v2 (June 2026), English average GPT-5 55.5, Gemini 3 Pro 63.4, Qwen3.6-35B-A3B 65.5; text-recognition sub-score GPT-5 69.3 vs Qwen3.6-35B-A3B 74.9 [S14]. HoloCount (July 2026): GPT-5.5 67.6, Qwen3.5-27B 75.9, Qwen3-VL-32B 62.7, Qwen3-VL-8B 58.1 [S15].

## 2. How people fine-tune them

Method. LoRA (rank 8 to 32, vision tower usually frozen) is the default; full fine-tuning needs about 4x the VRAM [S21]. Unsloth trains Qwen3-VL 1.7x faster with 60% less VRAM and has free Colab notebooks for Qwen3-VL-8B [S20]; its Qwen3.5 guide lists bf16 LoRA VRAM of 22 GB for 9B and 56 GB for 27B, and QLoRA is not recommended for Qwen3.5 [S21]. ms-swift's Qwen3-VL-4B LoRA demo (rank 8, ViT frozen) ran on 2x21 GiB in 12 minutes; full-parameter 30B-A3B needs 8x80 GB [S19]. DataCamp's Qwen3-VL-8B LoRA (r=16) used 40 to 45 GB of an A100 for 800 examples, one epoch [S23].

Frameworks. LLaMA-Factory: ShareGPT JSON with an `images` list and `<image>` placeholder [S24]. ms-swift: messages plus an `objects` block with absolute boxes, auto-normalised [S19]. TRL: Hugging Face cookbook [S25]. Axolotl: multimodal beta, Qwen2.5-VL and Qwen3-VL added Oct 2025 [S30]. Hosted: Fireworks tunes Qwen2.5-VL-7B, Qwen3-VL-8B, Qwen3-VL-30B-A3B and Qwen3.5-VL-30B-A3B (LoRA rank up to 32, base64 images) [S28]; Together tunes Qwen3.5 0.8B to 27B and Qwen3.6-27B with images [S29].

Reported data sizes and lifts:

- Hospitality-VQA: 5,000 hotel images, 19,729 QA pairs, LoRA r=16, 2 epochs, one RTX 4090. Qwen2.5-VL-7B: main task 78.7 to 92.0, main+sub 64.2 to 85.4, room classification 25.8 to 87.1; GPT-5 zero-shot 92.3, 82.6, 83.9. The 3B model went 64.7 to 86.7 [S22]. This corroborates the hotel anecdote.
- Grab, GPT-4o vision fine-tuning: 100 examples, lane-count accuracy +20%, sign localisation 67% to 80%. Automat: 200 images, +7% F1 [S40].
- E-commerce item intelligence (Gemma3-27B, 100k items, about 5 images each): F1 44.8 to 52.6; a 4B model with cleaner labels reached 53.8 [S41].
- Labellerr, Qwen2.5-VL-7B on 1,000 LVIS samples: JSON compliance 25% to 90%; they estimate 4 to 12 hours for 10K images with LoRA on a 24 GB GPU [S42].
- Retail VLM fine-tunes with before/after numbers: none found. GroceryVision (ICCV 2025 RetailVision) evaluated 190 frozen encoders: best SigLIP2 Recall@1 77.0%, Recall@5 94.5%; within-category SKU ranking is the remaining failure and fine-tuning is future work [S43]. The 7-Eleven planogram system uses classic classifiers, 98.4% top-1 on unseen products from five samples per class [S44].

Cost of a run. A cart example is about 3,500 tokens. 1,000 examples x 3 epochs is about 10M tokens: $5 on Together ($0.48/M LoRA up to 16B, $1.50/M for 17B to 69B) [S29][S33] or Fireworks ($0.50/M up to 16B) [S34]; one to three hours on a $1.59/h A100 [S31].

## 3. Serving

Memory. Qwen3-VL-8B uses about 18 GB VRAM in bf16 [S12] and fits a 24 GB card; 32B needs an 80 GB card or FP8; 235B-A22B needs 8x80 GB [S13]; Qwen3.5-27B is about 56 GB [S21].

Latency. No published vLLM or SGLang figure for Qwen3-VL on a 2048px image with a JSON schema was found. Closest measurement: vLLM on an A100-40GB, Qwen2.5-VL-7B, image prompts: TTFT 130 ms, 15.5 ms per output token, 13.2 requests/s at saturation [S35]. Derived estimate, not a measurement: 3,072 image tokens plus 300 output tokens is about 0.3 s prefill plus 4.6 s decode, roughly 5 s single-stream on an A100 and 2 to 3 s on an H100 for 8B; 32B about double. Naive Hugging Face generation at 2,000 to 5,000 px with 6,500 max tokens took 5 to 7 minutes per image on an A100 [S12], so resolution caps and vLLM are mandatory. vLLM and SGLang both do JSON-schema decoding via xgrammar [S37][S38].

GPU prices per hour. RunPod on-demand: L40S $1.09, A100 80GB $1.59, H100 SXM $3.49, H200 $4.59; serverless H100 $4.79 active [S31]. Lambda: H100 PCIe $3.29, A100 40GB $1.99 [S32]. Modal per-second: H100 $3.95, A100 80GB $2.50, L40S $1.95 [S36]. Together dedicated H100 $3.99 [S33]. Fireworks on-demand H100 $8.00 from 1 Sep 2026 [S34].

Hosted per-token. DeepInfra Qwen3-VL-235B-A22B $0.20 in, $0.88 out [S39]; Alibaba Cloud via OpenRouter Qwen3-VL-32B $0.104 in, $0.416 out [S45]; Together Qwen3-VL-32B $0.50 in, $1.50 out [S46]; Fireworks lists Qwen3-VL-30B-A3B as "serverless: not supported" [S47]. Per 2048px photo (3,072 image + 400 text tokens in, 400 out): DeepInfra 235B about $0.001, Alibaba 32B about $0.0005, Together 32B about $0.0023, against $0.017 for sol today at $4 per 1M input tokens [S63].

Custom LoRA hosting. Fireworks: VLM fine-tunes deploy to on-demand GPUs only [S28]. Together: dedicated endpoints; serverless LoRA is discontinued [S29]. DeepInfra: nothing found. Practical path: merge the adapter and serve with vLLM on Modal or RunPod serverless (scale to zero; cold start of a 16 GB checkpoint is tens of seconds, not measured here) or a fixed pod. 24/7 costs: L40S $785, A100 $1,145, H100 $2,513 per month; break-even against $0.017 is about 46k, 67k and 148k photos a month. Serverless at 5 s active on a Modal H100 is about $0.0055 per photo plus cold starts.

## 4. Honest expectations

OCR of small brand text. Qwen leads GPT-5 on every OCR benchmark found, vendor and independent [S2][S14]. But OCRBench is documents and scene text, not stylised logos on curved packaging. PRIANO is a logo-vocabulary problem: a model that has seen the brand reads it, which is exactly what fine-tuning (or catalog retrieval) supplies.

Counting. CountBench is saturated (everyone above 90 except small Instruct models; Qwen3-VL-8B-Instruct 80.5, its Thinking variant 91.5 [S2]). HoloCount is the real picture: on its dense subset Qwen3.5-27B drops to 20%, most open models below 10%, and all models undercount occluded objects [S15]. GPT-5.5 passed 30% of Roboflow's dense counting prompts at 17.45 s average latency [S18]. Qwen was trained with box-based and point-based counting [S2], so one box per instance, then counting boxes, is a cheap lever to test.

What fine-tuning realistically fixes: brand and logo vocabulary for one store's catalog; exact catalog IDs instead of free text; house counting conventions (multipack equals 1, loose produce per piece, stacked cans); calibration of "hidden" and "unsure" flags to your label distribution; schema discipline [S22][S42][S40].

What it does not fix: items with no visible pixels (state-of-the-art counters fail under occlusion and need amodal reconstruction [S16]); catalog churn, which needs retraining or a retrieval step; blur and glare. Fine-tunes also overfit to the labelling store and camera, so hold out other stores.

## 5. Data

| Dataset | Size | Scene | Licence |
|---|---|---|---|
| SKU-110K (2019) | 11,743 images, 1.7M boxes [S48] | dense shelves, no SKU identity | academic, non-commercial [S49] |
| RPC (2019) | 53,739 single-product + 30,000 checkout images, 200 SKUs, up to 17 items per image | top-down items on a checkout table, three clutter levels | CC BY-NC-SA 4.0 [S50] |
| RP2K (2020) | 500k+ shelf crops, 2,000 products | shelf crops in stores | "publicly available"; no licence text found, site 404 [S51] |
| Grocery Store Dataset, Klasson (2019) | 5,125 phone photos, 81 classes | items in stores | MIT [S52] |
| Products-10K (2020) | 10k SKUs, JD.com | studio product shots | non-commercial research, per challenge page [S53] |
| AliProducts (2020) | about 3M images, 50k SKUs | e-commerce | Tianchi competition terms; no standalone licence found [S54] |
| Freiburg Groceries (2016) | 5,000 images at 256 px, 25 classes | in store | no licence file in repo [S55] |
| GroZi-120 (2007) | 120 products, web vs store-video images | shelves | site unreachable, terms unknown [S56] |
| Unitail (2022) | 1.8M boxes, 1,454 categories, 30k text regions | shelves | academic only, access on request [S57] |
| MVTec D2S (2018) | 21,000 images, 60 classes | checkout-like tabletop, clutter | CC BY-NC-SA 4.0 [S58] |
| Holoselecta (2019) | 295 images, 109 classes, 10,035 boxes | vending machines | CC BY 4.0 [S59] |
| Retail-786k (2023) | 786k images, 3,298 entities | leaflet scans | CC BY-NC-ND 4.0 [S60] |
| GroceryVision MPR (ICCV 2025) | 74,200 train images, 409 SKUs | front-facing product views | CC BY-NC 4.0 [S43] |
| NEU-171K (2025) | 171k images; RP subset 53,842 at 3024x4032 | lab, warehouse-style | not stated [S61] |
| Roboflow Universe cart sets | e.g. 307 images | carts | per set, check each [S62] |

None shows a loaded consumer cart photographed by the shopper; RPC and D2S are closest (cluttered multi-item checkout scenes, fixed camera). Nearly all are non-commercial, so they can seed a feasibility experiment but not a shipped per-store model. Production training data has to be your own cart photos plus the store's catalog images, with provenance in the manifest as the repo requires.

## 6. Recommended plan

Step 0, one day, under $1. Run Qwen3.5-27B and Qwen3-VL-235B-A22B-Instruct zero-shot (Alibaba, DeepInfra or OpenRouter) with the existing JSON schema against the committed 15-photo, 82-product, 3-pass harness. Report all four metrics next to sol's 90/88/92, and try the box-per-instance counting prompt. Within about 3 points of sol: proceed. Ten points behind: stop and keep sol.

Step 1, two weeks. Photograph 300 to 500 loaded carts in one store; label catalog ID, count, hidden and unsure per item; hold out 100 photos from different days. At 4 minutes per photo that is 20 to 35 hours; sol drafts plus human correction roughly halves it.

Step 2, one to two days, about $50. LoRA r=16 on Qwen3-VL-8B-Instruct or Qwen3.5-9B with Unsloth or ms-swift, ViT frozen, 2 to 3 epochs, on a RunPod A100 (1 to 3 hours) [S31] or Together hosted ($5) [S33]. Put the catalog list in the prompt (closed world) and ablate without it; run 32B zero-shot as a control.

Step 3. Score the held-out 100 with the harness, 3 passes, under a pre-registered rule: adopt only if items-found and quantities both improve and neither brand accuracy nor hidden and unsure flagging regresses.

Budget: about $50 compute, $0 to $1,500 labelling, three weeks elapsed.

The case against. Per-store fine-tunes multiply operations: catalogs change weekly, so SKU identity belongs in a retrieval and rerank step (the SigLIP head already in the repo; GroceryVision shows 94.5% Recall@5 frozen [S43]), with fine-tuning reserved for reading and counting behaviour, not memorising SKUs. A private model 24/7 costs $785 to $2,500 a month against $0.017 per call, and serverless cold starts hurt a shopper in a queue. The sol baseline is already 90/88/92 and the residual errors are dominated by occlusion, a UX loop (ask the shopper to move items), not a model. The OpenAI alternative does not exist: vision fine-tuning was only offered on gpt-4o-2024-08-06 [S27], the platform blocked new organisations on 7 May 2026 and ends all job creation on 6 Jan 2027 [S26], and the gpt-5.6-sol page states fine-tuning is not supported [S27]. A cheaper middle path: hosted zero-shot Qwen at about $0.001 per photo as a second reader that must agree with sol before an item is asserted, which serves metric 4 (unsure flags) directly.

## Sources

- [S1] https://github.com/QwenLM/Qwen3-VL
- [S2] https://arxiv.org/abs/2511.21631 (Qwen3-VL report, Tables 2 to 4)
- [S3] https://huggingface.co/docs/transformers/model_doc/qwen3_vl
- [S4] https://github.com/QwenLM/Qwen3.5
- [S5] https://huggingface.co/Qwen/Qwen3.5-27B
- [S6] https://huggingface.co/Qwen/Qwen2.5-VL-72B-Instruct
- [S7] https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct
- [S8] https://huggingface.co/Qwen/Qwen3.6-27B
- [S9] https://huggingface.co/Qwen/Qwen3.8-27B
- [S10] https://huggingface.co/Qwen/Qwen3.8-2.4T-A95B/discussions/13
- [S11] https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct/blob/main/preprocessor_config.json
- [S12] https://github.com/QwenLM/Qwen3-VL/issues/1923
- [S13] https://docs.vllm.ai/projects/recipes/en/stable/Qwen/Qwen3-VL.html
- [S14] https://99franklin.github.io/ocrbench_v2/
- [S15] https://arxiv.org/html/2607.06420v1 (HoloCount)
- [S16] https://arxiv.org/abs/2511.12702
- [S17] https://arxiv.org/abs/2605.30170
- [S18] https://blog.roboflow.com/gpt-5-5-vision-benchmarks-use-cases/
- [S19] https://swift.readthedocs.io/en/latest/BestPractices/Qwen3-VL-Best-Practice.html
- [S20] https://unsloth.ai/docs/models/tutorials/qwen3-how-to-run-and-fine-tune/qwen3-vl-how-to-run-and-fine-tune
- [S21] https://unsloth.ai/docs/models/qwen3.5/fine-tune
- [S22] https://arxiv.org/html/2603.07868 (Hospitality-VQA)
- [S23] https://www.datacamp.com/tutorial/fine-tuning-qwen3-vl-8b
- [S24] https://github.com/hiyouga/LlamaFactory/blob/main/data/README.md
- [S25] https://huggingface.co/learn/cookbook/en/fine_tuning_vlm_trl
- [S26] https://developers.openai.com/api/docs/deprecations
- [S27] https://developers.openai.com/api/docs/models/gpt-5.6-sol and https://developers.openai.com/api/docs/guides/vision-fine-tuning
- [S28] https://docs.fireworks.ai/fine-tuning/models and https://docs.fireworks.ai/fine-tuning/fine-tuning-models
- [S29] https://docs.together.ai/docs/fine-tuning/lora-vs-full
- [S30] https://docs.axolotl.ai/docs/multimodal.html
- [S31] https://www.runpod.io/pricing
- [S32] https://lambda.ai/pricing
- [S33] https://www.together.ai/pricing
- [S34] https://fireworks.ai/pricing
- [S35] https://github.com/vllm-project/vllm/issues/24728
- [S36] https://modal.com/pricing
- [S37] https://docs.vllm.ai/en/latest/features/structured_outputs/
- [S38] https://docs.sglang.io/docs/advanced_features/structured_outputs
- [S39] https://openrouter.ai/qwen/qwen3-vl-235b-a22b-instruct
- [S40] https://openai.com/index/introducing-vision-to-the-fine-tuning-api/ and https://openai.com/index/grab/
- [S41] https://arxiv.org/html/2602.11733v1
- [S42] https://www.labellerr.com/blog/fine-tune-qwen-2-5-vl/
- [S43] https://arxiv.org/html/2605.18029
- [S44] https://www.nature.com/articles/s41598-025-27773-5
- [S45] https://openrouter.ai/qwen/qwen3-vl-32b-instruct
- [S46] https://www.together.ai/models/qwen3-vl-32b-instruct
- [S47] https://fireworks.ai/models/fireworks/qwen3-vl-30b-a3b-instruct
- [S48] https://docs.ultralytics.com/datasets/detect/sku-110k
- [S49] https://github.com/eg4000/SKU110K_CVPR19
- [S50] https://github.com/RPC-Dataset/RPC-Dataset.github.io/blob/master/index.html
- [S51] https://arxiv.org/abs/2006.12634
- [S52] https://github.com/marcusklasson/GroceryStoreDataset
- [S53] https://products-10k.github.io/challenge.html
- [S54] https://tianchi.aliyun.com/competition/entrance/231780/introduction?lang=en-us
- [S55] https://github.com/PhilJd/freiburg_groceries_dataset
- [S56] http://grozi.calit2.net/grozi.html
- [S57] https://unitedretail.github.io/
- [S58] https://www.mvtec.com/company/research/datasets/mvtec-d2s
- [S59] https://github.com/tobiagru/ObjectDetectionGroceryProducts
- [S60] https://www.retail-786k.org/
- [S61] https://arxiv.org/abs/2503.14862
- [S62] https://universe.roboflow.com/furkan-bakkal/shopping-cart-1r48s
- [S63] https://developers.openai.com/api/docs/pricing (gpt-5.6-sol: $4 in, $0.40 cached, $20 out per 1M tokens)
