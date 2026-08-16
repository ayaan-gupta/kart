import { describe, expect, it, vi } from "vitest";
import type { CensusResponse } from "../src/schemas.js";
import type { TruthItem } from "../eval/score.js";
import { describeCorpus, runEval, type Recognizer } from "../eval/run-eval.js";

function census(overrides: Partial<CensusResponse> = {}): CensusResponse {
  return {
    marks: [],
    unmarkedItems: [],
    inViewCounts: [],
    occlusion: { itemsLikelyHidden: false, severity: "none", reason: "" },
    ...overrides,
  };
}

const bananaMark = {
  id: 1,
  name: "Bananas",
  brand: null,
  size: null,
  category: "produce",
  confidence: 0.9,
  needsCloserLook: false, isProduct: true,
};

const froskMark = {
  id: 1,
  name: "Froot Loops",
  brand: "Kellogg's",
  size: null,
  category: "cereal",
  confidence: 0.9,
  needsCloserLook: false, isProduct: true,
};

const bananaTruth: TruthItem[] = [{ name: "Bananas", brand: null, qty: 1, occluded: false }];

function stubLoadImage(): Buffer {
  return Buffer.from("fake-image-bytes");
}

/**
 * runEval now requires a ResultsWriter and accepts an optional Emit. Most tests do not care
 * about live emission order, only about the final outcome, so this wraps runEval with fresh
 * in-memory collectors for both and returns the same EvalOutcome any earlier test expected.
 * Tests that specifically care about emission order (see "runEval: streaming output") call
 * runEval directly instead, so they can inspect the collectors alongside the outcome.
 */
function collectors() {
  const chunks: string[] = [];
  const emitted: { line: string; stream: "stdout" | "stderr" }[] = [];
  const writeResult = (chunk: string) => chunks.push(chunk);
  const emit = (line: string, stream: "stdout" | "stderr") => emitted.push({ line, stream });
  return { chunks, emitted, writeResult, emit };
}

function runWithCollectors(
  files: string[],
  truth: Record<string, TruthItem[]>,
  loadImage: (file: string) => Buffer,
  recognize: Recognizer,
) {
  const { writeResult, emit } = collectors();
  return runEval(files, truth, loadImage, recognize, writeResult, emit);
}

describe("describeCorpus", () => {
  it("reports a fully empty corpus", () => {
    const info = describeCorpus([], {});
    expect(info.evaluable).toEqual([]);
    expect(info.emptyMessage).toContain("0 image file(s)");
    expect(info.emptyMessage).toContain("0 ground truth entr");
  });

  it("names images that have no ground truth entry", () => {
    const info = describeCorpus(["cart1.jpg"], {});
    expect(info.evaluable).toEqual([]);
    expect(info.imagesWithoutTruth).toEqual(["cart1.jpg"]);
    expect(info.emptyMessage).toContain("Image(s) with no ground truth entry: cart1.jpg");
  });

  it("names ground truth entries that have no matching image file", () => {
    const info = describeCorpus([], { "cart1.jpg": bananaTruth });
    expect(info.evaluable).toEqual([]);
    expect(info.truthWithoutImages).toEqual(["cart1.jpg"]);
    expect(info.emptyMessage).toContain("Ground truth entry with no matching image file: cart1.jpg");
  });

  it("finds the evaluable set when a file and a ground truth entry match", () => {
    const info = describeCorpus(["cart1.jpg"], { "cart1.jpg": bananaTruth });
    expect(info.evaluable).toEqual(["cart1.jpg"]);
  });
});

describe("runEval: empty corpus", () => {
  it("exits 1, never calls recognize, and writes no report", async () => {
    const recognize = vi.fn<Recognizer>();
    const outcome = await runWithCollectors([], {}, stubLoadImage, recognize);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.reportMarkdown).toBeNull();
    expect(outcome.scoredCount).toBe(0);
    expect(outcome.erroredCount).toBe(0);
    expect(recognize).not.toHaveBeenCalled();
    expect(outcome.stderr.join("\n")).toContain("No cart photos to evaluate");
  });

  it("exits 1 and never calls recognize when images exist but none have ground truth", async () => {
    const recognize = vi.fn<Recognizer>();
    const outcome = await runWithCollectors(["cart1.jpg"], {}, stubLoadImage, recognize);

    expect(outcome.exitCode).toBe(1);
    expect(recognize).not.toHaveBeenCalled();
    expect(outcome.stderr.join("\n")).toContain("cart1.jpg");
  });

  it("exits 1 and never calls recognize when ground truth exists but no image matches", async () => {
    const recognize = vi.fn<Recognizer>();
    const outcome = await runWithCollectors([], { "cart1.jpg": bananaTruth }, stubLoadImage, recognize);

    expect(outcome.exitCode).toBe(1);
    expect(recognize).not.toHaveBeenCalled();
    expect(outcome.stderr.join("\n")).toContain("cart1.jpg");
  });
});

