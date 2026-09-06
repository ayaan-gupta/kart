# Recognising every product in one cart photograph: literature and industry survey (2026-09-06)

## Summary

The shipped pipeline (one gpt-5.6-sol call, strict JSON, 2048px JPEG) scores 90% items found, 88% quantities, 92% brands on 15 kitchen photographs. The literature says the four remaining error classes have four different fixes, and none of them is "a better prompt".

1. Brand and SKU errors are a retrieval problem, not a reading problem. Zero-shot SigLIP 2 already puts the right SKU in the top 5 for 94.5% of grocery crops but ranks it first only 77% of the time [1]; a fine-tuned DINOv3 lifts catalog-to-real top-1 from 53.8% to 80.7% (top-5 94.7%) [2]. The best published hybrids let an embedding shortlist and a VLM or local-feature matcher resolve near-identical variants [1][3][4].
2. Counting is where VLMs are weakest and promptable detectors strongest. SAM 3 (Nov 2025) counts with text prompts at 95.6% on CountBench [5], while GPT-4o falls from 0.44 to 0.23 accuracy once three object types share a scene [6]. Items hidden inside a pile cannot be counted from one photograph by anyone: humans average MAE 823 on stacked piles [7].
3. Boxes from GPT-5-class models are unreliable (GPT-5: 0.9% mean IoU on document grounding [8]); Gemini 3 and Qwen3-VL emit boxes natively and reach YOLOv4-level COCO mAP (0.41 to 0.45) [9][10], still below a specialist detector.
4. Verbalized confidence is not honest: GPT-4o reports 99.5% mean confidence at 76% accuracy (AUROC 0.52) [11]; agreement across 4 to 5 calls raises AUROC to 0.75 to 0.78 [11]. Logprobs are not available for gpt-5.x reasoning models with structured outputs [12][13].

Every deployed cart product (Amazon, Instacart Caper, Zippin, Veeve, Trigo) fuses cameras with weight, and every one falls back to a human or to "try again" when confidence is low [14][15][16][17][18].

## 1. Closed-world product identification

**Zero-shot encoders on a real catalog.** The most complete comparison is May 2026: 190 OpenCLIP checkpoints on the GroceryVision MPR set (409 SKUs, cart-mounted GoPro imagery, CC BY-NC 4.0). Recall@1 / Recall@5: SigLIP2 ViT-gopt-16-384 0.770 / 0.945, PE-Core-L-14 0.758 / 0.937, SigLIP2 SO400M 0.749, MobileCLIP-B 0.653 (150M parameters, phone-sized), OpenAI ViT-L-14 0.568. The authors call the 17.5-point gap between R@5 and R@1 the "discriminative gap": embeddings cluster categories but cannot rank near-identical SKUs, and they recommend a frozen retriever plus a lightweight reranker over the top-K [1].

**Fine-tuning closes most of the gap.** Cat2Real (Jul 2026) trains DINOv3 ViT-L/16 with multi-stage contrastive learning on 196K real photos of 26,910 products against 410K catalog images; on 5,043 held-out real images (2,155 candidate products) top-1 rises from 53.83% to 80.73% and top-5 from 78.12% to 94.70%; Gemini-Embedding-2 scores 68.71 / 89.34. Weights are Apache 2.0 [2]. On RP2K (2,000 SKUs, real shelf photos) a fine-tuned production model reports 89% top-1 versus 41% for base CLIP [19]. A 2025 benchmark across RP2K, Products-10K, SOP and others finds SigLIP the best off-the-shelf encoder on five of six datasets (Apple CLIP wins RP2K), and that top-tuning text-image encoders raises mean mMP@5 from 0.803 to 0.842, close to full fine-tuning of supervised backbones [20].

**Cart viewpoints are hard.** PRISM (Sep 2025) is the only paper on the shopping-cart setting: on the ABV cart dataset SigLIP alone reaches top-1 0.386 / top-5 0.527, CLIP 0.170; adding YOLO-E background removal and LightGlue keypoint re-ranking (count RANSAC inliers between query and each top-K gallery image) lifts top-1 to 0.428 at 725 ms per query [3]. Local-feature matching is exactly what separates a 2% milk from whole milk when the global embedding cannot.

