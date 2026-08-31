"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { fetchCoachingInsightsAction } from "@/lib/admin/coaching-insights-actions";
import type {
  CoachingInsightsAdoption,
  CoachingInsightsFilters,
  CompanyOption,
} from "@/lib/admin/coaching-insights-service";
import { Sparkline } from "./Sparkline";
import styles from "./coaching-insights.module.css";

// Bottom-of-dashboard card. Pass 1 renders the adoption/volume
// slice for a caller-selected (company + date range) window.
// Passes 2 + 3 will layer themes + friction + product
// opportunities on top of the same filter state.
//
// Everything below the filters re-fetches when filters change
// (useTransition keeps the current view visible so the numbers
// don't blank out during a re-fetch).

export function CoachingInsightsCard({
  companies,
  initialFilters,
  initialAdoption,
}: {
  companies: CompanyOption[];
  initialFilters: CoachingInsightsFilters;
  initialAdoption: CoachingInsightsAdoption;
}) {
  const [filters, setFilters] = useState<CoachingInsightsFilters>(initialFilters);
  const [adoption, setAdoption] = useState<CoachingInsightsAdoption>(initialAdoption);
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

      {/*
        Pass 2 will add: <ThemesPane adoption={adoption} filters={filters} />
        Pass 3 will add: <OpportunitiesPane /> and <AgentCategoryHeatmap />
      */}
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

// ---- Small helpers ----------------------------------------

function formatShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
