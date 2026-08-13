/**
 * Scores the census endpoint against the cart corpus.
 *
 * Runs with a single whole-image mark, so it measures the model's raw naming ability
 * independently of any detector. Once a real detector lands, feed its boxes in here instead
 * and the same score becomes an end-to-end number.
 *
 * Run: OPENAI_API_KEY=... npm run eval
 *
 * Precision and recall are macro-averaged: computed once per image, then averaged across
 * images. An image with three items and an image with thirty items count equally toward the
 * mean. That is a deliberate choice, not an oversight, pooling matched and predicted counts
 * across every image before dividing would weight the corpus by item count instead of by
 * photo, which is a different (and arguably less representative) number. If the corpus grows
 * lopsided, both readings are worth having; this file only prints the macro-averaged one.
 *
 * recognize.js (and transitively openai.js, which throws at import time if OPENAI_API_KEY is
 * unset) is imported dynamically, only after the corpus is confirmed non-empty. This is what
 * lets an empty corpus print a clean, actionable message and exit instead of crashing on a
 * missing key that would not even matter yet.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { scoreImage, type TruthItem, type PredictedItem, type ImageScore } from "./score.js";
import type { CensusDiagnostics } from "../src/recognize.js";
import type { CensusResponse } from "../src/schemas.js";

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

/**
 * Explains why there is nothing to evaluate and exactly what to do about it. Covers three
 * distinct empty states so the message is actually useful rather than a generic "corpus is
 * empty": no photos at all, photos with no matching ground truth, or ground truth entries
 * whose filenames do not match any photo on disk (most likely a typo).
 */
function emptyCorpusMessage(files: string[], truth: Record<string, TruthItem[]>): string {
  const truthKeys = Object.keys(truth);
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

  return lines.join("\n");
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

async function main(): Promise<void> {
  const truth = loadGroundTruth();
  const files = listImageFiles();
  const evaluable = files.filter((f) => truth[f] !== undefined);

  if (evaluable.length === 0) {
    console.error(emptyCorpusMessage(files, truth));
    process.exitCode = 1;
    return;
  }

  // Imported dynamically, and only now: recognize.js pulls in openai.js, which throws at
  // import time if OPENAI_API_KEY is unset. An empty corpus must never depend on that key
  // being present, which is why this import does not happen until we know there is at least
  // one image to actually run.
  const { runCensus } = await import("../src/recognize.js");

  mkdirSync(OUT, { recursive: true });

  let totalP = 0;
  let totalR = 0;
  let totalVisibleP = 0;
  let totalVisibleR = 0;
  let n = 0;
  let errored = 0;
  const report: string[] = [];

  for (const file of files) {
    const expected = truth[file];
    if (!expected) {
      console.warn(`skipping ${file}, no ground truth`);
      continue;
    }

    const image = readFileSync(join(IMAGES, file));
    const diagnostics: CensusDiagnostics = {
      repaired: [],
      plausiblyUnmarked: [],
      unrepaired: [],
      merged: [],
    };

    let census: CensusResponse;
    try {
      census = await runCensus(
        image,
        [{ id: 1, box: { x: 0, y: 0, w: 1, h: 1 } }],
        diagnostics,
      );
    } catch (err) {
      // toSafeError (recognize.ts) has already redacted anything key-shaped out of this
      // message, so it is safe to print. One image failing (a bad file, a dropped
      // connection, an expired key) does not lose the rest of the corpus's results.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${file}  ERROR  ${message}`);
      report.push(`## ${file}`, `error: ${message}`, "");
      errored += 1;
      continue;
    }

    const predicted: PredictedItem[] = [
      ...census.marks.map((m) => ({ name: m.name, brand: m.brand })),
      ...census.unmarkedItems.map((u) => ({ name: u.description, brand: null })),
    ];

    const s: ImageScore = scoreImage(predicted, expected);
    const visible = expected.filter((t) => !t.occluded);
    const sVisible: ImageScore = scoreImage(predicted, visible);

    totalP += s.precision;
    totalR += s.recall;
    totalVisibleP += sVisible.precision;
    totalVisibleR += sVisible.recall;
    n += 1;

    report.push(
      `## ${file}`,
      `precision ${s.precision.toFixed(2)}  recall ${s.recall.toFixed(2)}  (all ${expected.length} ground truth item(s))`,
      `precision ${sVisible.precision.toFixed(2)}  recall ${sVisible.recall.toFixed(2)}  (${visible.length} non-occluded item(s) only)`,
      `occlusion: ${census.occlusion.severity} (${census.occlusion.reason})`,
      `missed: ${s.missed.join(", ") || "none"}`,
      `hallucinated: ${s.hallucinated.join(", ") || "none"}`,
      formatDiagnostics(diagnostics),
      "",
    );
    console.log(`${file}  P ${s.precision.toFixed(2)}  R ${s.recall.toFixed(2)}`);
  }

  if (n === 0) {
    const message =
      errored > 0
        ? `All ${errored} evaluable image(s) failed with an error before producing a score. See above.`
        : "No image produced a score.";
    console.error(message);
    process.exitCode = 1;
    return;
  }

  const summary =
    `mean precision ${(totalP / n).toFixed(3)}, mean recall ${(totalR / n).toFixed(3)}, ` +
    `over ${n} image(s)` +
    (errored > 0 ? `, ${errored} image(s) errored and were excluded` : "");
  const visibleSummary =
    `visible-only (excluding occluded ground truth): mean precision ` +
    `${(totalVisibleP / n).toFixed(3)}, mean recall ${(totalVisibleR / n).toFixed(3)}`;

  console.log(`\n${summary}`);
  console.log(visibleSummary);

  writeFileSync(
    join(OUT, "latest.md"),
    `# Eval\n\n${summary}\n\n${visibleSummary}\n\n${report.join("\n")}`,
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`eval run failed: ${message}`);
  process.exitCode = 1;
});