describe("runEval: all images fail", () => {
  it("exits 1, reports zero scored and every image errored, but still writes a durable report", async () => {
    // Unlike an empty corpus (nothing attempted, nothing written), a total failure here means
    // real work was attempted (a paid API call per image) and each attempt's error is worth
    // keeping on disk, so this file is written even though the outcome is a total failure.
    const recognize = vi.fn<Recognizer>().mockRejectedValue(new Error("runCensus: OpenAI request failed (401 invalid_api_key)"));
    const truth = { "cart1.jpg": bananaTruth, "cart2.jpg": bananaTruth };
    const outcome = await runWithCollectors(["cart1.jpg", "cart2.jpg"], truth, stubLoadImage, recognize);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.scoredCount).toBe(0);
    expect(outcome.erroredCount).toBe(2);
    expect(outcome.reportMarkdown).not.toBeNull();
    expect(outcome.reportMarkdown).toContain("## cart1.jpg");
    expect(outcome.reportMarkdown).toContain("## cart2.jpg");
    expect(outcome.reportMarkdown).toContain(
      "error: runCensus: OpenAI request failed (401 invalid_api_key)",
    );
    expect(outcome.reportMarkdown).toContain("## Summary");
    expect(outcome.reportMarkdown).toContain("All 2 evaluable image(s) failed");
    expect(outcome.reportMarkdown).toContain("This run's exit code: 1.");
    expect(outcome.stderr.some((l) => l.includes("cart1.jpg") && l.includes("ERROR"))).toBe(true);
    expect(outcome.stderr.some((l) => l.includes("cart2.jpg") && l.includes("ERROR"))).toBe(true);
    expect(outcome.stderr.join("\n")).toContain("All 2 evaluable image(s) failed");
  });

  it("never leaks anything key-shaped even though the error message here already came pre-redacted", async () => {
    const recognize = vi.fn<Recognizer>().mockRejectedValue(new Error("runCensus: OpenAI request failed (401 [redacted])"));
    const outcome = await runWithCollectors(["cart1.jpg"], { "cart1.jpg": bananaTruth }, stubLoadImage, recognize);
    const allText = [...outcome.stdout, ...outcome.stderr, outcome.reportMarkdown ?? ""].join("\n");
    expect(allText).not.toMatch(/sk-[A-Za-z0-9_-]{10,}/);
  });
});

describe("runEval: mixed success and failure", () => {
  it("exits 2, scores the successful image, and still writes a report", async () => {
    const recognize = vi
      .fn<Recognizer>()
      .mockImplementation(async (_image, _marks, diagnostics) => {
        if (diagnostics) {
          diagnostics.repaired = [];
          diagnostics.plausiblyUnmarked = [];
          diagnostics.unrepaired = [];
          diagnostics.merged = [];
        }
        return census({
          marks: [bananaMark],
          inViewCounts: [{ productKey: "::bananas", count: 1 }],
        });
      });
    recognize.mockRejectedValueOnce(new Error("runCensus: OpenAI connection failed (ECONNRESET)"));

    const truth = { "bad.jpg": bananaTruth, "good.jpg": bananaTruth };
    const outcome = await runWithCollectors(["bad.jpg", "good.jpg"], truth, stubLoadImage, recognize);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.scoredCount).toBe(1);
    expect(outcome.erroredCount).toBe(1);
    expect(outcome.reportMarkdown).not.toBeNull();
    expect(outcome.reportMarkdown).toContain("## bad.jpg");
    expect(outcome.reportMarkdown).toContain("error: runCensus: OpenAI connection failed (ECONNRESET)");
    expect(outcome.reportMarkdown).toContain("## good.jpg");
    expect(outcome.reportMarkdown).toContain("precision 1.00  recall 1.00");
  });
});