**VLM plus retrieval hybrids.** A visual-RAG pipeline (retrieval shortlist, then GPT-4o / Gemini 2.0 Flash chooses) reports 86.8% few-shot fine-grained product accuracy [4]. Adding OCR text to image features gives a measurable gain over either alone on fine-grained groceries [21]; FGPR (Pattern Recognition 2025, 360K images, 85K SKUs) ships OCR annotations for this reason [22].

**Verdict for near-identical variants:** a hybrid (embedding top-K, then a reader that compares text and local features across candidates) is more accurate than either the VLM naming from scratch or embedding retrieval alone. Evidence: R@5 of 94.5% zero-shot versus R@1 of 77% [1], and PRISM's re-ranking gain [3].

## 2. Grounded detection for counting

**SAM 3 exists and takes text prompts.** Released 19 Nov 2025 under the SAM License: "promptable concept segmentation" returns a mask and ID for every instance of a noun phrase or image exemplar. SA-Co/Gold cgF1 54.1 versus OWLv2 24.6 and Gemini 2.5 13.0; humans 74.0 [23]. Counting: CountBench 95.6% (MAE 0.11), PixMo-Count 87.3% (MAE 0.22); LVIS zero-shot mask AP 47.0; 848M parameters; 30 ms per image with 100+ objects on an H200 [5][24]. SAM 3.1 (27 Mar 2026) multiplexes 16 tracked objects per pass, doubling video throughput [24].

**Open-vocabulary detectors.** Grounding DINO 1.6 Pro: COCO 55.4, LVIS-val 51.1 AP, API only [25]. DINO-X: COCO 56.0, LVIS-minival 59.8, FSC-147 counting MAE 5.6, Edge variant 20 FPS on Orin NX [26]. CountGD: FSC-147 MAE 5.74 with text plus exemplar, 12.98 text-only; in scenes with 300+ objects MAE explodes to 270 [27].

**Dense retail scenes.** SKU-110K (11,743 shelf images, 1.7M boxes, about 147 objects per image): a 2025 co-training ensemble reports mAP 0.596, AP75 0.663 [28]; YOLO-Master 58.2% mAP [29]. These are trained detectors; on the 100-dataset RF100-VL benchmark, zero-shot Grounding DINO averages 15.7 mAP, OWLv2 13.6, Gemini 2.5 Pro 11.6, Qwen2.5-VL-72B 5.6 to 7.8, and 10-shot fine-tuned Grounding DINO 33.6 [30]. Ten labelled examples per store beat any zero-shot prompt.

**Identical items in a pile.** "Counting Stacked Objects" (ICCV 2025 oral) shows the problem is 3D: even humans average MAE 823 and their 3D method needs 30 to 60 views; the open VLM tested was "completely off" [7]. VLMCountBench: the best model (Qwen2.5-72B) drops from 0.60 to 0.45 accuracy when three object types coexist, GPT-4o from 0.44 to 0.23, and decomposition prompts made things worse [6]. Detector-guided re-prompting recovers 5.3 points on average, up to 15.6 [31]. Qwen3-VL-235B reports CountBench 89.3 [10]; Molmo 72B 85.2% on PixMo-Count versus GPT-4o 59.6% [32].

## 3. Boxes from the VLM itself

