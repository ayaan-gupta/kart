# Retrieval review: what this project does, what the literature does, and the distance between them

Written 2026-09-07, after an audit of the four-phase plan in
[`2026-09-06-qwen-finetune.md`](2026-09-06-qwen-finetune.md) and a survey of current practice in
product linking, multimodal retrieval and production RAG.

Two questions are answered here. What of the plan is built. And whether the retrieval this
project does is the retrieval the problem deserves.

## The plan, audited

| phase | what it asked for | state |
|---|---|---|
| 1 | Qwen2.5-VL-72B via API | measured on 15 photographs and rejected, see [`CLUT.md`](../../server/eval/CLUT.md) |
| 1 | the existing prompt template | shipped, `server/src/prompts.ts` |
| 1 | log image, raw output, final answer, correction | **not built.** No write of any kind in `server/src` or `server/api` |
| 1 | simple RAG over a SKU database | built well past simple, and dark in production |
| 2 | structured correction records, `failure_mode` tagged | **not built.** The app has no surface on which a shopper can correct a line |
| 3 | route fixes by failure mode | done once by hand, in prose, offline |
| 4 | narrow fine-tune if justified | done, on the encoder rather than the reader, worth 5.9 points |

Two of those want expanding.

**The RAG is built and is not running.** `server/catalog` is a six-stage matcher: SigLIP-B/16
features, a head trained on the store's own catalog, a ten-candidate shortlist, a reranker fusing
keypoint geometry and colour layout, and a calibrated probability with a floor below which it
declines. Its shortlist reaches the census prompt as the `catalog:` line at
`server/src/prompts.ts:315`, five names of ten, and rule 15 of the system prompt tells the reader
what to do with them. All of that is real. It is also unreachable: the matcher lives behind the
enumerator's GPU endpoint, no endpoint is configured on this machine, and the run in
`/tmp/serve-4314.log` logs `enumeration degraded: no enumerator configured` sixty-seven times.
Every live scan measured in `CLUT.md` was a bare reader with no catalog at all.

**Phase 3's percentages do not survive contact with the measurement.** The plan predicts RAG
misses at about 40% of errors. On RPC the shortlist holds the right answer 98.9% of the time and
only 3 errors in 465 put it outside the top twenty, so retrieval misses are nearer 1%. The real
distribution, from `CATALOG.md`, is that 46% of remaining errors are two variants of one product.
That is not a retrieval failure and not a prompt failure. It is a discrimination failure, and it
is the failure mode the whole rest of this document is about.

## The verdict

The measurement discipline here is better than most of what the RAG literature describes as
production practice: ablations with controls, negative results recorded so they are not retried,
cross-validation split on scene rather than on query, calibration measured against observed rates,
and the top-5 ceiling always reported beside top-1. Almost nothing in the survey below is a
correction of method.

The architecture is a different matter, and there the criticism lands. This system retrieves on
one leg. It matches pictures against pictures and never once uses the text printed on the
packaging, despite paying a vision-language model to read that text in the same forward pass.
Every serious product-linking system published in the last two years is hybrid. That is the gap,
and it is large enough to explain the errors that remain.

## 1. The index has one leg

The matcher embeds a crop and compares it to embedded reference crops. The catalog's text, and
the text the reader lifts off the packet, meet only inside the prompt, as five names in a line,
after retrieval has already committed to its ten.

What the literature says about the missing leg:

- Dense retrievers fail systematically on exact tokens. The canonical example in e-commerce is
  that a query for a 256GB phone returns the 128GB variant, because semantic similarity between
  the two is nearly total. That is the same failure as PRIANO rigatoni against PRIANO fusilli
  bucati, and it is 46% of what this system still gets wrong.
- Sparse and dense retrieval fused with reciprocal rank fusion lifts recall@10 from a 65 to 78%
  band to 91% on general corpora, and reaching recall@1000 of 0.98 needs both; neither leg gets
  there alone.
- A SPLADE model fine-tuned on e-commerce beats BM25 by 28% nDCG@10 on Amazon ESCI, 0.389 against
  0.305, on 100,000 products and 10,000 queries. Off-the-shelf SPLADE trained on web search
  queries manages 0.326, so the domain tuning is worth 19% by itself.
