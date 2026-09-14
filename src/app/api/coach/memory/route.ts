import { NextResponse } from "next/server";
import { deleteMyMemoriesForConversationAction } from "@/lib/coach/memory-actions";

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
  let conversationId: unknown;
  try {
    conversationId = (await request.json())?.conversationId;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const result = await deleteMyMemoriesForConversationAction(conversationId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