- **Gemini** outputs `[ymin, xmin, ymax, xmax]` on a 0 to 1000 grid; Google says disable thinking for segmentation [33]. On COCO val: Gemini 2.5 Pro mAP 0.340 (AP50 0.517), Gemini 3 Pro Preview 0.407 (0.582), Gemini 3 Flash 0.397, rising to 0.451 with code-execution "Agentic Vision" [9]. Observed failures: one box for several similar objects ("one cake instead of four"), thinking tokens reducing mAP, infinite JSON loops on Flash-Lite [9][34].
- **Qwen3-VL** outputs `[x0, y0, x1, y1]` on 0 to 1000; Qwen3-VL-235B reports RefCOCO 90.5 and ODinW-13 48.6 [10]. Open issue: boxes drift badly on extreme aspect ratios [35].
- **GPT-5.** Not trained for boxes. BBox DocVQA (Nov 2025): GPT-5 0.9% mean IoU versus Qwen2.5-72B 35.2%, attributed to "coordinate insensitivity, likely due to internal resizing" [8]. Embodied3DBench attributes 19.8% of GPT-5 errors to 2D offset (right scale, wrong place) and 36.3% to binding the wrong object [37]. A 2026 traffic-scene study of ten LVLMs found Gemini 3 best (mAP50 0.695, mmAP 0.407 versus RT-DETRv4 0.420) and GPT-5 below it; removing a ruler overlay drawn on the image cut Gemini 3 to 0.525 [38]. Drawing coordinate ticks on the image is a cheap, effective trick.
- **Resolution.** gpt-5.6 "high" detail caps at 2048x2048 and a 2,500-patch budget of 32px patches, tokens = ceil(patches x 1.2) [39]. A 2048x2048 image is 4,096 patches, so the shipped JPEG is being downscaled to roughly 1600px before the model sees it; "original" detail keeps native pixels. This alone may explain some brand misreads.

## 4. Confidence and abstention

- **Verbalized confidence.** GPT-4V ECE 11.3% versus Gemini Pro Vision 38.4% on image recognition, overconfidence dominant [40]. GPT-4o on tabular QA: 99.5% mean stated confidence at 76.2% accuracy, AUROC 0.522 [11]. Prompting (CoT, confidence variants) does not fix it; post-hoc scaling does [41].
- **Agreement across calls.** Multi-Format Agreement (four re-serialisations at temperature 0) lifts GPT-4o AUROC to 0.782, ECE 0.105; self-consistency with N=5 gives AUROC 0.752 [11]. Object-level verbalized ECE on POPE adversarial is 0.48 for Qwen2-VL before training [42]; RL calibration cuts Qwen3-VL-4B ECE from 0.421 to 0.098 [43]; trained verbalized confidence lifts Qwen2-VL-7B AUROC 0.567 to 0.884 [44].
- **Logprobs.** Azure's Aug 2026 reasoning-model doc lists gpt-5.6-sol and states that reasoning models other than gpt-6-astra do not support `logprobs` or `top_logprobs` [12]. On OpenAI's API, gpt-5.1/5.2 return `message.output_text.logprobs` only without `json_schema`; with structured outputs the array is empty [13]. With a strict schema on sol, there is no token-probability signal.
- **Selective prediction.** ReCoVERR answers up to 20% more questions at fixed risk by gathering extra visual evidence [45]. BCEA (Jun 2026): at a 5% hallucination guarantee plain abstention rejects 82% of existence claims; gated zoom-crops (five 62% windows) raise certified coverage from 23% to 32% (alpha 0.10) and 28% to 42% (alpha 0.20), AUROC 0.82 to 0.88 [46]. Two-prompt consistency and crop-and-verify are the only cheap signals available on sol.

## 5. Multi-view and active perception

Every deployed cart system is multi-view by construction: Caper uses "two cameras to triangulate the exact location of an item in 3D space" and treats basket weight as "an X-ray of the basket contents" when cameras are blocked [15]; Just Walk Out tokenises "multi-view video feeds" and weight sensors into one receipt transformer [14]. Counting stacked items needs multiple views even for humans [7]. Next-best-view picking in clutter raises grasp success from 68% to 80% [47]. Scene context lifts occluded-grocery precision/recall from 70.3% to 85.5% on a 10-item set [48]. Making an object jointly visible across views "consistently improves accuracy" in SpatialMosaic [49], but VLMs are poor at merging: MIMIC shows LVLMs "fail to aggregate information across images" [50], and on MultiView-Bench GPT-5.6 Sol scores 63.3% on 3D integration (GPT-5 49%, GPT-4o 2%) [51]. Merging two photographs therefore belongs in code (Apple Vision instances plus embedding re-identification), not in the prompt. Selecting which item needs a second view: gate on borderline confidence bands [46], or have the LMM propose the viewpoint change that removes the occluder [52]. No paper reports recall recovered by a second consumer photo of a loaded cart; this must be measured on the project corpus.

