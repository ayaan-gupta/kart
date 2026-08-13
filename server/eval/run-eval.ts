/**
 * Scores the census endpoint against the cart corpus.
 *
 * Runs with a single whole-image mark, so it measures the model's raw naming ability
 * independently of any detector. Once a real detector lands, feed its boxes in here instead
 * and the same score becomes an end-to-end number.
 *
 * Run: OPENAI_API_KEY=... npm run eval
 *
 * Precision and recall (scoreImage, presence/absence) are macro-averaged: computed once per
 * image, then averaged across images. An image with three items and an image with thirty
 * items count equally toward the mean. That is a deliberate choice, not an oversight, pooling
 * matched and predicted counts across every image before dividing would weight the corpus by
 * item count instead of by photo, which is a different (and arguably less representative)
 * number. Both the console summary and eval/results/latest.md name this explicitly, so nobody
 * reading just the results file has to go find this comment to know which number they have.
 *
 * Count accuracy (scoreCounts, census.inViewCounts against ground truth qty) is a separate
 * measurement, reported in its own clearly labelled section, both per image and as a corpus
 * summary. It answers a different question than precision/recall: not "did the model report
 * this product", but "did it get the quantity right". The two can and do disagree, a product
 * can be correctly identified and badly counted, or missing entirely and irrelevant to count
 * accuracy.
 *
 * The orchestration logic below (describeCorpus, runEval) takes plain data and a recognizer
 * function as parameters and performs no filesystem or network I/O itself, so it is testable
 * with synthetic data and a stub recognizer; see test/run-eval.test.ts. main(), the only part
 * that touches disk, dynamic-imports, or process.exitCode, is a thin wrapper around it and
 * only runs when this file is executed directly, not when it is imported by a test.
 *
 * recognize.js (and transitively openai.js, which throws at import time if OPENAI_API_KEY is
 * unset) is imported dynamically, only after the corpus is confirmed non-empty. This is what
 * lets an empty corpus print a clean, actionable message and exit instead of crashing on a
 * missing key that would not even matter yet.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scoreImage,
  scoreCounts,
  type TruthItem,
  type PredictedItem,
  type PredictedCount,
  type ImageScore,
  type CountScore,
} from "./score.js";
import type { CensusDiagnostics } from "../src/recognize.js";
import type { CensusResponse } from "../src/schemas.js";
import type { Mark } from "../src/compositor.js";

const IMAGES = "eval/corpus/images";
const TRUTH = "eval/corpus/ground-truth.json";
const OUT = "eval/results";

function loadGroundTruth(): Record<string, TruthItem[]> {
  const raw = readFileSync(TRUTH, "utf8");
  return JSON.parse(raw) as Record<string, TruthItem[]>;
}

function listImageFiles(): string[] {
  return readdirSync(IMAGES).filter((f) => /\.(jpe?g|png)$/i.test(f));
}

// ---------------------------------------------------------------------------
// Pure orchestration logic. No fs/network calls below this line except inside main() and
// the loadImage/recognize functions main() passes in.
// ---------------------------------------------------------------------------

export type CorpusInfo = {
  files: string[];
  truthKeys: string[];
  /** Image files that have a matching ground truth entry: what the eval can actually run on. */
  evaluable: string[];
  imagesWithoutTruth: string[];
  truthWithoutImages: string[];
  /** Explains why there is nothing to evaluate. Always computed; only meant to be shown when
   * evaluable is empty. */
  emptyMessage: string;
};

/**
 * Explains why there is nothing to evaluate and exactly what to do about it. Covers three
 * distinct empty states so the message is actually useful rather than a generic "corpus is
 * empty": no photos at all, photos with no matching ground truth, or ground truth entries
 * whose filenames do not match any photo on disk (most likely a typo).
 */
