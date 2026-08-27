/**
 * Counts what every OpenAI call in this project spends, and prints the total when the process
 * ends.
 *
 * This exists because of a real bill. Development-time evaluation ran hundreds of calls across
 * model bakeoffs, prompt sweeps and repeat passes, and no harness could say what any of it cost:
 * of the nineteen harnesses in `server/eval/pipeline`, exactly one (`census-resolution.ts`)
 * recorded `usage.input_tokens`, and it recorded it into its own result file rather than
 * anywhere a reader would look. The spend was invisible until it appeared on the account.
 *
 * The shipped app has always had hard ceilings -- `MAX_CENSUS_CALLS_PER_SESSION` is 8 and
 * `MAX_IDENTIFY_CALLS_PER_SESSION` is 6, so one scan cannot exceed fourteen calls. Nothing
 * equivalent bounded or even observed the research path. This does not add a ceiling; a sweep
 * that needs 200 calls legitimately needs them. It removes the invisibility, which is the part
 * that let the cost accumulate unnoticed.
 *
 * Deliberately hooked at `requestOutputText` rather than in each harness. That one function is
 * the single point every `openai.responses.create` in this project passes through, so counting
 * there covers all nineteen harnesses, both API routes and any future caller without touching
 * them. A per-harness change would have to be repeated nineteen times and would be missing from
 * the twentieth.
 */

interface ModelUsage {
  calls: number;
  inputTokens: number;
  /**
   * The part of `inputTokens` that was served from OpenAI's prompt cache, and therefore billed at
   * a tenth of the uncached rate.
   *
   * Tracked separately because it is the difference between a census call costing what the
   * arithmetic says and costing 18% less, and because caching is silent: it is automatic, it
   * needs no parameter, and nothing in a response says it failed. A stable prefix of at least
   * 1,024 tokens is the requirement, and `CENSUS_SYSTEM_PROMPT` is 2,177 tokens sitting first in
   * the input, so this should be nonzero on every census call after the first. If it reads zero,
   * something ahead of the prompt is varying between calls and the discount is being lost.
   */
  cachedInputTokens: number;
  outputTokens: number;
}

const totals = new Map<string, ModelUsage>();

/**
 * Records one call.
 *
 * Both token counts are optional because the Responses API's `usage` is not guaranteed to be
 * present on every response shape, and a missing count must not throw inside the request path:
 * failing a census to preserve a statistic would be a strictly worse trade than under-counting.
 * A call whose usage is absent still increments `calls`, so the call count stays honest even
 * when the token counts under-report.
 */
export function recordUsage(
  model: string,
  input?: number,
  output?: number,
  cached?: number,
): void {
  const entry = totals.get(model)
    ?? { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  entry.calls += 1;
  entry.inputTokens += input ?? 0;
  entry.cachedInputTokens += cached ?? 0;
  entry.outputTokens += output ?? 0;
  totals.set(model, entry);
}

/** A copy, so a reader cannot mutate the running totals by holding onto the result. */
export function usageTotals(): Record<string, ModelUsage> {
  return Object.fromEntries([...totals].map(([model, u]) => [model, { ...u }]));
}

/** For a harness that wants a per-arm figure rather than a per-process one. */
export function resetUsage(): void {
  totals.clear();
}

export function formatUsage(): string {
  if (totals.size === 0) return "";
  const rows = [...totals]
    .sort((a, b) => b[1].inputTokens - a[1].inputTokens)
    .map(([model, u]) =>
      `[usage]   ${model.padEnd(18)} ${String(u.calls).padStart(5)} calls  ` +
      `${u.inputTokens.toLocaleString().padStart(12)} in  ` +
      `${u.cachedInputTokens.toLocaleString().padStart(12)} cached  ` +
      `${u.outputTokens.toLocaleString().padStart(10)} out`);
  const calls = [...totals.values()].reduce((n, u) => n + u.calls, 0);
  const input = [...totals.values()].reduce((n, u) => n + u.inputTokens, 0);
  const cached = [...totals.values()].reduce((n, u) => n + u.cachedInputTokens, 0);
  const output = [...totals.values()].reduce((n, u) => n + u.outputTokens, 0);
  return [
    `[usage] ${calls} OpenAI call${calls === 1 ? "" : "s"} this run`,
    ...rows,
    `[usage]   ${"total".padEnd(18)} ${String(calls).padStart(5)} calls  ` +
    `${input.toLocaleString().padStart(12)} in  ` +
    `${cached.toLocaleString().padStart(12)} cached  ` +
    `${output.toLocaleString().padStart(10)} out`,
    // Silence here is the failure mode worth naming. Caching needs no parameter and reports no
    // error, so a lost discount looks exactly like a working system that costs 18% more.
    cached === 0 && input > 0
      ? "[usage]   no prompt cache hits: check that nothing varies ahead of the system prompt"
      : `[usage]   ${(cached / input * 100).toFixed(0)}% of input served from cache`,
  ].join("\n");
}

/**
 * Prints on exit, to stderr.
 *
 * stderr rather than stdout because several harnesses write their results as JSON on stdout and
 * are piped into a file; a summary line on stdout would corrupt that. `exit` rather than a call
 * at the end of each harness for the same reason the hook lives here at all: a harness that
 * throws, or one written later, still reports what it spent.
 */
let installed = false;
export function installUsageReporter(): void {
  if (installed) return;
  installed = true;
  process.on("exit", () => {
    const summary = formatUsage();
    if (summary.length > 0) console.error(summary);
  });
}