## 6. Test-time scaling for vision

- **Zoom and re-ask** is the strongest lever. ZoomEye (EMNLP 2025): V*Bench Qwen2.5-VL-3B 76.96 to 89.01, InternVL2.5-8B 69.11 to 84.82, HR-Bench 8K gains 10 to 18 points, about 8 search steps per image; GPT-4o baseline 66.0 on V* [53]. Google's Agentic Vision (Jan 2026) reports a 5 to 10% boost and was measured at 10 to 16% mAP on COCO [9][34]. The vision-token capacity study shows recognition collapses past a 2.2x text-density band and higher resolution shifts the wall [54]: crop small labels at native resolution.
- **Majority vote** helps reasoning, barely perception: Qwen3-VL-8B RealWorldQA 69.5 to 72.7, A-OKVQA 87.16 to 87.34 [55]. Token-level augmentation voting (ICLR 2026) lifts mean accuracy 43.8 to 47.9%, most on OCRVQA [56].
- **Ensembles of providers.** No published product-recognition study; a 2025 challenge found a 3-model majority vote beat each member on fine-grained VQA [57]. No public benchmark reads brand names on packaging; a product-captioning study notes VLMs "read text panels, but often incorrectly" on curved labels [58].

## 7. Datasets with real carts or baskets (2023 to 2026)

| Dataset | Content | Licence |
|---|---|---|
| GroceryVision / ABV (Physical Store and RetailVision workshops, 2023 to 2024) | GoPro on a US shopping cart, 74,200 images, 409 SKUs; MPR retrieval track | CC BY-NC 4.0, email Amazon [59][1] |
| Counting Stacked Objects (2025) | 45 real piles, 2,381 phone images, verified counts | CC BY 4.0 [7] |
| Occluded Groceries (2025) | 10 items, 500 occluded home photos, 750 boxes | not stated [48] |
| FGPR (2025) | 360K images, 85K SKUs, OCR | not stated [22] |
| Grocer-Help (Sci. Reports 2026) | 13,771 shelf images, 349 categories, India | not located [60] |
| RPC (2019, still the checkout benchmark) | 83,739 images, 200 SKUs; SOTA checkout accuracy 97.62% average [61] | research use |

No openly licensed set of consumer phone photographs of loaded carts exists; GroceryVision is the closest and is non-commercial. Roboflow Universe "shopping cart" sets (about 300 images) carry mixed licences.

## 8. Products and companies

- **Amazon Just Walk Out**: multi-view cameras plus shelf weight sensors feed a transformer that emits receipts [14]. The Information reported that in 2022, 700 of every 1,000 transactions were human-verified against a 50 target; Amazon says associates "validate a small minority of shopping visits where our computer vision technology cannot determine with complete confidence" [16][17]. Amazon replaced it in Fresh stores with Dash Carts [62].
- **Amazon Dash Cart**: cameras, weight sensors; white light and beep on recognition, orange light means "try again"; produce needs a PLU and weight confirmation [18].
- **Instacart Caper**: camera array on Jetson, scale, location sensors; two-camera triangulation, edge encoder plus cloud VLM encoders into a "shopping experience decoder" [15][63]; early carts required a barcode scan and the display warns "when identification of added items fails" [64].
- **Zippin**: overhead cameras plus shelf weight; CEO: "for a small percentage of transactions where the overall system confidence is low, humans may review" [17]. AiFi reviews 0.3% of video [17].
- **Shopic**: clip-on camera, claims 99.4% add/remove detection [65]. **Veeve**: barcode plus vision plus scale [66]. **Trigo**: ceiling cameras and shelf sensors into a 3D twin; pivoted to loss prevention in 2025; "AI and computer vision alone are currently not capable of clearly identifying every single item" [67]. **Standard AI**: left autonomous checkout for analytics in March 2024 [68].