- Anthropic's own contextual retrieval numbers put a size on each leg: contextual embeddings alone
  cut top-20 retrieval failures 35%, adding contextual BM25 cuts them 49%, and adding a reranker
  on top reaches 67%. The lexical leg is worth roughly as much as the semantic one.

The version of this for a cart is not exotic. The reader already emits brand, product, size and
whatever it could read. Those are a query. The store catalog is text. Retrieve a second candidate
list from it, lexically, tolerant of OCR damage, and fuse the two lists. Reciprocal rank fusion at
k=60 is the training-free default and the literature is consistent that learned score fusion is
better once there is tuning data to fit it, which this project has: `fuse_rerank.py` already fits
weights by 4-fold cross-validation split on scene.

The one caution worth carrying: the reader's text is sometimes wrong, and it is confidently wrong
in exactly the way that poisons a lexical query. Qwen read PRIANO as "Palano" and as "Piano" in
the CLUT runs. Fuzzy matching at a character level is the standard defence in OCR entity linking
and it is cheap.

## 2. The reference-photograph floor is the deployment blocker

`matcher.py` refuses to index a SKU below ten reference photographs, and `CATALOG.md` justifies
that: below ten the trained head is no better than the lookup, and twenty is the knee. The
justification is sound and the consequence is severe. A store with 30,000 SKUs will not
photograph twenty views of each. That is 600,000 photographs.

Two published escapes, both with numbers.

**Retrieve against catalog text instead of catalog photographs.** arXiv:2605.18029, the paper
`CATALOG.md` already cites for its 77.0% comparable, does not use reference photographs at all.
It embeds 409 catalog *descriptions* and matches probe images against them, reaching R@1 0.770 and
R@5 0.945 zero-shot. Its one preparation step is worth stealing: the catalog metadata overran
CLIP's 77-token limit, so they compressed each entry with an 8B model and validated on 250 of the
409 entries for 100% token compliance and 100% attribute retention. A store's product list always
exists. Its photographs may not.

**Fine-tune the encoder for the catalog-to-real gap, then a single packshot per SKU is enough.**
Cat2Real (arXiv:2607.09888) is the closest published analogue to this project's deployment: 45,243
products, 409,891 catalog packshots, 196,531 real in-store photographs, evaluated on 5,043 real
images across 52 categories.

| stage | top-1 | top-5 |
|---|---|---|
| DINOv3-384, no fine-tuning | 53.83% | 78.12% |
| stage 1, catalog pairs and category negatives | 73.77% | 93.24% |
| stage 2, mined hard negatives | 78.45% | 93.65% |
| stage 3, negatives reselected during training | **80.73%** | **94.70%** |
| Gemini-Embedding-2 | 68.71% | |

Two of their results matter more here than the headline. Products removed from training entirely
still score 80.23% against 80.73%, so the fine-tuned encoder generalises to SKUs it never saw.
And accuracy went **up** as the catalog grew, 75.77% at 11,206 products to 80.73% at 45,243,
because breadth bought training signal.

That second property is the one a trained head does not have. This project's head must be refit
when a product is added and cannot name a product it was not fitted on. Cat2Real's encoder can.
The two are not exclusive, and the honest reading of `CATALOG.md` plus Cat2Real is that the head
is the right answer for a fixed 200-SKU corpus and an adapted encoder is the right answer for a
store whose catalog turns over weekly.

Worth noting against this project's own finding: `CATALOG.md` measured DINOv2-B at 40.9% and
concluded self-supervised features do not suit packaged groceries. Cat2Real gets 80.73% out of
DINOv3. The difference is not the family, it is that one was frozen and searched and the other was
fine-tuned on cross-domain pairs with mined negatives. The conclusion "DINOv2 loses" should be
narrowed to "frozen DINOv2 in a nearest-neighbour lookup loses", which is all that was tested.

## 3. Nothing has been measured above 200 SKUs

Every accuracy number in `CATALOG.md` is on a 200-SKU catalog. The shelves corpus reaches 623
classes. A supermarket carries 30,000 to 50,000. That difference has never been measured here and
it is not a small extrapolation.

