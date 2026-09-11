/**
 * A stand-in for the Responses API's streamed answer, which the photo census reads as it arrives:
 * the text in small deltas, then the event that ends it. `hang` never ends, the way a connection
 * that stops sending does. `consumed` counts the events read, so a test can tell a stream that
 * was stopped from one read to its end.
 */
export interface FakeStream extends AsyncIterable<unknown> {
  consumed: number;
  total: number;
}

export function streamOf(
  text: string,
  end: { status?: "completed" | "incomplete"; reason?: string; hang?: boolean; usage?: Record<string, number> } = {},
): FakeStream {
  const events: unknown[] = [];
  for (let i = 0; i < text.length; i += 16) events.push({ type: "response.output_text.delta", delta: text.slice(i, i + 16) });
  const status = end.status ?? "completed";
  const response = {
    status,
    incomplete_details: status === "incomplete" ? { reason: end.reason ?? "max_output_tokens" } : null,
    usage: end.usage ?? { input_tokens: 5000, output_tokens: Math.ceil(text.length / 2) },
  };
  if (!end.hang) events.push({ type: `response.${status}`, response });
  const stream: FakeStream = {
    consumed: 0,
    total: events.length,
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        stream.consumed += 1;
        yield event;
      }
      if (end.hang) await new Promise(() => {});
    },
  };
  return stream;
}