None publishes per-item confidence. The shared pattern: a second modality (weight), an immediate "try again" to the shopper, and humans behind low-confidence events.

## Ranked: five techniques most likely to move 90% toward 100%

1. **Catalog retrieval head on every crop, VLM as reranker.** Segment (Apple Vision or SAM 3), embed with fine-tuned SigLIP 2 or DINOv3, shortlist top-5, let sol pick among candidates with catalog images in context. Expected: brands from 92% toward 97 to 98% (zero-shot R@5 94.5% [1]; fine-tuned top-5 94.7% [2]; hybrid 86.8% few-shot [4]); PRIANO-type misreads vanish because the answer must be a catalog SKU. Cost: milliseconds on device plus one sol call with more image tokens (about $0.01 to 0.03). Effort: high (gallery build, fine-tune, reranking prompt; the SigLIP-B/16 experiment is the seed). Does not fix hidden items or counts.
2. **Crop-and-re-ask at native resolution.** Tile the original JPEG, send each low-confidence or small region as its own image with the candidate list. Expected: most brand and small-text errors (ZoomEye +12 to +35 points on small-detail benchmarks [53]; Agentic Vision +5 to 16% [9][34]); also restores the resolution lost to the 2,500-patch cap [39]. Cost: 3 to 8 extra calls; on luna about $0.001 each, on sol about $0.01 each. Effort: low. Does not fix hidden items.
3. **Promptable detector for counts.** SAM 3 with the SKU name or an exemplar crop, or Apple Vision instances, provides the count; the VLM only names. Expected: quantities from 88% toward 93 to 95% on visible items (SAM 3 CountBench 95.6% [5] versus VLM collapse on mixed scenes [6]). Cost: a GPU or on-device inference, no API cost. Effort: medium. Does not fix items hidden inside a pile, which are provably uncountable from one view [7].
4. **Agreement-based confidence instead of verbalized.** Run 3 to 4 cheap variants (luna or terra, different prompt formats) and use agreement as the confidence field. Expected: AUROC from about 0.52 to 0.75 to 0.78 [11], turning the 8 of 39 flagged errors into most of them; BCEA shows gated crops recover coverage lost to abstention [46]. Cost: 3 to 4x calls, but on luna ($0.20/M) under $0.01 total. Effort: low. Does not raise accuracy by itself.
5. **Second photograph for flagged regions, merged in code.** Ask for another angle only when a region is occluded or borderline; re-identify across views with embeddings, never by prompt (VLMs fail cross-image aggregation [50][51]). Expected: recovers part of the 10% not found, mostly the "mostly hidden" class; direct evidence is indirect (next-best-view +12 points [47], every cart product is two-camera [15]). Cost: one more sol call and user friction. Effort: medium. Does not fix counts inside dense piles.

## Sources