describe("runEval: full success", () => {
  it("exits 0 when every evaluable image scores without error", async () => {
    const recognize = vi.fn<Recognizer>().mockResolvedValue(
      census({ marks: [bananaMark], inViewCounts: [{ productKey: "::bananas", count: 1 }] }),
    );
    const outcome = await runWithCollectors(["cart1.jpg"], { "cart1.jpg": bananaTruth }, stubLoadImage, recognize);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.scoredCount).toBe(1);
    expect(outcome.erroredCount).toBe(0);
    expect(outcome.reportMarkdown).not.toBeNull();
  });

  it("skips a file with no ground truth entry, warns, and does not call loadImage or recognize for it", async () => {
    const recognize = vi.fn<Recognizer>().mockResolvedValue(census({ marks: [bananaMark] }));
    const loadImage = vi.fn(stubLoadImage);
    const truth = { "cart1.jpg": bananaTruth };
    const outcome = await runWithCollectors(["cart1.jpg", "orphan.jpg"], truth, loadImage, recognize);

    expect(outcome.exitCode).toBe(0);
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledWith("cart1.jpg");
    expect(outcome.stderr.some((l) => l.includes("skipping orphan.jpg"))).toBe(true);
  });

  it("passes the full-frame mark and a diagnostics object to recognize", async () => {
    const recognize = vi.fn<Recognizer>().mockResolvedValue(census({ marks: [bananaMark] }));
    await runWithCollectors(["cart1.jpg"], { "cart1.jpg": bananaTruth }, stubLoadImage, recognize);

    expect(recognize).toHaveBeenCalledTimes(1);
    const [, marks, diagnostics] = recognize.mock.calls[0];
    expect(marks).toEqual([{ id: 1, box: { x: 0, y: 0, w: 1, h: 1 } }]);
    expect(diagnostics).toEqual({ repaired: [], plausiblyUnmarked: [], unrepaired: [], merged: [] });
  });
});

describe("runEval: count-accuracy section", () => {
  it("appears in both stdout and the written report, separate from precision and recall", async () => {
    const recognize = vi.fn<Recognizer>().mockResolvedValue(
      census({ marks: [bananaMark], inViewCounts: [{ productKey: "::bananas", count: 1 }] }),
    );
    const outcome = await runWithCollectors(["cart1.jpg"], { "cart1.jpg": bananaTruth }, stubLoadImage, recognize);

    expect(outcome.stdout.join("\n")).toContain("Count accuracy");
    expect(outcome.reportMarkdown).toContain("## Count accuracy");
    expect(outcome.reportMarkdown).toContain("count accuracy:");
  });

  it("reflects an over-count (the shipped bug's shape) in the summary and the per-image section", async () => {
    const recognize = vi.fn<Recognizer>().mockResolvedValue(
      census({ marks: [bananaMark], inViewCounts: [{ productKey: "::bananas", count: 4 }] }),
    );
    const truth = { "cart1.jpg": [{ name: "Bananas", brand: null, qty: 1, occluded: false }] };
    const outcome = await runWithCollectors(["cart1.jpg"], truth, stubLoadImage, recognize);

    expect(outcome.results[0]).toMatchObject({ ok: true });
    const result = outcome.results[0];
    if (result.ok) {
      expect(result.countScore.overCounted).toEqual(["::bananas"]);
      expect(result.countScore.meanSignedError).toBe(3);
    }
    expect(outcome.reportMarkdown).toContain("over-counted: ::bananas");
    expect(outcome.stdout.join("\n")).toContain("mean signed error 3.000");
  });

  it("reports a missing inViewCounts entry as missing, not as a silent zero", async () => {
    const recognize = vi.fn<Recognizer>().mockResolvedValue(census({ marks: [bananaMark], inViewCounts: [] }));
    const outcome = await runWithCollectors(["cart1.jpg"], { "cart1.jpg": bananaTruth }, stubLoadImage, recognize);

    const result = outcome.results[0];
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.countScore.missingFromPredicted).toEqual(["::bananas"]);
      expect(result.countScore.totalCompared).toBe(0);
    }
    expect(outcome.reportMarkdown).toContain("missing from predicted (in ground truth, no inViewCounts entry): ::bananas");
  });
});

describe("runEval: averaging method disclosure", () => {
  it("states macro-averaging explicitly in stdout and the written report", async () => {
    const recognize = vi.fn<Recognizer>().mockResolvedValue(census({ marks: [bananaMark] }));
    const outcome = await runWithCollectors(["cart1.jpg"], { "cart1.jpg": bananaTruth }, stubLoadImage, recognize);

    expect(outcome.stdout.join("\n").toLowerCase()).toContain("macro-averaged");
    expect(outcome.reportMarkdown?.toLowerCase()).toContain("macro-averaged");
  });
});

