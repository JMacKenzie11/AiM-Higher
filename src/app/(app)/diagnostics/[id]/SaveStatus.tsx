"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { visitStepAction } from "@/lib/diagnostics/actions";
import type { DiagnosticStep } from "@/lib/diagnostics/steps";
import styles from "../diagnostics.module.css";

// ONE SAVE STATUS FOR A SCREEN (the guided screens; Jason, 2026-10-29).
// Every field and choice on a screen already saves itself, as the
// cursor leaves or as it is picked. Each reports here whether it is
// saving or holds unsaved typing, and the screen shows one status:
// Saving…, Unsaved changes, or Saved. Next and "Save and exit" wait for
// every save to land, so moving on never loses an entry.

type Report = { pending: boolean; dirty: boolean };
type Ctx = { report: (id: string, r: Report) => void; drop: (id: string) => void; status: "idle" | "saving" | "unsaved" | "saved" };

const SaveCtx = createContext<Ctx | null>(null);

export function SaveStatusProvider({ children }: { children: ReactNode }) {
  const [reports, setReports] = useState<Record<string, Report>>({});
  const [everSaved, setEverSaved] = useState(false);
  const report = useCallback((id: string, r: Report) => {
    setReports((cur) => {
      const was = cur[id];
      if (was && was.pending === r.pending && was.dirty === r.dirty) return cur;
      if (was?.pending && !r.pending) setEverSaved(true);
      return { ...cur, [id]: r };
    });
  }, []);
  const drop = useCallback((id: string) => {
    setReports((cur) => {
      if (!(id in cur)) return cur;
      const next = { ...cur };
      delete next[id];
      return next;
    });
  }, []);
  const all = Object.values(reports);
  const status = all.some((r) => r.pending) ? "saving" : all.some((r) => r.dirty) ? "unsaved" : everSaved ? "saved" : "idle";
  const value = useMemo(() => ({ report, drop, status }) as Ctx, [report, drop, status]);
  return <SaveCtx.Provider value={value}>{children}</SaveCtx.Provider>;
}

// For a field or an action: reports its state while mounted. A no-op
// outside a screen (the client page, the drawers' own pages).
export function useSaveReport(r: Report) {
  const ctx = useContext(SaveCtx);
  const id = useId();
  const report = ctx?.report;
  const drop = ctx?.drop;
  useEffect(() => {
    report?.(id, r);
  }, [report, id, r.pending, r.dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => drop?.(id), [drop, id]);
}

export function SaveBadge() {
  const ctx = useContext(SaveCtx);
  const status = ctx?.status ?? "idle";
  const label = { idle: "Saved", saving: "Saving…", unsaved: "Unsaved changes", saved: "Saved" }[status];
  return (
    <span role="status" className={styles.saveBadge} data-state={status}>
      {label}
    </span>
  );
}

// Back, "Save and exit to overview", and Next. Next into another step
// moves the diagnostic's status forward with it (visitStepAction), as
// the old step footer did; a refusal there (access not secured yet)
// still moves the screen, since nothing but Publish is locked.
export function ScreenFooter({
  diagnosticId,
  back,
  next,
  overview,
}: {
  diagnosticId: string;
  back: { href: string; label: string } | null;
  next: { href: string; label: string; step: DiagnosticStep; crossesStep: boolean } | null;
  overview: string;
}) {
  const ctx = useContext(SaveCtx);
  const router = useRouter();
  const [going, setGoing] = useState<string | null>(null);
  const crossing = useRef<{ step: DiagnosticStep } | null>(null);
  const saving = ctx?.status === "saving";

  useEffect(() => {
    if (!going || saving) return;
    const to = going;
    const cross = crossing.current;
    crossing.current = null;
    setGoing(null);
    void (async () => {
      if (cross) await visitStepAction(diagnosticId, cross.step).catch(() => null);
      router.push(to);
    })();
  }, [going, saving, diagnosticId, router]);

  const go = (href: string, cross?: DiagnosticStep) => {
    crossing.current = cross ? { step: cross } : null;
    setGoing(href);
  };

  return (
    <div className={styles.screenFooter}>
      {back ? (
        <button type="button" className={styles.secondary} onClick={() => go(back.href)} disabled={Boolean(going)}>
          Back
        </button>
      ) : (
        <span />
      )}
      <span className={styles.formRow}>
        {going && saving ? <span className={styles.status}>Saving first…</span> : null}
        <button type="button" className={styles.secondary} onClick={() => go(overview)} disabled={Boolean(going)}>
          Save and exit to overview
        </button>
        {next ? (
          <button type="button" className={styles.primary} onClick={() => go(next.href, next.crossesStep ? next.step : undefined)} disabled={Boolean(going)}>
            Next: {next.label}
          </button>
        ) : null}
      </span>
    </div>
  );
}