What is known from elsewhere: general retrieval degrades gently and then breaks, Recall@10 falling
96.6% at 5,000 documents to 87.3% at 40,000, with a knee reported around 100,000 items; Cat2Real
saw no degradation to 45,243 products. So the extrapolation is probably survivable. But the head's
arithmetic changes from 200 dot products to 30,000, "refit in seconds" becomes a job, and the
nearest-neighbour index goes from brute force to something that needs an ANN structure and its own
recall budget. None of that is hard. All of it is unmeasured, and this project's own standard says
unmeasured means unmeasured.

## 4. The cascade is designed here and not used

The system sends every region to the expensive reader. `CATALOG.md` already establishes that it
need not: splitting queries by how close their top two candidates sit, the clear half is 100%
correct and every single error is in the other half.

That is precisely the published pattern. arXiv:2608.25037 resolves product links with a cheap
distilled cross-encoder calibrated to a 98% precision bar, auto-accepting 68% of pairs, and
escalates only the remainder to an agentic VLM that looks at images and searches the web, taking
end-to-end coverage to 77% at roughly one seventh the per-pair cost of a frontier model. The
general cascade literature reports 97% of a frontier model's accuracy at 24% of its cost.

Applied here: run the matcher, accept above the calibrated floor, and spend the reader only on the
ambiguous half. `CATALOG.md` says this in its own words at the end of the error analysis, that a
model which can read the small differing panel "only has to run on the ambiguous half, which is
where every error already is". Nothing has been built on that sentence.

## 5. The reader should not be the reranker by default

The current design is a listwise LLM reranker whether or not it is called one: five candidate
names, in rank order, in a prompt, and the model picks. Three findings apply.

- A dedicated cross-encoder reranker beat GPT-5 by 12 to 15% nDCG@10 across 13 datasets, at 25 to
  60 times lower cost and 9 to 48 times lower latency.
- LLM rerankers **hurt** when first-stage retrieval is already strong, dropping nDCG@10 from
  81.58% to 75.97% in that benchmark. They pay off by 24 to 29% only when the first stage is weak.
  This project's first stage is strong: R@5 of 98.9%.
- Listwise LLM reranking carries a documented position bias from causal attention and positional
  encoding, so candidates late in the list are less likely to be promoted. The `catalog:` line is
  emitted in rank order with no shuffling and the effect has never been measured.

None of this says remove the reader. The reader is doing something a cross-encoder cannot: reading
printed text off packaging, which is the exact evidence the variant-confusion errors need. It says
the reader should be given the job it is uniquely good at, on the queries that need it, rather
than a ranking job that a 1,000x cheaper model does better. And the position-bias check is one
run: shuffle the five names and see whether the answer moves.

## 6. Open set has a better score available and it costs an hour

`CATALOG.md` measured three signals for "is this product in the catalog at all" and shipped none,
correctly, because 0.844 AUROC is not enough to stand between a trolley strut and a shopper's bag.

| signal | AUROC |
|---|---|
| confidence from the first-to-second margin, what ships | 0.789 |
| keypoint inliers, absolute | 0.777 |
| head score, absolute cosine | 0.815 |
| all three, fitted and scored on opposite halves | 0.844 |

The diagnosis in that section is exactly right and matches the literature: a margin answers which
known class, not whether any known class is entitled to accept. The literature's answer to that is
the energy score, the logsumexp over unnormalised logits, which is reported as the most consistent
open-set signal across backbones and reaches 87.46 AUROC on CLIP features where softmax-derived
scores trail it.

The head already produces logits. The crops are already cached by `build_cache.py`.
`score_openset.py` already holds the protocol. This is an afternoon at most, on data that exists,
and it is the highest-value unmeasured item in the repository.

## 7. Hard negatives are the untouched training lever

`head.py` trains on the catalog. Cat2Real's entire 7-point gain, 73.77% to 80.73%, comes from
nothing but progressively harder negatives: first category-level, then mined by image similarity,
then reselected during training with the live encoder weights. IKEA's dense retrieval work does
the same by class of negative, attribute-only, category mismatch and multi-attribute.

This project has the hard negatives already identified and labelled in prose. 46% of remaining
errors are two variants of one product, and one pair of chocolate SKUs accounts for 13 errors on
its own. Those pairs are the negatives. Mining them is mechanical.