export function describeCorpus(files: string[], truth: Record<string, TruthItem[]>): CorpusInfo {
  const truthKeys = Object.keys(truth);
  const evaluable = files.filter((f) => truth[f] !== undefined);
  const imagesWithoutTruth = files.filter((f) => truth[f] === undefined);
  const truthWithoutImages = truthKeys.filter((k) => !files.includes(k));

  const lines: string[] = [
    "No cart photos to evaluate. Nothing was scored.",
    "",
    `${IMAGES} has ${files.length} image file(s) (jpg, jpeg, or png).`,
    `${TRUTH} has ${truthKeys.length} ground truth entr${truthKeys.length === 1 ? "y" : "ies"}.`,
  ];

  if (imagesWithoutTruth.length > 0) {
    lines.push(
      "",
      `Image(s) with no ground truth entry: ${imagesWithoutTruth.join(", ")}`,
      `Add a matching entry to ${TRUTH}, keyed by the exact filename.`,
    );
  }

  if (truthWithoutImages.length > 0) {
    lines.push(
      "",
      `Ground truth entr${truthWithoutImages.length === 1 ? "y" : "ies"} with no matching image file: ${truthWithoutImages.join(", ")}`,
      `Check the filename spelling in ${TRUTH} against ${IMAGES}.`,
    );
  }

  lines.push(
    "",
    "To run a real eval:",
    `  1. Add cart photos (jpg or png) to ${IMAGES}.`,
    `  2. For each photo, add an entry to ${TRUTH} keyed by the exact filename. See`,
    "     server/eval/corpus/README.md for the labelling rules (name, brand, qty, occluded).",
    "  3. Set OPENAI_API_KEY and rerun: OPENAI_API_KEY=sk-... npm run eval",
  );

  return { files, truthKeys, evaluable, imagesWithoutTruth, truthWithoutImages, emptyMessage: lines.join("\n") };
}

function formatDiagnostics(diagnostics: CensusDiagnostics): string {
  const parts = [
    `repaired ${diagnostics.repaired.length}`,
    `plausiblyUnmarked ${diagnostics.plausiblyUnmarked.length}`,
    `unrepaired ${diagnostics.unrepaired.length}`,
    `merged ${diagnostics.merged.length}`,
  ];
  const lines = [`productKey diagnostics: ${parts.join(", ")}`];
  if (diagnostics.unrepaired.length > 0) {
    lines.push(
      "unrepaired inViewCounts keys (model produced a productKey matching no mark or " +
        "unmarked item in this response):",
    );
    for (const u of diagnostics.unrepaired) {
      lines.push(`  raw "${u.raw}" re-derived as "${u.canonical}"`);
    }
  }
  return lines.join("\n");
}

/** Per-image count accuracy, formatted for the report. Separate heading from precision/recall
 * on purpose, see the file-level comment on why these are two different measurements. */
function formatCountSection(cs: CountScore): string {
  return [
    "count accuracy: " +
      `${cs.exactMatches}/${cs.totalCompared} exact match(es), mean signed error ` +
      `${cs.totalCompared === 0 ? "n/a" : cs.meanSignedError.toFixed(2)}`,
    `over-counted: ${cs.overCounted.join(", ") || "none"}`,
    `under-counted: ${cs.underCounted.join(", ") || "none"}`,
    `missing from predicted (in ground truth, no inViewCounts entry): ${cs.missingFromPredicted.join(", ") || "none"}`,
    `missing from truth (in inViewCounts, no ground truth item): ${cs.missingFromTruth.join(", ") || "none"}`,
  ].join("\n");
}

export type Recognizer = (
  image: Buffer,
  marks: Mark[],
  diagnostics?: CensusDiagnostics,
) => Promise<CensusResponse>;

export type ImageResult =
  | {
      file: string;
      ok: true;
      score: ImageScore;
      visibleScore: ImageScore;
      countScore: CountScore;
      occlusionSeverity: string;
      occlusionReason: string;
      diagnostics: CensusDiagnostics;
    }
  | { file: string; ok: false; message: string };

export type EvalOutcome = {
  /**
   * 0: every evaluable image produced a score, no errors.
   * 1: total failure, nothing was scored (empty corpus, or every evaluable image errored).
   * 2: partial failure, at least one image scored and at least one errored. Results were
   *    still produced and written, but a CI check gating on exit code alone should not treat
   *    this the same as a clean run.
   */
  exitCode: 0 | 1 | 2;
  stdout: string[];
  stderr: string[];
  /** Content that should be written to eval/results/latest.md, or null when nothing meaningful
   * was produced and writing a results file would only be a stale, misleading artifact. */
  reportMarkdown: string | null;
  results: ImageResult[];
  scoredCount: number;
  erroredCount: number;
};

/**
 * Runs the corpus through `recognize` and scores every result, entirely in memory: no
 * filesystem or network access happens in this function itself, `loadImage` and `recognize`
 * are the only places that could do either, and tests pass stubs for both. This is what makes
 * the empty-corpus message, the partial-corpus warnings, the per-image error handling, the
 * exit code scheme, and the count-accuracy section all independently testable without a real
 * corpus directory or a real OpenAI key.
 */
