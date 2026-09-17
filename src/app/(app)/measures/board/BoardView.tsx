"use client";

import { useEffect, useMemo, useState } from "react";
import type { BoardData } from "@/lib/measures/board";
import { CockpitGrid } from "./CockpitGrid";
import { StoryTimeline } from "./StoryTimeline";
import styles from "./board.module.css";

type ViewMode = "cockpit" | "timeline";

const STORAGE_KEY = "measures-board-open";

export function BoardView({ data }: { data: BoardData }) {
  // Timeline is the default. The board only renders when Success
  // Tracking is on, and the question that surface answers is "how has
  // this been trending", which is the timeline's job. The grid is the
  // detail view you go to second.
  const [view, setView] = useState<ViewMode>("timeline");

  // OPEN by default, changed on the product owner's call after
  // watching somebody look for it.
  //
  // It was collapsed, on the reasoning that thirteen weeks across
  // every function is a once-a-month meeting artefact sitting above
  // the thing people open this page for weekly. That reasoning was
  // sound and the outcome was not: collapsed, understated, and at the
  // top of a page people scroll straight past, it read as a header
  // rather than a control. A chart nobody finds is worth less than
  // the inches it costs.
  //
  // This only renders when Success Tracking is on AND some function
  // has a metric, so open-by-default cannot greet anybody with an
  // empty frame.
  //
  // The choice is still remembered per person in this browser, in
  // both directions now: someone who closes it keeps it closed.
  // Reads can throw in a private window or with site data blocked,
  // and a failure then means open, which is the new default rather
  // than a surprise.
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "closed") setOpen(false);
    } catch {
      // Storage unavailable. Open is the right default anyway.
    }
  }, []);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "open" : "closed");
      } catch {
        // Not remembering the choice is survivable; failing is not.
      }
      return next;
    });
  }

  // Company-level headline stat — how many current-week metric
  // readings hit target across every function. Same math both
  // views agree on, so it's the anchor number regardless of tab.
  const headline = useMemo(() => summarize(data), [data]);

  // What the collapsed line says. Named functions rather than a count
  // of metrics, because "3 functions off target" is a sentence a
  // leader acts on and "7 of 34 readings" is one they have to decode.
  const offFunctions = useMemo(
    () =>
      data.functions.filter((fn) =>
        fn.metrics.some(
          (m) => m.cells[m.cells.length - 1]?.status === "off"
        )
      ).length,
    [data]
  );

  return (
    // A titled card, like every other block on the dashboard. The
    // title says what this is; the toggle beside it says which window
    // and how it is doing. Everything the board is made of is inside.
    <section className={styles.boardStage} aria-labelledby="board-card">
      <div className={styles.boardCardHead}>
        <h2 id="board-card" className={styles.boardCardTitle}>
          Measure performance
        </h2>
        <button
          type="button"
          className={styles.boardSummary}
          onClick={toggle}
          aria-expanded={open}
        >
          <span className={styles.boardSummaryCaret} aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          <span className={styles.boardSummaryTitle}>Last 13 weeks</span>
          <span
            className={
              offFunctions > 0
                ? styles.boardSummaryAlert
                : styles.boardSummaryCalm
            }
          >
            {offFunctions > 0
              ? `${offFunctions} function${offFunctions === 1 ? "" : "s"} off target this week`
              : headline.currentUnlogged > 0
                ? `${headline.currentUnlogged} not logged this week`
                : "Everything on target this week"}
          </span>
        </button>
      </div>

      {open ? (
      <>
      <header className={styles.boardHeader}>
        <div className={styles.headlineChips}>
          <HeadlineChip
            tone="good"
            label="Hit target this week"
            count={headline.currentGood}
            total={headline.currentEligible}
          />
          <HeadlineChip
            tone="off"
            label="Missed"
            count={headline.currentOff}
            total={headline.currentEligible}
          />
          <HeadlineChip
            tone="neutral"
            label="Not logged"
            count={headline.currentUnlogged}
            total={headline.currentEligible}
          />
        </div>
        <div className={styles.viewToggle} role="tablist" aria-label="Board view">
          <button
            type="button"
            role="tab"
            aria-selected={view === "cockpit"}
            className={
              view === "cockpit"
                ? `${styles.viewToggleButton} ${styles.viewToggleButtonActive}`
                : styles.viewToggleButton
            }
            onClick={() => setView("cockpit")}
          >
            Grid
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "timeline"}
            className={
              view === "timeline"
                ? `${styles.viewToggleButton} ${styles.viewToggleButtonActive}`
                : styles.viewToggleButton
            }
            onClick={() => setView("timeline")}
          >
            Timeline
          </button>
        </div>
      </header>

      {view === "cockpit" ? (
        <CockpitGrid data={data} />
      ) : (
        <StoryTimeline data={data} />
      )}
      </>
      ) : null}
    </section>
  );
}

function HeadlineChip({
  tone,
  label,
  count,
  total,
}: {
  tone: "good" | "off" | "neutral";
  label: string;
  count: number;
  total: number;
}) {
  return (
    <span className={`${styles.headlineChip} ${styles[`headlineChip_${tone}`]}`}>
      <span className={styles.headlineChipCount}>{count}</span>
      <span className={styles.headlineChipLabel}>
        {label} <span className={styles.headlineChipTotal}>/ {total}</span>
      </span>
    </span>
  );
}

function summarize(data: BoardData) {
  let currentGood = 0;
  let currentOff = 0;
  let currentUnlogged = 0;
  let currentEligible = 0;
  const currentIdx = data.weeks.length - 1;
  for (const fn of data.functions) {
    for (const m of fn.metrics) {
      const cell = m.cells[currentIdx];
      if (!cell) continue;
      if (cell.status === "no_target") continue;
      currentEligible += 1;
      if (cell.status === "good") currentGood += 1;
      else if (cell.status === "off") currentOff += 1;
      else if (cell.status === "unlogged") currentUnlogged += 1;
    }
  }
  return { currentGood, currentOff, currentUnlogged, currentEligible };
}
