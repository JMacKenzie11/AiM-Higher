import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  loadCompanyScorecard,
  trajectoryFor,
  overallTrajectory,
} from "@/lib/maturity/service";
import { DISCIPLINES } from "@/lib/maturity/disciplines";
import type { ChartFunctionIssue } from "@/lib/maturity/scorers/chart";
import { Sparkline } from "./Sparkline";
import { formatShortDate } from "@/lib/dates";
import styles from "./scorecard.module.css";

// AiMS Scorecard — company-wide discipline maturity view.
//
// Visible to every signed-in member of the company (transparency by
// design — everyone sees the same view leaders do). The score is
// computed LIVE on every page load so a change in behavior shows up
// today, not next Sunday when the cron runs; the historical
// timeseries lines come from company_discipline_snapshots.
//
// This route previously redirected to /chart (see git history for
// the /scorecard → /chart migration). Repurposing the URL for the
// AiMS Scorecard because the old redirect stub was the only thing
// living here — no live callers to break.

export const dynamic = "force-dynamic";

export default async function ScorecardPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const scorecard = await loadCompanyScorecard(companyId);
  const overallTrend = overallTrajectory(scorecard);

  const supabase = await createSupabaseServerClient();
  const { data: companyRow } = await supabase
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle<{ name: string }>();
  const companyName = companyRow?.name ?? "your company";

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Scorecard summary">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>AiMS Scorecard</p>
          <h1 className={styles.h1}>AiMS Implementation Status</h1>
          <p className={styles.subtitle}>
            An overview of how consistently the AiMS disciplines are being
            practiced across {companyName}.
          </p>

          <div className={styles.overallRow}>
            <OverallDial score={scorecard.overall.score} />
            <div className={styles.overallMeta}>
              <p className={styles.overallLabel}>Overall</p>
              <TrendChip trajectory={overallTrend} />
              <p className={styles.overallCaption}>
                {scorecard.overall.disciplinesCounted} of {DISCIPLINES.length}{" "}
                disciplines counted · updated live
              </p>
            </div>
            <div className={styles.overallSpark}>
              <Sparkline
                points={scorecard.overallTimeseries.map((p) => ({
                  x: p.date,
                  y: p.score,
                }))}
                width={280}
                height={64}
                ariaLabel="Overall score over the last 26 weeks"
              />
              <p className={styles.overallSparkCaption}>Last 26 weeks</p>
            </div>
          </div>
        </div>
      </section>

      <div className={styles.content}>
        <div className={styles.grid}>
          {DISCIPLINES.map((config) => {
            const score = scorecard.disciplines.find(
              (d) => d.key === config.key
            );
            const trend = trajectoryFor(config.key, scorecard);
            const spark = scorecard.timeseries[config.key];
            return (
              <article
                key={config.key}
                className={styles.card}
                aria-label={config.label}
              >
                <header className={styles.cardHeader}>
                  <h2 className={styles.cardTitle}>{config.label}</h2>
                  <ScorePill score={score?.score ?? null} />
                </header>
                <p className={styles.cardBlurb}>{config.blurb}</p>

                {config.showsTrend ? (
                  <div className={styles.cardTrendRow}>
                    <TrendChip trajectory={trend} />
                    <div className={styles.cardSpark}>
                      <Sparkline
                        points={spark.map((p) => ({ x: p.date, y: p.score }))}
                        width={140}
                        height={36}
                        ariaLabel={`${config.label} score over the last 26 weeks`}
                      />
                    </div>
                  </div>
                ) : null}

                <Breakdown
                  discipline={config.key}
                  breakdown={score?.breakdown ?? {}}
                  scoreIsNull={score?.score === null || score?.score === undefined}
                />

                <Link href={config.href} className={styles.cardCta}>
                  {config.hrefLabel} →
                </Link>
              </article>
            );
          })}
        </div>

        <p className={styles.footer}>
          Snapshots taken every Sunday. Live score as of{" "}
          {formatShortDate(scorecard.computedAt)}.
        </p>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------
// Presentation bits — small enough to keep inline. Extract into
// their own files when they grow past one screen.
// -----------------------------------------------------------------

function OverallDial({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <div className={`${styles.overallDial} ${styles.overallDialMuted}`}>
        <span className={styles.overallDialNumber}>—</span>
      </div>
    );
  }
  return (
    <div className={styles.overallDial}>
      <span className={styles.overallDialNumber}>{score.toFixed(1)}</span>
      <span className={styles.overallDialOutOf}>/ 10</span>
    </div>
  );
}

function ScorePill({ score }: { score: number | null }) {
  if (score === null) {
    return <span className={`${styles.pill} ${styles.pillMuted}`}>Not enabled</span>;
  }
  // Colour band: 0–4 red-ish, 4–7 amber, 7–10 green. Uses existing
  // brand tokens so the palette stays coherent across pages.
  const band =
    score >= 7 ? styles.pillGood : score >= 4 ? styles.pillMid : styles.pillLow;
  return (
    <span className={`${styles.pill} ${band}`}>
      {score.toFixed(1)}
      <span className={styles.pillOutOf}>/10</span>
    </span>
  );
}

function TrendChip({
  trajectory,
}: {
  trajectory: { delta: number; priorDate: string } | null;
}) {
  if (!trajectory) {
    return <span className={styles.trendChip}>Not enough history yet</span>;
  }
  const delta = trajectory.delta;
  if (delta === 0) {
    return (
      <span className={`${styles.trendChip} ${styles.trendFlat}`}>
        → Flat vs {formatShortDate(trajectory.priorDate)}
      </span>
    );
  }
  const arrow = delta > 0 ? "↑" : "↓";
  const cls = delta > 0 ? styles.trendUp : styles.trendDown;
  return (
    <span className={`${styles.trendChip} ${cls}`}>
      {arrow} {delta > 0 ? "+" : ""}
      {delta.toFixed(1)} vs {formatShortDate(trajectory.priorDate)}
    </span>
  );
}

