"use client";

import { useEffect, useRef, useState } from "react";

// Shared behavior for "Add another one" style forms:
//   • On successful submit, reset the form so the user can immediately
//     add another entry without re-scrolling / re-opening a disclosure.
//   • Surface a brief "Added ✓" chip that auto-dismisses after ~2s so
//     the user gets confirmation without having to read a message.
//
// The hook only knows whether the last submit succeeded — the caller
// derives that from useActionState's returned state.

export function useStayOpenForm<TState extends { ok?: boolean } | undefined>(
  state: TState,
  pending: boolean,
  isSuccess: (s: TState) => boolean
) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const lastHandledRef = useRef<TState>(state);

  useEffect(() => {
    if (pending) return;
    if (state === lastHandledRef.current) return;
    lastHandledRef.current = state;
    if (!isSuccess(state)) return;

    formRef.current?.reset();
    setConfirmationVisible(true);
    const timer = window.setTimeout(() => setConfirmationVisible(false), 2000);
    return () => window.clearTimeout(timer);
  }, [state, pending, isSuccess]);

  return { formRef, confirmationVisible };
}
