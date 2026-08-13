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
  needsCloserLook: false,
};

const froskMark = {
  id: 1,
  name: "Froot Loops",
  brand: "Kellogg's",
  size: null,
  category: "cereal",
  confidence: 0.9,
  needsCloserLook: false,
};

const bananaTruth: TruthItem[] = [{ name: "Bananas", brand: null, qty: 1, occluded: false }];

function stubLoadImage(): Buffer {
  return Buffer.from("fake-image-bytes");
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
    const outcome = await runEval([], {}, stubLoadImage, recognize);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.reportMarkdown).toBeNull();
    expect(outcome.scoredCount).toBe(0);
    expect(outcome.erroredCount).toBe(0);
    expect(recognize).not.toHaveBeenCalled();
    expect(outcome.stderr.join("\n")).toContain("No cart photos to evaluate");
  });

  it("exits 1 and never calls recognize when images exist but none have ground truth", async () => {
    const recognize = vi.fn<Recognizer>();
    const outcome = await runEval(["cart1.jpg"], {}, stubLoadImage, recognize);

    expect(outcome.exitCode).toBe(1);
    expect(recognize).not.toHaveBeenCalled();
    expect(outcome.stderr.join("\n")).toContain("cart1.jpg");
  });

  it("exits 1 and never calls recognize when ground truth exists but no image matches", async () => {
    const recognize = vi.fn<Recognizer>();
    const outcome = await runEval([], { "cart1.jpg": bananaTruth }, stubLoadImage, recognize);

    expect(outcome.exitCode).toBe(1);
    expect(recognize).not.toHaveBeenCalled();
    expect(outcome.stderr.join("\n")).toContain("cart1.jpg");
  });
});

describe("runEval: all images fail", () => {
  it("exits 1, reports zero scored and every image errored, writes no report", async () => {
    const recognize = vi.fn<Recognizer>().mockRejectedValue(new Error("runCensus: OpenAI request failed (401 invalid_api_key)"));
    const truth = { "cart1.jpg": bananaTruth, "cart2.jpg": bananaTruth };
    const outcome = await runEval(["cart1.jpg", "cart2.jpg"], truth, stubLoadImage, recognize);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.scoredCount).toBe(0);
    expect(outcome.erroredCount).toBe(2);
    expect(outcome.reportMarkdown).toBeNull();
    expect(outcome.stderr.some((l) => l.includes("cart1.jpg") && l.includes("ERROR"))).toBe(true);
    expect(outcome.stderr.some((l) => l.includes("cart2.jpg") && l.includes("ERROR"))).toBe(true);
    expect(outcome.stderr.join("\n")).toContain("All 2 evaluable image(s) failed");
  });

  it("never leaks anything key-shaped even though the error message here already came pre-redacted", async () => {
    const recognize = vi.fn<Recognizer>().mockRejectedValue(new Error("runCensus: OpenAI request failed (401 [redacted])"));
    const outcome = await runEval(["cart1.jpg"], { "cart1.jpg": bananaTruth }, stubLoadImage, recognize);
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
    const outcome = await runEval(["bad.jpg", "good.jpg"], truth, stubLoadImage, recognize);

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
    const outcome = await runEval(["cart1.jpg"], { "cart1.jpg": bananaTruth }, stubLoadImage, recognize);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.scoredCount).toBe(1);
    expect(outcome.erroredCount).toBe(0);
    expect(outcome.reportMarkdown).not.toBeNull();
  });

  it("skips a file with no ground truth entry, warns, and does not call loadImage or recognize for it", async () => {
    const recognize = vi.fn<Recognizer>().mockResolvedValue(census({ marks: [bananaMark] }));
    const loadImage = vi.fn(stubLoadImage);
    const truth = { "cart1.jpg": bananaTruth };
    const outcome = await runEval(["cart1.jpg", "orphan.jpg"], truth, loadImage, recognize);

    expect(outcome.exitCode).toBe(0);
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledWith("cart1.jpg");
    expect(outcome.stderr.some((l) => l.includes("skipping orphan.jpg"))).toBe(true);
  });

  it("passes the full-frame mark and a diagnostics object to recognize", async () => {
    const recognize = vi.fn<Recognizer>().mockResolvedValue(census({ marks: [bananaMark] }));
    await runEval(["cart1.jpg"], { "cart1.jpg": bananaTruth }, stubLoadImage, recognize);

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
    const outcome = await runEval(["cart1.jpg"], { "cart1.jpg": bananaTruth }, stubLoadImage, recognize);

    expect(outcome.stdout.join("\n")).toContain("Count accuracy");
    expect(outcome.reportMarkdown).toContain("## Count accuracy");
    expect(outcome.reportMarkdown).toContain("count accuracy:");
  });

  it("reflects an over-count (the shipped bug's shape) in the summary and the per-image section", async () => {
    const recognize = vi.fn<Recognizer>().mockResolvedValue(
      census({ marks: [bananaMark], inViewCounts: [{ productKey: "::bananas", count: 4 }] }),
    );
    const truth = { "cart1.jpg": [{ name: "Bananas", brand: null, qty: 1, occluded: false }] };
    const outcome = await runEval(["cart1.jpg"], truth, stubLoadImage, recognize);

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
    const outcome = await runEval(["cart1.jpg"], { "cart1.jpg": bananaTruth }, stubLoadImage, recognize);

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
    const outcome = await runEval(["cart1.jpg"], { "cart1.jpg": bananaTruth }, stubLoadImage, recognize);

    expect(outcome.stdout.join("\n").toLowerCase()).toContain("macro-averaged");
    expect(outcome.reportMarkdown?.toLowerCase()).toContain("macro-averaged");
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
    const outcome = await runEval(["cart1.jpg"], truth, stubLoadImage, recognize);

    const result = outcome.results[0];
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.score.recall).toBe(0.5);
      expect(result.visibleScore.recall).toBe(1);
    }
  });
});