1. https://arxiv.org/html/2605.18029
2. https://arxiv.org/html/2607.09888
3. https://arxiv.org/html/2509.14985
4. https://arxiv.org/abs/2504.11838
5. https://docs.ultralytics.com/models/sam-3
6. https://arxiv.org/html/2510.04401
7. https://arxiv.org/html/2411.19149
8. https://www.emergentmind.com/topics/bbox-docvqa (arXiv 2511.15090)
9. https://github.com/simedw/coco-gemini
10. https://arxiv.org/html/2511.21631
11. https://arxiv.org/html/2604.12491
12. https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/reasoning
13. https://community.openai.com/t/gpt-5-1-5-2-message-output-text-logprobs-is-empty-when-structured-outputs-json-schema-is-enabled-in-responses-api/1371927
14. https://aws.amazon.com/blogs/machine-learning/enhancing-just-walk-out-technology-with-multi-modal-ai/
15. https://company.instacart.com/enterprise-blog/connecting-stores-from-edge-to-cloud-reinventing-retail-with-physical-ai
16. https://www.business-standard.com/companies/news/amazon-s-just-walk-out-checkout-tech-was-powered-by-1-000-indian-workers-124040400463_1.html
17. https://stadiumtechreport.com/editorial/checkout-free-stores-are-doing-well-in-stadiums-anyway/
18. https://www.grocerydive.com/news/amazons-dash-cart-offers-another-version-of-checkout-free-technology/581580/
19. https://www.width.ai/post/sku-image-classification-for-product-matching
20. https://arxiv.org/html/2504.07567v1
21. https://dl.acm.org/doi/abs/10.1007/s00138-024-01549-9
22. https://www.sciencedirect.com/science/article/abs/pii/S0031320325011860
23. https://github.com/facebookresearch/sam3
24. https://ai.meta.com/blog/segment-anything-model-3/
25. https://github.com/IDEA-Research/Grounding-DINO-1.5-API
26. https://arxiv.org/html/2411.14347v1
27. https://arxiv.org/abs/2407.04619 (CountGD)
28. https://arxiv.org/pdf/2509.09750
29. https://arxiv.org/html/2512.23273
30. https://arxiv.org/abs/2505.20612
31. https://arxiv.org/html/2607.09544
32. https://allenai.org/blog/molmo2
33. https://ai.google.dev/gemini-api/docs/image-understanding
34. https://blog.google/innovation-and-ai/technology/developers-tools/agentic-vision-gemini-3-flash/
35. https://github.com/QwenLM/Qwen3-VL/issues/2020
37. https://arxiv.org/pdf/2605.29074
38. https://arxiv.org/abs/2601.22830
39. https://developers.openai.com/api/docs/guides/images-vision
40. https://arxiv.org/html/2405.02917
41. https://arxiv.org/abs/2604.02543
42. https://arxiv.org/html/2504.14848
43. https://arxiv.org/html/2604.09529
44. https://arxiv.org/html/2606.27023
45. https://aclanthology.org/2024.findings-acl.767/
46. https://arxiv.org/html/2606.16667
47. https://arxiv.org/abs/1809.08564
48. https://arxiv.org/html/2510.26681
49. https://arxiv.org/html/2512.23365v2
50. https://arxiv.org/abs/2601.07812
51. https://arxiv.org/html/2607.08970
52. https://ietresearch.onlinelibrary.wiley.com/doi/full/10.1049/csy2.70008
53. https://arxiv.org/html/2411.16044v2
54. https://arxiv.org/html/2602.02539
55. https://arxiv.org/html/2606.28864v2
56. https://arxiv.org/abs/2510.03574
57. https://arxiv.org/pdf/2509.09190
58. https://arxiv.org/pdf/2511.08917
59. https://physicalstoreworkshop.github.io/challenge.html
60. https://www.nature.com/articles/s41598-026-42266-9
61. https://doi.org/10.3390/jimaging11100337
62. https://www.retaildive.com/news/amazon-removes-just-walk-out-tech-amazon-fresh-stores-dash-carts/712150
63. https://company.instacart.com/updates/transforming-in-store-shopping-caper-carts-ai-magic-powered-by-nvidia-jetson
64. https://techcrunch.com/2019/01/10/caper-shopping-cart/
65. https://www.timesofisrael.com/startups-clip-on-device-for-smart-carts-deployed-at-shufersal/
66. https://www.cnbc.com/2022/05/19/albertsons-deploys-smart-grocery-carts-from-veeve-ex-amazon-engineers.html
67. https://retail-optimiser.de/en/trigo-aims-to-combat-shoplifting-with-ai-and-computer-vision/
68. https://venturebeat.com/ai/exclusive-standard-ai-shifts-focus-to-computer-vision-analytics-for-retailers-now-valued-at-1-5-billion

Pricing used for cost estimates: gpt-5.6-sol $4 / $20 per million input / output tokens, gpt-5.6-luna $0.20 / $1.20 (https://developers.openai.com/api/docs/pricing). A 2,500-patch image costs 3,000 input tokens, about $0.012 on sol.