describe("runEval: exit-code scheme disclosure", () => {
  it("states what 0, 1, and 2 mean in the written report, next to this run's own exit code", async () => {
    const recognize = vi.fn<Recognizer>().mockResolvedValue(census({ marks: [bananaMark] }));
    const outcome = await runWithCollectors(["cart1.jpg"], { "cart1.jpg": bananaTruth }, stubLoadImage, recognize);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.reportMarkdown).toContain("Exit codes:");
    expect(outcome.reportMarkdown).toContain("0 means a clean run");
    expect(outcome.reportMarkdown).toContain("1 means a total failure");
    expect(outcome.reportMarkdown).toContain("2 means a partial failure");
    expect(outcome.reportMarkdown).toContain("This run's exit code: 0.");
  });

  it("names the actual exit code (2) for a partial-failure run in the written report", async () => {
    const recognize = vi.fn<Recognizer>();
    recognize.mockResolvedValueOnce(census({ marks: [bananaMark] }));
    recognize.mockRejectedValueOnce(new Error("runCensus: OpenAI connection failed (ECONNRESET)"));

    const truth = { "good.jpg": bananaTruth, "bad.jpg": bananaTruth };
    const outcome = await runWithCollectors(["good.jpg", "bad.jpg"], truth, stubLoadImage, recognize);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.reportMarkdown).toContain("This run's exit code: 2.");
  });
});

describe("runEval: visible-only occlusion reporting", () => {
  it("computes a second score excluding occluded ground truth items", async () => {
    const recognize = vi.fn<Recognizer>().mockResolvedValue(census({ marks: [bananaMark] }));
    const truth = {
      "cart1.jpg": [
        { name: "Bananas", brand: null, qty: 1, occluded: false },
        { name: "Froot Loops", brand: "Kellogg's", qty: 1, occluded: true },
      ],
    };
    const outcome = await runWithCollectors(["cart1.jpg"], truth, stubLoadImage, recognize);

    const result = outcome.results[0];
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.score.recall).toBe(0.5);
      expect(result.visibleScore.recall).toBe(1);
    }
  });
});