export async function runEval(
  files: string[],
  truth: Record<string, TruthItem[]>,
  loadImage: (file: string) => Buffer,
  recognize: Recognizer,
): Promise<EvalOutcome> {
  const corpus = describeCorpus(files, truth);

  if (corpus.evaluable.length === 0) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: [corpus.emptyMessage],
      reportMarkdown: null,
      results: [],
      scoredCount: 0,
      erroredCount: 0,
    };
  }

  const stdout: string[] = [];
  const stderr: string[] = [];
  const results: ImageResult[] = [];
  const reportSections: string[] = [];

  let totalP = 0;
  let totalR = 0;
  let totalVisibleP = 0;
  let totalVisibleR = 0;
  let scoredCount = 0;
  let erroredCount = 0;

  let countImagesWithComparisons = 0;
  let sumExactMatchRate = 0;
  let sumMeanSignedError = 0;
  let totalOverCounted = 0;
  let totalUnderCounted = 0;
  let totalMissingFromPredicted = 0;
  let totalMissingFromTruth = 0;

  for (const file of files) {
    const expected = truth[file];
    if (!expected) {
      stderr.push(`skipping ${file}, no ground truth`);
      continue;
    }

    const image = loadImage(file);
    const diagnostics: CensusDiagnostics = {
      repaired: [],
      plausiblyUnmarked: [],
      unrepaired: [],
      merged: [],
    };

    let census: CensusResponse;
    try {
      census = await recognize(image, [{ id: 1, box: { x: 0, y: 0, w: 1, h: 1 } }], diagnostics);
    } catch (err) {
      // toSafeError (recognize.ts) redacts anything key-shaped from an OpenAI request
      // failure before it becomes err.message, so this is safe to print. One image failing
      // (a bad file, a dropped connection, an expired key) does not lose the rest of the
      // corpus's results, and the run's exit code (see below) still reflects the failure.
      const message = err instanceof Error ? err.message : String(err);
      stderr.push(`${file}  ERROR  ${message}`);
      reportSections.push(`## ${file}`, `error: ${message}`, "");
      erroredCount += 1;
      results.push({ file, ok: false, message });
      continue;
    }

    const predicted: PredictedItem[] = [
      ...census.marks.map((m) => ({ name: m.name, brand: m.brand })),
      ...census.unmarkedItems.map((u) => ({ name: u.description, brand: null })),
    ];
    const predictedCounts: PredictedCount[] = census.inViewCounts;

    const s = scoreImage(predicted, expected);
    const visible = expected.filter((t) => !t.occluded);
    const sVisible = scoreImage(predicted, visible);
    const cs = scoreCounts(predictedCounts, expected);

    totalP += s.precision;
    totalR += s.recall;
    totalVisibleP += sVisible.precision;
    totalVisibleR += sVisible.recall;
    scoredCount += 1;

    if (cs.totalCompared > 0) {
      countImagesWithComparisons += 1;
      sumExactMatchRate += cs.exactMatches / cs.totalCompared;
      sumMeanSignedError += cs.meanSignedError;
    }
    totalOverCounted += cs.overCounted.length;
    totalUnderCounted += cs.underCounted.length;
    totalMissingFromPredicted += cs.missingFromPredicted.length;
    totalMissingFromTruth += cs.missingFromTruth.length;

    results.push({
      file,
      ok: true,
      score: s,
      visibleScore: sVisible,
      countScore: cs,
      occlusionSeverity: census.occlusion.severity,
      occlusionReason: census.occlusion.reason,
      diagnostics,
    });

    reportSections.push(
      `## ${file}`,
      `precision ${s.precision.toFixed(2)}  recall ${s.recall.toFixed(2)}  (all ${expected.length} ground truth item(s))`,
      `precision ${sVisible.precision.toFixed(2)}  recall ${sVisible.recall.toFixed(2)}  (${visible.length} non-occluded item(s) only)`,
      `occlusion: ${census.occlusion.severity} (${census.occlusion.reason})`,
      `missed: ${s.missed.join(", ") || "none"}`,
      `hallucinated: ${s.hallucinated.join(", ") || "none"}`,
      formatCountSection(cs),
      formatDiagnostics(diagnostics),
      "",
    );
    stdout.push(`${file}  P ${s.precision.toFixed(2)}  R ${s.recall.toFixed(2)}`);
  }

  if (scoredCount === 0) {
    const message =
      erroredCount > 0
        ? `All ${erroredCount} evaluable image(s) failed with an error before producing a score. See above.`
        : "No image produced a score.";
    stderr.push(message);
    return { exitCode: 1, stdout, stderr, reportMarkdown: null, results, scoredCount, erroredCount };
  }

  const exitCode: 0 | 2 = erroredCount > 0 ? 2 : 0;

  const summary =
    `mean precision ${(totalP / scoredCount).toFixed(3)}, mean recall ${(totalR / scoredCount).toFixed(3)}, ` +
    `over ${scoredCount} image(s)` +
    (erroredCount > 0 ? `, ${erroredCount} image(s) errored and were excluded` : "");
  const exitCodeNote =
    "Exit codes: 0 means a clean run, every evaluable image scored with zero errors. 1 means " +
    "a total failure, an empty corpus or every evaluable image errored; no results file is " +
    "written for exit code 1, so a file existing at all means the run did not exit 1. 2 means " +
    "a partial failure, at least one image scored and at least one errored; the results below " +
    `are real but incomplete. This run's exit code: ${exitCode}.`;
  const methodNote =
    "Averaging method: macro-averaged, the mean of each image's own precision and recall. " +
    "An image with many ground truth items counts the same as an image with few. This is not " +
    "pooled across every item in the corpus, which would give a different number on a corpus " +
    "with lopsided item counts per photo.";
  const visibleSummary =
    "visible-only (excluding occluded ground truth): mean precision " +
    `${(totalVisibleP / scoredCount).toFixed(3)}, mean recall ${(totalVisibleR / scoredCount).toFixed(3)}`;

  const countSummaryLines = [
    "## Count accuracy",
    "",
    "Compares census.inViewCounts against ground truth qty. This is a separate measurement " +
      "from the precision and recall above: a product can be correctly identified (scored " +
      "above) while its count is wrong (scored here), and vice versa.",
    "",
    countImagesWithComparisons > 0
      ? `mean exact-match rate ${(sumExactMatchRate / countImagesWithComparisons).toFixed(3)}, ` +
        `mean signed error ${(sumMeanSignedError / countImagesWithComparisons).toFixed(3)} ` +
        "(positive means the model over-counts on average, negative means it under-counts), " +
        `over ${countImagesWithComparisons} image(s) with at least one comparable product key`
      : "no image had a product key present in both ground truth and inViewCounts, so no " +
        "count accuracy could be measured",
    `total over-counted product instances: ${totalOverCounted}`,
    `total under-counted product instances: ${totalUnderCounted}`,
    `total missing from predicted (ground truth had a qty, model reported no inViewCounts entry): ${totalMissingFromPredicted}`,
    `total missing from truth (model reported an inViewCounts entry not in ground truth): ${totalMissingFromTruth}`,
  ];

  stdout.push("", summary, methodNote, visibleSummary, ...countSummaryLines);

  const reportMarkdown = [
    "# Eval",
    "",
    summary,
    "",
    exitCodeNote,
    "",
    methodNote,
    "",
    visibleSummary,
    "",
    countSummaryLines.join("\n"),
    "",
    reportSections.join("\n"),
  ].join("\n");

  return { exitCode, stdout, stderr, reportMarkdown, results, scoredCount, erroredCount };
}

// ---------------------------------------------------------------------------
// Entry point. Only main() touches the filesystem outside of loadImage/recognize, only
// main() dynamic-imports recognize.js, and it only runs when this file is executed directly.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const truth = loadGroundTruth();
  const files = listImageFiles();
  const corpus = describeCorpus(files, truth);

  if (corpus.evaluable.length === 0) {
    console.error(corpus.emptyMessage);
    process.exitCode = 1;
    return;
  }

  // Imported dynamically, and only now: recognize.js pulls in openai.js, which throws at
  // import time if OPENAI_API_KEY is unset. An empty corpus must never depend on that key
  // being present, which is why this import does not happen until we know there is at least
  // one image to actually run.
  const { runCensus } = await import("../src/recognize.js");

  const outcome = await runEval(files, truth, (file) => readFileSync(join(IMAGES, file)), runCensus);

  for (const line of outcome.stdout) console.log(line);
  for (const line of outcome.stderr) console.error(line);

  if (outcome.reportMarkdown !== null) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "latest.md"), outcome.reportMarkdown);
  }

  process.exitCode = outcome.exitCode;
}

const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`eval run failed: ${message}`);
    process.exitCode = 1;
  });
}
