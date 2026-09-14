import { NextResponse } from "next/server";
import {
  deleteAllMyMemoriesAction,
  deleteMyMemoriesForConversationAction,
} from "@/lib/coach/memory-actions";

// DELETE the caller's own coach memories for one conversation.
//
// A real capability, not a test backdoor: deleting memory is the
// subject's right, granted by the DELETE policy on coach_memories in
// migration 0194, and this is the mechanism. Part 3 builds the
// see-and-delete UI on top of it; today its only caller is the E2E
// that proves the memory loop, which is required to clean up after
// itself because it writes real rows on the dev clone.
//
// It can only ever delete the CALLER'S OWN rows. The action runs on
// the caller's client and the policy admits `profile_id = auth.uid()`
// and nothing else, so there is no request shape — authenticated or
// otherwise — that reaches somebody else's memory.
export async function POST(request: Request): Promise<Response> {
  let body: { conversationId?: unknown; all?: unknown };
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // `{ all: true }` is the promise part 3 publishes — delete
  // everything she remembers about you. Bounded to the caller by RLS,
  // not by this branch.
  if (body.all === true) {
    const all = await deleteAllMyMemoriesAction();
    return NextResponse.json(all, { status: all.ok ? 200 : 400 });
  }

  const conversationId = body.conversationId;
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const result = await deleteMyMemoriesForConversationAction(conversationId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