## 8. Attributes are known and never used to filter

Standard practice for production retrieval is to embed the richest description and separately
store the structured attributes for hard filtering, so that vector search is asked to find similar
things that are also eligible. This project filters on nothing. Size, category, package form,
which store the shopper is in, all knowable, none of them constrains the candidate set.

The cited benchmarks for metadata filtering are generic and their absolute numbers do not transfer.
The direction does, and there is a specific version for this system: a crop's physical size
relative to the cart is already computed for the counting rule, and it separates a 500ml jar from
a 2kg bag more reliably than any encoder separates two chocolate bars.

## 9. Nothing is logged, and that is where the plan was right

The plan called the correction record the single most important thing to build. It is not built,
and I agree with the plan rather than with the order it proposed.

Current state: the offline harness is excellent and the online instrumentation is nil. There is no
correction surface in the app, no per-stage record of what the matcher shortlisted, no record of
what the reader was shown, no record of what it returned before reconciliation, and no way after
the fact to attribute a wrong line to retrieval, to reading, or to the agreement gate. The RAG
failure literature's most repeated complaint is exactly this: reporting one aggregate quality
number that hides which stage moved.

Everything above this section is a hypothesis about which stage is weak. The instrumentation is
what turns those into measurements on real carts rather than on RPC.

## What to do, in order

Ranked by measured evidence behind them and by cost.

1. **Turn the catalog on and measure with it.** Every CLUT number is a reader with no catalog. The
   whole retrieval stack is currently a document rather than a component. Until one CLUT run has
   the matcher behind it, nothing else here can be attributed.
2. **Add the text leg.** Lexical retrieval over catalog text from what the reader already reads,
   fuzzy at character level, fused with the image list. Measure shortlist recall@10 alone first,
   because that is the ceiling everything after inherits.
3. **Energy score for open set.** An afternoon, on cached crops, against an existing protocol.
4. **Log the stages, then the corrections.** The record the plan asked for, plus the two fields it
   omitted: what the shortlist held, and what the reader was shown.
5. **Mine hard negatives from the known variant confusions and refit.** The pairs are already
   written down.

Deliberately not on the list: fine-tuning the reader, and swapping the reader again. The plan puts
both in phase 4 and the measurement supports leaving them there.

## Sources

- [Retrieve, Match, Escalate: product linking with VLM-distilled cross-encoders](https://arxiv.org/abs/2608.25037)
- [Bridging the Catalog-to-Real Gap: scalable product recognition via multi-stage contrastive learning](https://arxiv.org/html/2607.09888)
- [What Matters for Grocery Product Retrieval with Open Source Vision Language Models](https://arxiv.org/abs/2605.18029)
- [Multimodal fine-grained grocery product recognition using image and OCR text](https://dl.acm.org/doi/abs/10.1007/s00138-024-01549-9)
- [AMELI: enhancing multimodal entity linking with fine-grained attributes](https://arxiv.org/pdf/2305.14725)
- [Anthropic, Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)
- [Qdrant, fine-tuning sparse embeddings for e-commerce search](https://qdrant.tech/articles/sparse-embeddings-ecommerce-part-1/)
- [Voyage AI, the case against LLMs as rerankers](https://blog.voyageai.com/2025/10/22/the-case-against-llms-as-rerankers/)
- [Position bias undermines preference consistency in listwise LLM-based reranking](https://arxiv.org/abs/2608.03091)
- [Evidence-guided unknown rejection for high-confidence near-known unknowns](https://arxiv.org/pdf/2605.17818)
- [Negative data mining for contrastive learning in dense retrieval at IKEA.com](https://arxiv.org/pdf/2605.00353)
- [Hybrid search for RAG: BM25, SPLADE and vector search combined](https://www.premai.io/blog/hybrid-search-for-rag-bm25-splade-and-vector-search-combined/)
- [Kili, RAG evaluation: measuring retrieval and generation as separate problems](https://kili-technology.com/blog/rag-evaluation-guide-measuring-retrieval-and-generation-as-separate-problems)
- [The RAG failure taxonomy: 12 ways production retrieval pipelines break](https://activewizards.com/blog/the-rag-failure-taxonomy-12-ways-production-retrieval-pipelines-break/)
