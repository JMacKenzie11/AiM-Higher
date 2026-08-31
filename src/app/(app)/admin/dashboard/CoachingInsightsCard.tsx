"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { fetchCoachingInsightsAction } from "@/lib/admin/coaching-insights-actions";
import {
  everythingInsightsFilters,
  type CoachingInsightsAdoption,
  type CoachingInsightsFilters,
  type CoachingInsightsSynthesis,
  type CompanyOption,
} from "@/lib/admin/coaching-insights-service";
import { Sparkline } from "./Sparkline";
import styles from "./coaching-insights.module.css";

// Bottom-of-dashboard card. Renders four bands for a caller-selected
// (company + date range) window:
//   1. Adoption stats (Pass 1)  — sourced from live SQL.
//   2. Themes + friction (Pass 2) — sourced from the nightly per-
//      conversation analyses (LLM, PII-stripped).
//   3. Opportunities + agent×theme heatmap (Pass 3) — same source.
// Everything below the filter row re-fetches together when filters
// change (useTransition keeps the current view visible so the
// numbers don't blank out during a re-fetch).

export function CoachingInsightsCard({
  companies,
  initialFilters,
  initialAdoption,
  initialSynthesis,
}: {
  companies: CompanyOption[];
  initialFilters: CoachingInsightsFilters;
  initialAdoption: CoachingInsightsAdoption;
  initialSynthesis: CoachingInsightsSynthesis;
}) {
  const [filters, setFilters] = useState<CoachingInsightsFilters>(initialFilters);
  const [adoption, setAdoption] = useState<CoachingInsightsAdoption>(initialAdoption);
  const [synthesis, setSynthesis] =
    useState<CoachingInsightsSynthesis>(initialSynthesis);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Guard against a stale request landing after a newer filter
  // change — reject any response whose filter fingerprint no
  // longer matches the current one. Cheap version-token pattern.
  const requestTokenRef = useRef(0);

  const refetch = useCallback(
    (next: CoachingInsightsFilters) => {
      requestTokenRef.current += 1;
      const myToken = requestTokenRef.current;
      startTransition(async () => {
        const res = await fetchCoachingInsightsAction(next);
        if (myToken !== requestTokenRef.current) return;
        if (!res.ok) {
          setError(res.message);
          return;
        }
        setError(null);
        setAdoption(res.adoption);
        setSynthesis(res.synthesis);
      });
    },
    // startTransition is stable by contract, safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const commit = useCallback(
    (next: CoachingInsightsFilters) => {
      setFilters(next);
      refetch(next);
    },
    [refetch]
  );

  return (
    <section className={styles.card} aria-label="Coaching insights">
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Coaching insights</h2>
          <p className={styles.subtitle}>
            What leaders are working through with the coach. Filter by
            company and date range; clearing pulls back everything.
          </p>
        </div>
      </header>

      <CoachingInsightsFilters
        companies={companies}
        value={filters}
        onChange={commit}
        pending={pending}
      />

      {error ? (
        <p role="alert" className={styles.errorNote}>
          {error}
        </p>
      ) : null}

      <AdoptionBand adoption={adoption} pending={pending} />

      <DailyActivity adoption={adoption} />

      <AgentBreakdown adoption={adoption} />

      <SynthesisFreshness synthesis={synthesis} />

      <ThemesPane synthesis={synthesis} pending={pending} />

      <FrictionPane synthesis={synthesis} pending={pending} />

      <OpportunitiesPane synthesis={synthesis} pending={pending} />

      <AgentThemeHeatmap synthesis={synthesis} pending={pending} />
    </section>
  );
}

// ---- Filters ----------------------------------------------