describe("runEval: corpus-wide mean precision and recall", () => {
  it("computes the macro-averaged mean by hand for a clean multi-image run with differing per-image scores", async () => {
    const recognize = vi.fn<Recognizer>();
    recognize.mockImplementationOnce(async () =>
      census({ marks: [bananaMark, { ...froskMark, name: "Motor Oil", brand: "Castrol" }] }),
    );
    recognize.mockImplementationOnce(async () => census({ marks: [bananaMark] }));

    const truth = {
      "imageA.jpg": [{ name: "Bananas", brand: null, qty: 1, occluded: false }],
      "imageB.jpg": [
        { name: "Bananas", brand: null, qty: 1, occluded: false },
        { name: "Froot Loops", brand: "Kellogg's", qty: 1, occluded: false },
        { name: "Rice Krispies", brand: "Kellogg's", qty: 1, occluded: false },
      ],
    };
    const outcome = await runWithCollectors(["imageA.jpg", "imageB.jpg"], truth, stubLoadImage, recognize);

    // imageA: predicted Bananas (hit) plus Motor Oil (hallucination) against 1 truth item.
    //   precision = 1/2 = 0.5, recall = 1/1 = 1
    // imageB: predicted Bananas only against 3 truth items (Bananas, Froot Loops, Rice Krispies).
    //   precision = 1/1 = 1, recall = 1/3 = 0.3333...
    // mean precision = (0.5 + 1) / 2 = 0.75
    // mean recall = (1 + 0.3333...) / 2 = 0.6666...
    const a = outcome.results[0];
    const b = outcome.results[1];
    expect(a.ok && a.score.precision).toBe(0.5);
    expect(a.ok && a.score.recall).toBe(1);
    expect(b.ok && b.score.precision).toBe(1);
    expect(b.ok && b.score.recall).toBeCloseTo(1 / 3);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain("mean precision 0.750, mean recall 0.667, over 2 image(s)");
    expect(outcome.reportMarkdown).toContain("mean precision 0.750, mean recall 0.667, over 2 image(s)");
  });

  it("excludes errored images from the mean's denominator in a mixed run", async () => {
    const recognize = vi.fn<Recognizer>();
    recognize.mockImplementationOnce(async () => census({ marks: [bananaMark] }));
    recognize.mockImplementationOnce(async () => census({ marks: [bananaMark] }));
    recognize.mockRejectedValueOnce(new Error("runCensus: OpenAI request failed (429 rate_limited)"));

    const truth = {
      "good1.jpg": [{ name: "Bananas", brand: null, qty: 1, occluded: false }],
      "good2.jpg": [
        { name: "Bananas", brand: null, qty: 1, occluded: false },
        { name: "Froot Loops", brand: "Kellogg's", qty: 1, occluded: false },
      ],
      "bad.jpg": [{ name: "Bananas", brand: null, qty: 1, occluded: false }],
    };
    const outcome = await runWithCollectors(
      ["good1.jpg", "good2.jpg", "bad.jpg"],
      truth,
      stubLoadImage,
      recognize,
    );

    // good1: predicted Bananas only, matches the single truth item exactly. precision 1, recall 1.
    // good2: predicted Bananas only against 2 truth items. precision 1, recall 0.5.
    // bad: errors before scoring, must not appear in the denominator at all.
    // If the denominator were files.length (3) instead of scoredCount (2), mean precision
    // would read 0.667 and mean recall 0.5 instead of the correct 1.000 and 0.750 below.
    expect(outcome.scoredCount).toBe(2);
    expect(outcome.erroredCount).toBe(1);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toContain(
      "mean precision 1.000, mean recall 0.750, over 2 image(s), 1 image(s) errored and were excluded",
    );
    expect(outcome.reportMarkdown).toContain(
      "mean precision 1.000, mean recall 0.750, over 2 image(s), 1 image(s) errored and were excluded",
    );
  });

  it("also excludes a file skipped for missing ground truth from the denominator, not only errored ones", async () => {
    const recognize = vi.fn<Recognizer>();
    recognize.mockImplementationOnce(async () =>
      census({ marks: [bananaMark, { ...froskMark, name: "Motor Oil", brand: "Castrol" }] }),
    );
    recognize.mockImplementationOnce(async () => census({ marks: [bananaMark] }));

    const truth = {
      "imageA.jpg": [{ name: "Bananas", brand: null, qty: 1, occluded: false }],
      "imageB.jpg": [
        { name: "Bananas", brand: null, qty: 1, occluded: false },
        { name: "Froot Loops", brand: "Kellogg's", qty: 1, occluded: false },
        { name: "Rice Krispies", brand: "Kellogg's", qty: 1, occluded: false },
      ],
    };
    // orphan.jpg has no ground truth entry at all: skipped, not scored, not errored. If the
    // mean's denominator were files.length (3) instead of scoredCount (2), this would silently
    // change the reported numbers exactly the way an errored image would, without any API
    // failure involved at all.
    const outcome = await runWithCollectors(
      ["imageA.jpg", "imageB.jpg", "orphan.jpg"],
      truth,
      stubLoadImage,
      recognize,
    );

    expect(outcome.scoredCount).toBe(2);
    expect(outcome.erroredCount).toBe(0);
    expect(outcome.stdout).toContain("mean precision 0.750, mean recall 0.667, over 2 image(s)");
  });
});

