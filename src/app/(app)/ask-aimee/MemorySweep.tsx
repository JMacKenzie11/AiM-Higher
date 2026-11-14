"use client";

import { useEffect, useRef } from "react";

// The write-after trigger: coaching-surface entry.
//
// Fires once on mount, for the caller's finished general-mode
// conversations EXCLUDING the one being opened. Renders nothing.
//
// CLIENT-SIDE ON PURPOSE, following the auto-title precedent in
// ChatView: summarization makes a model call, and a server component
// awaiting it would hold the page render behind somebody else's
// conversation being distilled. Firing from the client keeps the
// request as the caller's — which the write path requires, since
// record_coach_memory raises when auth.uid() is null — without
// putting a model call in front of the paint.
//
// Failures are swallowed deliberately. A person opening Ask Aimee is
// not doing anything about memory and should never be told that a
// background distillation of a conversation from last week did not
// work. The action logs; this does not surface.
export function MemorySweep({
  openConversationId,
}: {
  openConversationId: string | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    // A request, not a server action: actions run one at a time, and a
    // sweep with work to do held up everything else on the page
    // (api/coach/memory/sweep). keepalive lets it finish if the person
    // moves on.
    void fetch("/api/coach/memory/sweep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openConversationId }),
      keepalive: true,
    }).catch(() => {
      // Intentionally silent. See above.
    });
  }, [openConversationId]);
  return null;
}