function CoachingInsightsFilters({
  companies,
  value,
  onChange,
  pending,
}: {
  companies: CompanyOption[];
  value: CoachingInsightsFilters;
  onChange: (next: CoachingInsightsFilters) => void;
  pending: boolean;
}) {
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!companyPickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setCompanyPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [companyPickerOpen]);

  const selectedNames = useMemo(() => {
    if (value.companyIds.length === 0) return "All companies";
    if (value.companyIds.length <= 2) {
      return companies
        .filter((c) => value.companyIds.includes(c.id))
        .map((c) => c.name)
        .join(", ");
    }
    return `${value.companyIds.length} companies`;
  }, [companies, value.companyIds]);

  function toggleCompany(id: string) {
    const next = value.companyIds.includes(id)
      ? value.companyIds.filter((x) => x !== id)
      : [...value.companyIds, id];
    onChange({ ...value, companyIds: next });
  }

  function clearAll() {
    onChange({
      companyIds: [],
      startIso: value.startIso,
      endIso: value.endIso,
    });
  }

  return (
    <div className={styles.filtersRow}>
      <div ref={wrapRef} className={styles.filterField}>
        <label className={styles.filterLabel}>Companies</label>
        <button
          type="button"
          className={styles.companyTrigger}
          onClick={() => setCompanyPickerOpen((prev) => !prev)}
          aria-expanded={companyPickerOpen}
          aria-haspopup="listbox"
          disabled={pending}
        >
          <span className={styles.companyTriggerLabel}>{selectedNames}</span>
          <span className={styles.chevron} aria-hidden="true">
            ▾
          </span>
        </button>
        {companyPickerOpen ? (
          <div className={styles.companyMenu} role="listbox">
            <button
              type="button"
              className={styles.companyMenuClear}
              onClick={clearAll}
            >
              Clear (all companies)
            </button>
            <ul className={styles.companyMenuList}>
              {companies.map((c) => {
                const checked = value.companyIds.includes(c.id);
                return (
                  <li key={c.id}>
                    <label className={styles.companyMenuItem}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCompany(c.id)}
                      />
                      <span>{c.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>

      <div className={styles.filterField}>
        <label htmlFor="ci-start" className={styles.filterLabel}>
          Start
        </label>
        <input
          id="ci-start"
          type="date"
          className={styles.dateInput}
          value={value.startIso}
          max={value.endIso}
          onChange={(e) =>
            onChange({ ...value, startIso: e.target.value })
          }
          disabled={pending}
        />
      </div>

      <div className={styles.filterField}>
        <label htmlFor="ci-end" className={styles.filterLabel}>
          End
        </label>
        <input
          id="ci-end"
          type="date"
          className={styles.dateInput}
          value={value.endIso}
          min={value.startIso}
          onChange={(e) => onChange({ ...value, endIso: e.target.value })}
          disabled={pending}
        />
      </div>

      <div className={styles.filterActions}>
        <button
          type="button"
          className={styles.resetButton}
          onClick={() => onChange(everythingInsightsFilters())}
          disabled={pending}
          title="Clear all filters and pull every conversation in the system"
        >
          Reset · show all-time
        </button>
        {pending ? (
          <span className={styles.filterPending} aria-live="polite">
            Loading…
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ---- Adoption band ----------------------------------------

function AdoptionBand({
  adoption,
  pending,
}: {
  adoption: CoachingInsightsAdoption;
  pending: boolean;
}) {
  const stats = [
    {
      value: adoption.conversations.total.toLocaleString(),
      label: "Conversations",
      caption: `${adoption.conversations.withUserTurn} had a user turn`,
    },
    {
      value: adoption.uniqueUsers.toLocaleString(),
      label: "Unique users",
      caption: `across ${adoption.companiesActive} of ${adoption.companiesInScope} companies`,
    },
    {
      value: `${adoption.pastThreeExchanges.pct}%`,
      label: "Went deep",
      caption: `${adoption.pastThreeExchanges.count} threads past 3 exchanges`,
    },
    {
      value: adoption.averageThreadLength.toFixed(1),
      label: "Avg turns",
      caption: `median ${adoption.medianThreadLength}`,
    },
    {
      value: adoption.conversations.withAgent.toLocaleString(),
      label: "With agent",
      caption: `${adoption.conversations.plainAimee} plain Aimee`,
    },
    {
      value: `${adoption.window.days}d`,
      label: "Window",
      caption: `${formatShort(adoption.window.startIso)} → ${formatShort(adoption.window.endIso)}`,
    },
  ];

  return (
    <div
      className={pending ? styles.statBandPending : styles.statBand}
      aria-busy={pending}
    >
      {stats.map((s) => (
        <div key={s.label} className={styles.statPill}>
          <div className={styles.statValue}>{s.value}</div>
          <div className={styles.statLabel}>{s.label}</div>
          <div className={styles.statCaption}>{s.caption}</div>
        </div>
      ))}
    </div>
  );
}

// ---- Daily activity ---------------------------------------

function DailyActivity({ adoption }: { adoption: CoachingInsightsAdoption }) {
  if (adoption.daily.length === 0) return null;
  const total = adoption.daily.reduce((s, d) => s + d.count, 0);
  const busiest = adoption.daily.reduce((best, d) =>
    d.count > best.count ? d : best
  );
  return (
    <div className={styles.sparklineWrap}>
      <div className={styles.sparklineMeta}>
        <span className={styles.sparklineTitle}>Daily activity</span>
        {total > 0 ? (
          <span className={styles.sparklineCaption}>
            Busiest day {formatShort(busiest.date)} · {busiest.count}
            {busiest.count === 1 ? " conversation" : " conversations"}
          </span>
        ) : (
          <span className={styles.sparklineCaption}>
            No conversations in this window
          </span>
        )}
      </div>
      <div className={styles.sparklineCanvas}>
        <Sparkline
          points={adoption.daily.map((d) => d.count)}
          ariaLabel="Daily coaching conversation count for the selected window"
        />
      </div>
    </div>
  );
}

// ---- Agent breakdown --------------------------------------

function AgentBreakdown({ adoption }: { adoption: CoachingInsightsAdoption }) {
  if (adoption.topAgents.length === 0) return null;
  const max = Math.max(1, ...adoption.topAgents.map((a) => a.count));
  return (
    <div className={styles.agentPane}>
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>Agent adoption</span>
        <span className={styles.paneCaption}>
          Bar width = conversation count. Solid segment = went deep (6+
          messages).
        </span>
      </div>
      <ul className={styles.agentList}>
        {adoption.topAgents.map((agent) => {
          const total = agent.count;
          const totalPct = (total / max) * 100;
          const deepPct = (agent.wentDeep / max) * 100;
          const deepRatio =
            total > 0 ? Math.round((agent.wentDeep / total) * 100) : 0;
          return (
            <li key={agent.agentId ?? "aimee"} className={styles.agentRow}>
              <span className={styles.agentName}>{agent.title}</span>
              <div className={styles.agentBarTrack} aria-hidden="true">
                <div
                  className={styles.agentBarTotal}
                  style={{ width: `${totalPct}%` }}
                />
                <div
                  className={styles.agentBarDeep}
                  style={{ width: `${deepPct}%` }}
                />
              </div>
              <span className={styles.agentCount}>
                {total.toLocaleString()}
              </span>
              <span className={styles.agentDeep}>{deepRatio}% deep</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---- Synthesis freshness ----------------------------------

function SynthesisFreshness({
  synthesis,
}: {
  synthesis: CoachingInsightsSynthesis;
}) {
  const dot =
    synthesis.analysesCount === 0
      ? styles.freshnessDotIdle
      : synthesis.analysesCount < 5
        ? styles.freshnessDotLow
        : styles.freshnessDotOk;
  const label =
    synthesis.analysesCount === 0
      ? "No analyses in this window yet"
      : `${synthesis.analysesCount.toLocaleString()} conversations analyzed`;
  const stamp = synthesis.lastAnalyzedAt
    ? ` · last run ${formatWhen(synthesis.lastAnalyzedAt)}`
    : "";
  return (
    <div className={styles.freshnessRow}>
      <span className={dot} aria-hidden="true" />
      <span>{label}{stamp}</span>
    </div>
  );
}

// ---- Themes ------------------------------------------------

function ThemesPane({
  synthesis,
  pending,
}: {
  synthesis: CoachingInsightsSynthesis;
  pending: boolean;
}) {
  if (synthesis.analysesCount < 3) {
    return (
      <EmptyPane
        title="Themes"
        caption="Wait for the nightly job to build a big enough sample. Themes need at least three analyzed conversations to be trustworthy."
      />
    );
  }
  const max = Math.max(1, ...synthesis.themes.map((t) => t.count));
  return (
    <div
      className={pending ? styles.subPanePending : styles.subPane}
      aria-busy={pending}
    >
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>Top themes</span>
        <span className={styles.paneCaption}>
          What leaders are working on. Bar width shows how many
          conversations landed in each theme.
        </span>
      </div>
      <ul className={styles.themeList}>
        {synthesis.themes.map((theme) => (
          <li key={theme.label} className={styles.themeRow}>
            <div className={styles.themeName}>{theme.label}</div>
            <div className={styles.themeBarTrack} aria-hidden="true">
              <div
                className={styles.themeBarFill}
                style={{ width: `${(theme.count / max) * 100}%` }}
              />
            </div>
            <div className={styles.themeCount}>
              {theme.count.toLocaleString()}
            </div>
            {theme.examples.length > 0 ? (
              <ul className={styles.themeExamples}>
                {theme.examples.map((ex, i) => (
                  <li key={i}>{ex}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Friction ---------------------------------------------

function FrictionPane({
  synthesis,
  pending,
}: {
  synthesis: CoachingInsightsSynthesis;
  pending: boolean;
}) {
  if (synthesis.analysesCount < 3) return null;
  if (synthesis.friction.length === 0) {
    return (
      <EmptyPane
        title="Friction signals"
        caption="No frustration or stuck moments in this window. That's a good week."
      />
    );
  }
  return (
    <div
      className={pending ? styles.subPanePending : styles.subPane}
      aria-busy={pending}
    >
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>Friction signals</span>
        <span className={styles.paneCaption}>
          Where leaders sounded stuck or frustrated. Chip tint
          reflects severity.
        </span>
      </div>
      <ul className={styles.frictionList}>
        {synthesis.friction.map((f) => (
          <li key={f.label} className={styles.frictionRow}>
            <span className={frictionChipClass(f.level)}>
              {f.label}
            </span>
            <span className={styles.frictionCount}>
              {f.count} {f.count === 1 ? "signal" : "signals"}
            </span>
            {f.examples[0] ? (
              <span className={styles.frictionExample}>
                “{f.examples[0]}”
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function frictionChipClass(level: 1 | 2 | 3): string {
  if (level >= 3) return styles.frictionChipHigh;
  if (level === 2) return styles.frictionChipMed;
  return styles.frictionChipLow;
}

// ---- Opportunities ----------------------------------------

function OpportunitiesPane({
  synthesis,
  pending,
}: {
  synthesis: CoachingInsightsSynthesis;
  pending: boolean;
}) {
  if (synthesis.analysesCount < 3) return null;
  if (synthesis.opportunities.length === 0) {
    return (
      <EmptyPane
        title="Product opportunities"
        caption="No platform opportunities surfaced in this window. Keep listening."
      />
    );
  }
  return (
    <div
      className={pending ? styles.subPanePending : styles.subPane}
      aria-busy={pending}
    >
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>Product opportunities</span>
        <span className={styles.paneCaption}>
          Feature or workflow needs pulled from the conversations.
          Repeats are the strongest signal.
        </span>
      </div>
      <ul className={styles.opportunityList}>
        {synthesis.opportunities.map((op) => (
          <li key={op.label} className={styles.opportunityRow}>
            <div className={styles.opportunityLabel}>{op.label}</div>
            <div className={styles.opportunityCount}>
              {op.count}× {op.count === 1 ? "mention" : "mentions"}
            </div>
            {op.example ? (
              <div className={styles.opportunityExample}>{op.example}</div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Agent × theme heatmap --------------------------------

function AgentThemeHeatmap({
  synthesis,
  pending,
}: {
  synthesis: CoachingInsightsSynthesis;
  pending: boolean;
}) {
  const { practices, themes, cells } = synthesis.heatmap;
  if (
    synthesis.analysesCount < 3 ||
    practices.length === 0 ||
    themes.length === 0
  ) {
    return null;
  }
  const byKey = new Map<string, number>();
  let max = 1;
  for (const c of cells) {
    const key = `${c.practiceId ?? "null"}::${c.themeLabel}`;
    byKey.set(key, c.count);
    if (c.count > max) max = c.count;
  }
  return (
    <div
      className={pending ? styles.subPanePending : styles.subPane}
      aria-busy={pending}
    >
      <div className={styles.paneHead}>
        <span className={styles.paneTitle}>Agent × theme heatmap</span>
        <span className={styles.paneCaption}>
          Which agent surfaces which topic. Darker cells = more
          conversations. Ask Aimee is the no-agent baseline.
        </span>
      </div>
      <div className={styles.heatmapWrap}>
        <table className={styles.heatmapTable}>
          <thead>
            <tr>
              <th scope="col" className={styles.heatmapCorner}>
                Agent
              </th>
              {themes.map((t) => (
                <th key={t} scope="col" className={styles.heatmapColHead}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {practices.map((p) => (
              <tr key={p.practiceId ?? "null"}>
                <th scope="row" className={styles.heatmapRowHead}>
                  {p.practiceTitle}
                </th>
                {themes.map((t) => {
                  const key = `${p.practiceId ?? "null"}::${t}`;
                  const n = byKey.get(key) ?? 0;
                  const intensity = n / max;
                  return (
                    <td
                      key={t}
                      className={styles.heatmapCell}
                      style={{
                        background:
                          n === 0
                            ? "transparent"
                            : `color-mix(in srgb, var(--primary) ${Math.round(
                                12 + intensity * 68
                              )}%, transparent)`,
                        color:
                          intensity > 0.5 ? "var(--surface)" : "var(--text)",
                      }}
                      title={`${n} ${n === 1 ? "conversation" : "conversations"} · ${p.practiceTitle} × ${t}`}
                    >
                      {n > 0 ? n : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Shared empty state -----------------------------------

function EmptyPane({
  title,
  caption,
}: {
  title: string;
  caption: string;
}) {
  return (
    <div className={styles.subPaneEmpty}>
      <span className={styles.paneTitle}>{title}</span>
      <p className={styles.paneCaption}>{caption}</p>
    </div>
  );
}

// ---- Small helpers ----------------------------------------

function formatShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffH = (now - d.getTime()) / (60 * 60 * 1000);
  if (diffH < 1) return "just now";
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  const diffD = diffH / 24;
  if (diffD < 30) return `${Math.round(diffD)}d ago`;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
