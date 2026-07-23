"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Shared behavior for "Add another one" style forms:
//   • On successful submit, reset the form so the user can immediately
//     add another entry without re-scrolling / re-opening a disclosure.
//   • Surface a brief "Added ✓" chip that auto-dismisses after ~2s so
//     the user gets confirmation without having to read a message.
//   • Refresh the current route so the freshly-created row appears in
//     the surrounding server-rendered list without a full page reload.
//     revalidatePath on the server marks the cache stale, but only a
//     client-side navigation trigger actually re-fetches — this hook
//     calls router.refresh() so the list stays in sync.
//   • Optionally close the containing <details> (or any HTMLElement)
//     so cascade "modal" forms disappear once they've done their job.
//
// The hook only knows whether the last submit succeeded — the caller
// derives that from useActionState's returned state.

export function useStayOpenForm<TState extends { ok?: boolean } | undefined>(
  state: TState,
  pending: boolean,
  isSuccess: (s: TState) => boolean,
  options?: { closeAncestor?: string }
) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const lastHandledRef = useRef<TState>(state);

  useEffect(() => {
    if (pending) return;
    if (state === lastHandledRef.current) return;
    lastHandledRef.current = state;
    if (!isSuccess(state)) return;

    formRef.current?.reset();
    // Pick up the newly-created row from the server without a full
    // page reload (revalidatePath alone doesn't trigger a client
    // re-render).
    router.refresh();

    // Optional: fold the enclosing <details> so add-in-modal flows
    // close after a successful create. Callers pass a CSS selector
    // like "details" and we walk up from the form.
    if (options?.closeAncestor && formRef.current) {
      const ancestor = formRef.current.closest(options.closeAncestor);
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = false;
    }

    setConfirmationVisible(true);
    const timer = window.setTimeout(() => setConfirmationVisible(false), 2000);
    return () => window.clearTimeout(timer);
  }, [state, pending, isSuccess, router, options?.closeAncestor]);

  return { formRef, confirmationVisible };
}
