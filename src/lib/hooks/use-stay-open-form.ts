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
//   • Optionally call back when the create succeeded, for a host that
//     is not a <details> — the plan toolbar's Drawer. It fires AFTER
//     router.refresh(), which is the whole reason it is a callback
//     here rather than something the caller derives from `state`: the
//     refresh has to be requested before the host reacts to the
//     success, never after.
//
// The hook only knows whether the last submit succeeded — the caller
// derives that from useActionState's returned state.

export function useStayOpenForm<TState extends { ok?: boolean } | undefined>(
  state: TState,
  pending: boolean,
  isSuccess: (s: TState) => boolean,
  options?: { closeAncestor?: string; onSuccess?: () => void }
) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [confirmationVisible, setConfirmationVisible] = useState(false);

  // Key the effect on the success-carrying state itself rather than a
  // ref-based "have we handled this?" guard. The ref guard was subtly
  // wrong under React strict mode: cleanup would clear the auto-hide
  // timer, and the second effect invocation would short-circuit
  // because the ref had already been updated — leaving the chip stuck
  // visible until the next form submission. Using a stable dep that
  // changes on each new success (or flips to null on failure/idle)
  // lets React's own dedup handle re-runs correctly.
  const successKey = pending || !isSuccess(state) ? null : state;

  useEffect(() => {
    if (!successKey) return;

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

    // After the refresh, never before. A host that closes on this is
    // closing a form whose refresh is already on its way.
    options?.onSuccess?.();

    setConfirmationVisible(true);
    const timer = window.setTimeout(() => setConfirmationVisible(false), 2000);
    return () => window.clearTimeout(timer);
    // options.onSuccess is deliberately NOT a dependency. Callers
    // pass an inline arrow, so a new identity arrives on every render
    // and depending on it would re-run this effect — resetting the
    // form and firing a second refresh — for every unrelated
    // re-render while a success is on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [successKey, router, options?.closeAncestor]);

  return { formRef, confirmationVisible };
}
