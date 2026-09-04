"use client";

import { useMemo, useState } from "react";
import type { BoardData } from "@/lib/measures/board";
import { CockpitGrid } from "./CockpitGrid";
import { StoryTimeline } from "./StoryTimeline";
import styles from "./board.module.css";

type ViewMode = "cockpit" | "timeline";

export function BoardView({ data }: { data: BoardData }) {
  // Timeline is the default. The board only renders when Success
  // Tracking is on, and the question that surface answers is "how has
  // this been trending", which is the timeline's job. The grid is the
  // detail view you go to second.
  const [view, setView] = useState<ViewMode>("timeline");

  // Company-level headline stat — how many current-week metric
  // readings hit target across every function. Same math both
  // views agree on, so it's the anchor number regardless of tab.
  const headline = useMemo(() => summarize(data), [data]);

  return (
    <div className={styles.boardStage}>
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
    </div>
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
