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
 * Output is streamed, not buffered. A real run calls a paid API once per photo across a
 * corpus that can run to ten or twenty images, taking minutes, so two things matter: progress
 * has to be visible while it happens, and a run killed partway must not lose everything paid
 * for already. Two things are injected into runEval to make that possible without losing
 * testability: `emit` (console-shaped, one line at a time, per-file success and error lines
 * interleaved in the order they actually happen, defaults to the real console so production
 * needs no wiring) and `writeResult` (disk-shaped, one markdown chunk at a time, appended as
 * each image finishes, required rather than defaulted since main() has to prepare the file
 * first). Tests pass collectors for both and assert on order and content; production passes a
 * real file-appending writer and lets emit default to the real console. Neither runEval nor
 * describeCorpus performs any other filesystem or network access, so both stay testable with
 * synthetic data and a stub recognizer; see test/run-eval.test.ts.
 *
 * recognize.js (and transitively openai.js, which throws at import time if OPENAI_API_KEY is
 * unset) is imported dynamically, only after the corpus is confirmed non-empty. This is what
 * lets an empty corpus print a clean, actionable message and exit instead of crashing on a
 * missing key that would not even matter yet.
 */
import { readFileSync, readdirSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
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
// the loadImage/recognize/writeResult functions main() passes in.
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

/** One line of live progress. `stream` mirrors console.log/console.error: "stdout" for normal
 * progress, "stderr" for warnings and per-image errors. The default emitter (see defaultEmit
 * below) sends each straight to the real console, immediately, as it is produced; tests pass
 * a collector instead to assert on order and content without touching the real console. */
export type Emit = (line: string, stream: "stdout" | "stderr") => void;

const defaultEmit: Emit = (line, stream) => {
  if (stream === "stdout") console.log(line);
  else console.error(line);
};

/** Appends one markdown chunk to the results file, immediately, as soon as it is ready. No
 * default: main() has to create/truncate the file before the first call, so callers must
 * supply this explicitly, the same way loadImage and recognize are explicit. */
export type ResultsWriter = (chunk: string) => void;

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
  /** Everything sent to `emit` with stream "stdout", in emission order. A courtesy copy for
   * callers that want to inspect content after the run finishes; the real, live output during
   * the run happens through `emit`, not through this array. */
  stdout: string[];
  /** Same as `stdout` but for stream "stderr". */
  stderr: string[];
  /** The exact concatenation of every chunk passed to `writeResult`, in write order, so it
   * matches on-disk content exactly. Non-null whenever at least one image was attempted
   * (evaluable.length > 0), including a run where every image errored: that case still writes
   * a file, ending in a total-failure note instead of real numbers, since durability matters
   * more than an all-or-nothing artifact once real work (a paid API call) was attempted. Null
   * only for a fully empty corpus, where nothing was attempted and writeResult is never
   * called at all. */
  reportMarkdown: string | null;
  results: ImageResult[];
  scoredCount: number;
  erroredCount: number;
};

function chunkOf(lines: string[]): string {
  return lines.join("\n") + "\n\n";
}

/**
 * Runs the corpus through `recognize` and scores every result. `loadImage`, `recognize`,
 * `writeResult`, and (when overridden) `emit` are the only places this function touches
 * anything outside its own arguments, so tests can observe and control all of it with plain
 * stub functions, no real files, no real network, and no real console.
 *
 * Per-image progress streams as it happens: `emit` is called for each image's result line the
 * moment that image finishes (success or error), in the same order the images were processed
 * in, so a per-image error is never reordered relative to the successes around it the way a
 * "collect everything, print all stdout then all stderr" scheme would. `writeResult` is called
 * the same way, once for a header before the loop starts, once per image as it completes, and
 * once for a closing summary after the loop ends, so a process killed partway through leaves
 * every already-completed image's section on disk; only the closing summary, written last, is
 * lost, and its absence is exactly the signal that the run did not finish (see the header
 * chunk written below for how this is explained to a reader of the file itself).
 */
