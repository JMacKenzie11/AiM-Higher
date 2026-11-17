"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CallSummaryRow } from "@/lib/hq/calls";
import { loadSessionPanelAction, type SessionPanelData } from "@/lib/hq/session-actions";
import { CallSummaries, CompanyChips } from "./CallSummaries";
import { SessionCard } from "./SessionCard";
import styles from "./hq.module.css";
import t from "./hq-tabs.module.css";

// The company chips, "Your next session" and Call summaries on Coach
// HQ's Coaching calls tab. Choosing a chip used to be a link that
// re-ran the whole page on the server (every company's numbers,
// commitments and activity) to change one card, and nothing on screen
// moved until it finished (Jason, 2026-11-17). Now the chip and the
// call list switch at once; only the session card is fetched
// (loadSessionPanelAction), with a placeholder while it comes, and is
// kept for the visit. Hovering a chip starts the fetch early.
//
// The company stays in the URL (?company=<id>#coaching-calls) through
// history.pushState, which Next keeps in step with useSearchParams, so
// Back, a pasted link and Prepare on the Companies tab all land on the
// same view. The server still renders the chosen company on a full
// load (initial), and a router.refresh (after Write the brief or Mark
// done) brings a fresh copy, which replaces the kept one.

export function CallsPanel({
  companies,
  rows,
  initial,
}: {
  companies: ReadonlyArray<{ id: string; name: string }>;
  rows: CallSummaryRow[];
  initial: SessionPanelData | null;
}) {
  const params = useSearchParams();
  const fromUrl = params.get("company");
  const selected = companies.find((c) => c.id === fromUrl) ?? null;

  const [cache, setCache] = useState<Record<string, SessionPanelData>>(() =>
    initial ? { [initial.companyId]: initial } : {}
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inFlight = useRef(new Set<string>());

  // A server render (full load or refresh) carries the newest data.
  useEffect(() => {
    if (initial) setCache((c) => ({ ...c, [initial.companyId]: initial }));
  }, [initial]);

  const fetchPanel = useCallback(
    (id: string) => {
      if (cache[id] || inFlight.current.has(id)) return;
      inFlight.current.add(id);
      setErrors(({ [id]: _drop, ...rest }) => rest);
      loadSessionPanelAction(id)
        .then((res) => {
          if (res.ok) setCache((c) => ({ ...c, [id]: res.data }));
          else setErrors((e) => ({ ...e, [id]: res.error }));
        })
        .catch(() => setErrors((e) => ({ ...e, [id]: "Couldn't load this company. Try again." })))
        .finally(() => inFlight.current.delete(id));
    },
    [cache]
  );

  useEffect(() => {
    if (selected) fetchPanel(selected.id);
  }, [selected, fetchPanel]);

  // Prepare on Your companies, or a link that names a company, opens
  // this tab on it: bring "Your next session" into view, once the tab
  // is showing (Jason, 2026-11-17). A chip click is already beside the
  // card, so it doesn't scroll.
  const sessionRef = useRef<HTMLDivElement | null>(null);
  const chipChosen = useRef(false);
  useEffect(() => {
    if (!selected) return;
    if (chipChosen.current) {
      chipChosen.current = false;
      return;
    }
    let frames = 0;
    let handle = 0;
    const tryScroll = () => {
      const el = sessionRef.current;
      if (el && el.offsetParent !== null) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (++frames < 120) handle = window.requestAnimationFrame(tryScroll);
    };
    handle = window.requestAnimationFrame(tryScroll);
    return () => window.cancelAnimationFrame(handle);
  }, [selected]);

  const choose = useCallback((id: string | null) => {
    chipChosen.current = true;
    const url = id ? `/hq?company=${encodeURIComponent(id)}#coaching-calls` : "/hq#coaching-calls";
    window.history.pushState(null, "", url);
  }, []);

  const chips = (
    <CompanyChips companies={companies} selectedId={selected?.id ?? null} onChoose={choose} onPrefetch={fetchPanel} />
  );

  if (!selected) {
    return (
      <CallSummaries
        rows={rows}
        title="Call summaries"
        showCompany
        chips={chips}
        hint="Choose a company to prepare your next session with it."
      />
    );
  }

  const data = cache[selected.id];
  const error = errors[selected.id];
  return (
    <>
      {chips}
      <div ref={sessionRef} className={t.sessionAnchor}>
      {data ? (
        <SessionCard key={selected.id} card={data.card} promises={data.promises} brief={data.brief} />
      ) : (
        <section className={`${styles.card} ${t.sessionCard}`} aria-busy={!error} aria-label={`Loading your next session with ${selected.name}`}>
          <h2 className={t.sessionTitle}>Your next session with {selected.name}</h2>
          {error ? (
            <p className={t.caption}>
              {error}{" "}
              <button type="button" className={t.textLinkButton} onClick={() => fetchPanel(selected.id)}>
                Try again
              </button>
            </p>
          ) : (
            <p className={t.caption}>Getting what&apos;s happened since your last call…</p>
          )}
        </section>
      )}
      </div>
      <CallSummaries
        rows={rows.filter((r) => r.companyId === selected.id)}
        title={`${selected.name} calls`}
        showCompany={false}
      />
    </>
  );
}