// Renders a small evidence list under each score. The shape of the
// breakdown differs per discipline; we keep the render server-side so
// no client hydration is needed for what's essentially static text.
function Breakdown({
  discipline,
  breakdown,
  scoreIsNull,
}: {
  discipline: string;
  breakdown: Record<string, unknown>;
  scoreIsNull: boolean;
}) {
  if (scoreIsNull) {
    return (
      <p className={styles.breakdownMuted}>
        This discipline turns on when the company enables the underlying
        feature.
      </p>
    );
  }

  const lines = evidenceLines(discipline, breakdown);
  return (
    <>
      {lines.length > 0 ? (
        <ul className={styles.breakdown}>
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
      {discipline === "chart" ? (
        <ChartIssuesList
          issues={
            Array.isArray(breakdown.issues)
              ? (breakdown.issues as ChartFunctionIssue[])
              : []
          }
        />
      ) : null}
    </>
  );
}

// Chart-specific footnote: which functions are missing what. Complete
// functions are already filtered out server-side, so this list only
// surfaces things a user could act on. Trims to the first 5 to keep
// the card compact — "+N more" prompts the user to click through.
function ChartIssuesList({ issues }: { issues: ChartFunctionIssue[] }) {
  if (issues.length === 0) return null;
  const visible = issues.slice(0, 5);
  const remaining = issues.length - visible.length;
  const missingLabel = (m: ChartFunctionIssue["missing"][number]) =>
    m === "lead"
      ? "Lead"
      : m === "track"
        ? "Track"
        : m === "outcome"
          ? "outcome"
          : "measure";
  return (
    <details className={styles.issues}>
      <summary className={styles.issuesSummary}>
        {issues.length === 1
          ? "1 function needs attention"
          : `${issues.length} functions need attention`}
      </summary>
      <ul className={styles.issuesList}>
        {visible.map((fn) => (
          <li key={fn.id}>
            <span className={styles.issuesName}>{fn.name}</span>
            <span className={styles.issuesMissing}>
              missing {fn.missing.map(missingLabel).join(", ")}
            </span>
          </li>
        ))}
      </ul>
      {remaining > 0 ? (
        <p className={styles.issuesMore}>+{remaining} more</p>
      ) : null}
    </details>
  );
}

// Discipline-specific evidence rendering. Kept alongside the page so
// adding a new discipline is a two-file change (scorer + evidence
// case). No unit tests — the strings are the UI copy.
function evidenceLines(
  discipline: string,
  b: Record<string, unknown>
): string[] {
  const n = (k: string) => (typeof b[k] === "number" ? (b[k] as number) : 0);
  const bool = (k: string) => b[k] === true;
  switch (discipline) {
    case "foundation":
      return [
        bool("purpose") ? "Purpose statement set" : "Purpose statement missing",
        bool("vision") ? "Vision set" : "Vision missing",
        `${n("values")} core values`,
        `${n("differentiators")} differentiators`,
        `${n("successMetrics")} key success metrics`,
      ];
    case "chart":
      return n("totalFunctions") === 0
        ? ["No functions on the chart yet"]
        : [
            `${n("totalFunctions")} functions`,
            `${n("withLead")} have a Lead assigned`,
            `${n("withTrack")} have a Track assigned`,
            `${n("withOutcome")} have at least one outcome`,
            `${n("withMeasure")} have at least one measure`,
          ];
    case "planning":
      if (!bool("openQuarter")) {
        return ["No open quarter — open one to begin scoring this discipline"];
      }
      return [
        `${n("sfas")} focus areas, ${n("goals")} annual goals, ${n("priorities")} priorities in the open quarter`,
        n("goalsPastDue") === 0
          ? "No annual goals past their target date yet"
          : `${n("goalsClosed")} of ${n("goalsPastDue")} past-target annual goals complete (${n("goalClosureRate")}%)`,
        n("prioritiesPastDue") === 0
          ? "No priorities past their due date yet"
          : `${n("prioritiesClosed")} of ${n("prioritiesPastDue")} past-due priorities complete (${n("priorityClosureRate")}%)`,
      ];
    case "execution":
      return [
        `${n("followThroughPct")}% follow-through (kept ÷ resolved) over the last ${n("windowDays")} days`,
        `${n("openCount")} commitments open`,
        `${n("agingCount")} open more than 14 days past due`,
      ];
    case "measures":
      return n("totalMeasures") === 0
        ? ["No measures set up yet"]
        : [
            `${n("totalMeasures")} active measures`,
            `${n("targetPct")}% have a target set`,
            `${n("cadencePct")}% logged in the last 7 days`,
            n("autoTrackGaps") > 0
              ? `${n("autoTrackGaps")} auto-track measures missing this week`
              : "All auto-track measures logged",
          ];
    case "meetings":
      return [
        `${n("meetingCount")} meetings in the last ${n("windowWeeks")} weeks (across ${n("weeksWithMeeting")} of ${n("windowWeeks")} weeks)`,
        n("reviewsCounted") > 0
          ? `Avg facilitation score ${n("meanQuality")}/10 across ${n("reviewsCounted")} reviewed meetings`
          : "No facilitation reviews recorded yet",
      ];
    default:
      return [];
  }
}