describe("runEval: streaming output", () => {
  it("emits and persists each image's result as soon as it finishes, not only after the whole corpus completes", async () => {
    const sequence: string[] = [];

    const loadImage = (file: string): Buffer => {
      sequence.push(`load:${file}`);
      return stubLoadImage();
    };
    const recognize = vi.fn<Recognizer>().mockImplementation(async () => {
      sequence.push("recognize:resolve");
      return census({ marks: [bananaMark], inViewCounts: [{ productKey: "::bananas", count: 1 }] });
    });
    const emit = (line: string, stream: "stdout" | "stderr") => {
      sequence.push(`emit:${stream}`);
    };
    const chunks: string[] = [];
    const writeResult = (chunk: string) => {
      sequence.push("write");
      chunks.push(chunk);
    };

    const truth = { "cart1.jpg": bananaTruth, "cart2.jpg": bananaTruth };
    await runEval(["cart1.jpg", "cart2.jpg"], truth, loadImage, recognize, writeResult, emit);

    // The header is written before any image is touched.
    expect(sequence[0]).toBe("write");

    // cart1.jpg's entire pipeline, load, recognize, emit its progress line, and persist its
    // section, completes before cart2.jpg's load is ever called. If results were buffered and
    // only flushed after the whole corpus finished (the bug this test guards against), every
    // load:*/recognize:resolve pair would happen first, back to back, with all emit/write
    // calls trailing at the very end instead of interleaved between them.
    const load1 = sequence.indexOf("load:cart1.jpg");
    const load2 = sequence.indexOf("load:cart2.jpg");
    const writesBetween = sequence
      .slice(load1, load2)
      .filter((event) => event === "write" || event === "emit:stdout").length;
    expect(load1).toBeGreaterThanOrEqual(0);
    expect(load2).toBeGreaterThan(load1);
    // Between cart1's load and cart2's load there must be at least one write (its per-image
    // section) and one stdout emit (its progress line), proving cart1 was fully flushed
    // before cart2 even started, not batched at the end.
    expect(writesBetween).toBeGreaterThanOrEqual(2);

    // The very last events are the closing summary's write and its stdout emits, after both
    // images have already been fully processed.
    expect(sequence[sequence.length - 1]).toBe("write");
    expect(sequence.lastIndexOf("write")).toBeGreaterThan(load2);

    // Three writes total: header, cart1, cart2, closing summary is a fourth.
    expect(chunks.length).toBe(4);
    expect(chunks[0]).toContain("# Eval");
    expect(chunks[1]).toContain("## cart1.jpg");
    expect(chunks[2]).toContain("## cart2.jpg");
    expect(chunks[3]).toContain("## Summary");
  });

  it("keeps a per-image error in its original position relative to the successes around it", async () => {
    const sequence: string[] = [];
    const recognize = vi.fn<Recognizer>();
    recognize.mockImplementationOnce(async () => {
      sequence.push("emit:good1");
      return census({ marks: [bananaMark] });
    });
    recognize.mockImplementationOnce(async () => {
      throw new Error("runCensus: OpenAI connection failed (ECONNRESET)");
    });
    recognize.mockImplementationOnce(async () => census({ marks: [bananaMark] }));

    const emit = (line: string, stream: "stdout" | "stderr") => {
      sequence.push(`${stream}:${line.split(" ")[0]}`);
    };
    const writeResult = () => {};

    const truth = { "good1.jpg": bananaTruth, "bad.jpg": bananaTruth, "good2.jpg": bananaTruth };
    await runEval(
      ["good1.jpg", "bad.jpg", "good2.jpg"],
      truth,
      stubLoadImage,
      recognize,
      writeResult,
      emit,
    );

    // The per-file emits must appear in file-processing order: good1, then bad (an error, on
    // stderr), then good2, exactly the interleaving a "collect everything, print all stdout
    // then all stderr" scheme would destroy.
    const perFileEmits = sequence.filter((e) => e.startsWith("stdout:good") || e.startsWith("stderr:bad"));
    expect(perFileEmits).toEqual(["stdout:good1.jpg", "stderr:bad.jpg", "stdout:good2.jpg"]);
  });

  it("produces a results file that, truncated at any point before the end, still reads as valid partial progress with no closing summary", async () => {
    // writeResult is called once for the header, once per image, and once for the closing
    // summary, each call a complete, independently flushable chunk (this is exactly what
    // main()'s real writer does with appendFileSync per call). That means a results file
    // truncated at any chunk boundary, the same shape a killed process would leave behind, is
    // never mid-sentence: it is simply missing whatever chunks had not been written yet. This
    // test captures the real chunk sequence runEval produces for a two-image run and checks
    // that a prefix of it (standing in for "the process died after the header and the first
    // image") is exactly that: the first image's real section present, the second image and
    // the closing summary genuinely absent, with the missing summary being the tell that the
    // run did not finish.
    const chunks: string[] = [];
    const writeResult = (chunk: string) => chunks.push(chunk);
    const recognize = vi.fn<Recognizer>().mockResolvedValue(census({ marks: [bananaMark] }));

    const truth = { "cart1.jpg": bananaTruth, "cart2.jpg": bananaTruth };
    await runEval(["cart1.jpg", "cart2.jpg"], truth, stubLoadImage, recognize, writeResult);

    expect(chunks.length).toBe(4); // header, cart1, cart2, closing summary
    const killedAfterFirstImage = chunks.slice(0, 2).join("");

    expect(killedAfterFirstImage).toContain("## cart1.jpg");
    expect(killedAfterFirstImage).not.toContain("## cart2.jpg");
    expect(killedAfterFirstImage).not.toContain("## Summary");

    // The full, uninterrupted file does have the closing summary, confirming its absence
    // above really is specific to the truncated prefix and not a bug in the assembly itself.
    expect(chunks.join("")).toContain("## Summary");
  });
});
