import type { CoachingMessage } from "@/lib/coach/service";

// The coach route's server-sent events: ready, delta, tool, truncated,
// error, done. One encoder and the two short responses that are not a
// model turn (a saved opener sent back, a configuration error).

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
} as const;

export function encodeEvent(event: string, data: unknown): Uint8Array {
  const payload =
    typeof data === "string" ? data : JSON.stringify(data);
  return new TextEncoder().encode(`event: ${event}\ndata: ${payload}\n\n`);
}

// A message already saved, sent in the same shape as a fresh reply,
// so the chat shows it exactly as if it had just been written.
export function streamSavedMessage(row: CoachingMessage): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodeEvent("delta", { text: row.content }));
      controller.enqueue(encodeEvent("done", { assistantMessageId: row.id, usage: null }));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: SSE_HEADERS,
  });
}

export function streamErrorResponse(message: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodeEvent("error", { message }));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: SSE_HEADERS,
  });
}