export async function runEval(
  files: string[],
  truth: Record<string, TruthItem[]>,
  loadImage: (file: string) => Buffer,
  recognize: Recognizer,
  writeResult: ResultsWriter,
  emit: Emit = defaultEmit,
): Promise<EvalOutcome> {
  const corpus = describeCorpus(files, truth);

  if (corpus.evaluable.length === 0) {
    emit(corpus.emptyMessage, "stderr");
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
  const chunks: string[] = [];
  const results: ImageResult[] = [];

  function send(line: string, stream: "stdout" | "stderr"): void {
    emit(line, stream);
    (stream === "stdout" ? stdout : stderr).push(line);
  }

  function persist(lines: string[]): void {
    const text = chunkOf(lines);
    writeResult(text);
    chunks.push(text);
  }

  persist([
    "# Eval",
    "",
    "Exit codes: 0 means a clean run, every evaluable image scored with zero errors. 1 means " +
      "a total failure. An empty corpus never reaches this file at all, nothing is written " +
      "for that case. Every evaluable image erroring does still write this file, ending in a " +
      "total-failure note instead of real numbers. 2 means a partial failure, at least one " +
      "image scored and at least one errored; the closing summary's numbers only cover the " +
      "images that actually scored.",
    "",
    "Sections below appear in the order each image finishes, which is completion order, not " +
      "necessarily file order, and each is written to disk as soon as it is ready, so an " +
      "interrupted run keeps whatever completed before it stopped. The closing summary " +
      "section is written last, only once every evaluable image has been attempted. If this " +
      "file ends right after a per-image section with no summary section beneath it, the run " +
      "was interrupted before finishing.",
  ]);

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
      send(`skipping ${file}, no ground truth`, "stderr");
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
      // failure before it becomes err.message, so this is safe to print and persist. One
      // image failing (a bad file, a dropped connection, an expired key) does not lose the
      // rest of the corpus's results: its error section is written immediately, and the loop
      // continues to the next file.
      const message = err instanceof Error ? err.message : String(err);
      send(`${file}  ERROR  ${message}`, "stderr");
      persist([`## ${file}`, `error: ${message}`]);
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

    persist([
      `## ${file}`,
      `precision ${s.precision.toFixed(2)}  recall ${s.recall.toFixed(2)}  (all ${expected.length} ground truth item(s))`,
      `precision ${sVisible.precision.toFixed(2)}  recall ${sVisible.recall.toFixed(2)}  (${visible.length} non-occluded item(s) only)`,
      `occlusion: ${census.occlusion.severity} (${census.occlusion.reason})`,
      `missed: ${s.missed.join(", ") || "none"}`,
      `hallucinated: ${s.hallucinated.join(", ") || "none"}`,
      formatCountSection(cs),
      formatDiagnostics(diagnostics),
    ]);
    send(`${file}  P ${s.precision.toFixed(2)}  R ${s.recall.toFixed(2)}`, "stdout");
  }

  if (scoredCount === 0) {
    const message = `All ${erroredCount} evaluable image(s) failed with an error before producing a score. See above.`;
    send(message, "stderr");
    persist(["## Summary", "", message, "", "This run's exit code: 1."]);
    return {
      exitCode: 1,
      stdout,
      stderr,
      reportMarkdown: chunks.join(""),
      results,
      scoredCount,
      erroredCount,
    };
  }

  const exitCode: 0 | 2 = erroredCount > 0 ? 2 : 0;

  const summary =
    `mean precision ${(totalP / scoredCount).toFixed(3)}, mean recall ${(totalR / scoredCount).toFixed(3)}, ` +
    `over ${scoredCount} image(s)` +
    (erroredCount > 0 ? `, ${erroredCount} image(s) errored and were excluded` : "");
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

  send("", "stdout");
  for (const line of [summary, methodNote, visibleSummary, ...countSummaryLines]) {
    send(line, "stdout");
  }

  persist([
    "## Summary",
    "",
    summary,
    "",
    `This run's exit code: ${exitCode}. (0 means clean, 1 means total failure, 2 means ` +
      "partial failure; see the top of this file for the full explanation of each.)",
    "",
    methodNote,
    "",
    visibleSummary,
    "",
    countSummaryLines.join("\n"),
  ]);

  return { exitCode, stdout, stderr, reportMarkdown: chunks.join(""), results, scoredCount, erroredCount };
}

// ---------------------------------------------------------------------------
// Entry point. Only main() touches the filesystem outside of loadImage/recognize/writeResult,
// only main() dynamic-imports recognize.js, and it only runs when this file is executed
// directly.
// ---------------------------------------------------------------------------

function makeFileResultsWriter(path: string): ResultsWriter {
  return (chunk: string) => {
    appendFileSync(path, chunk);
  };
}

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

  mkdirSync(OUT, { recursive: true });
  const resultsPath = join(OUT, "latest.md");
  // Start this run's file empty. Every write from here on, including the very first one
  // inside runEval, is an append, so the file grows durably as the run progresses rather than
  // being assembled in memory and written once at the end.
  writeFileSync(resultsPath, "");
  const writeResult = makeFileResultsWriter(resultsPath);

  // emit is left at its default (the real console), so per-image progress prints live as
  // runEval produces it; main() does not need to loop over any buffered output afterward.
  const outcome = await runEval(
    files,
    truth,
    (file) => readFileSync(join(IMAGES, file)),
    runCensus,
    writeResult,
  );

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
