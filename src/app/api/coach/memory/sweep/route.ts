import { NextRequest } from "next/server";
import { summarizeFinishedConversationsAction } from "@/lib/coach/memory-actions";

// The memory sweep, as a plain request rather than a server action
// (2026-11-14). Next runs a browser's server actions one at a time, so
// a sweep with conversations to read (up to three model calls) held
// up everything else the person did on the page: starting a
// conversation, renaming one, opening the panel. A request runs beside
// them. The work and its rules are unchanged (memory-actions.ts), and
// it still runs as the signed-in person, whose session the writes need.
export async function POST(req: NextRequest): Promise<Response> {
  let openConversationId: string | null = null;
  try {
    const body = (await req.json()) as { openConversationId?: unknown };
    if (typeof body.openConversationId === "string") openConversationId = body.openConversationId;
  } catch {
    // No body: sweep with nothing open.
  }
  const result = await summarizeFinishedConversationsAction(openConversationId);
  return Response.json(result);
}
