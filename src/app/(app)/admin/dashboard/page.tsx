import Link from "next/link";
import { requireRole } from "@/lib/auth/current-user";
import {
  getPlatformPulse,
  getCompanyActivity,
  computeAtRisk,
  getPracticeAdoption,
  getModelCostSummary,
  getSignupStats,
  getLatestThemes,
} from "@/lib/admin/dashboard-service";
import { readAnthropicCostSummary } from "@/lib/admin/anthropic-cost";
import { PageShell } from "@/components/ui/PageShell";
import { PulseNumber } from "./PulseNumber";
import { ActivityTable } from "./ActivityTable";
import { Sparkline } from "./Sparkline";
import { InfoTip } from "./InfoTip";
import styles from "./dashboard.module.css";

// System-admin cross-company dashboard. Every module is fetched
// in parallel; each renders within its own card and does not
// depend on any other. Cards fade in with staggered animation
// (see dashboard.module.css .cardStagger*), so the page feels
// alive on load rather than dropping in as a single frame.

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  // Gate: only system_admin. Non-admins get redirected to /.
  await requireRole(["system_admin"]);

  const [pulse, activity, practices, costs, signups, themes, realCosts] =
    await Promise.all([
      getPlatformPulse(),
      getCompanyActivity(),
      getPracticeAdoption(),
      getModelCostSummary(),
      getSignupStats(),
      getLatestThemes(),
      readAnthropicCostSummary(),
    ]);
  const atRisk = computeAtRisk(activity);
  // Prefer real invoiced numbers from the Anthropic Admin API when
  // the workspace is configured and at least one bucket has been
  // pulled; fall back to the local estimator otherwise. Per-company
  // mini-bars always use the local estimator (Anthropic doesn't
  // segment cost by our companies).
  const useRealCosts =
    realCosts.configured && realCosts.latestBucketDate !== null;
  const displayedCosts = useRealCosts
    ? {
        totalCents7d: realCosts.totalCents7d,
        totalCents30d: realCosts.totalCents30d,
        byDay: realCosts.byDay,
      }
    : {
        totalCents7d: costs.totalCents7d,
        totalCents30d: costs.totalCents30d,
        byDay: costs.byDay,
      };

  const maxCompanyConvos = Math.max(
    1,
    ...activity.map((r) => r.conversations30d)
  );
  const maxThemeCount = Math.max(1, ...themes.themes.map((t) => t.count));
  const maxCostCents = Math.max(
    1,
    ...costs.byCompany.slice(0, 8).map((c) => c.cents30d)
  );

  return (
    <PageShell
      eyebrow="System admin"
      title="Platform"
      subtitle="Cross-company view of what's live, what's active, and what needs attention. Numbers update on page load."
    >
      {/* ---- Pulse strip: 4 big platform numbers at the top ---- */}
      <section
        className={`${styles.pulseGrid} ${styles.cardStagger1}`}
        aria-label="Platform pulse"
      >
        <div className={styles.pulseCard}>
          <PulseNumber value={pulse.activeUsers7d} />
          <span className={`${styles.pulseLabel} ${styles.tipLabel}`}>
            Active users · 7d
            <InfoTip text="Distinct users who sent at least one message to the coach (Ask Aimee, About mode, or a Practice) in the last 7 days." />
          </span>
          <span className={styles.pulseCaption}>
            {pulse.activeUsers30d} in the last 30
          </span>
        </div>
        <div className={styles.pulseCard}>
          <PulseNumber value={pulse.turns7d} />
          <span className={`${styles.pulseLabel} ${styles.tipLabel}`}>
            Coaching turns · 7d
            <InfoTip text="One exchange = one turn (user message + coach response). A single conversation with 20 back-and-forths counts as 20 turns." />
          </span>
          <span className={styles.pulseCaption}>
            {pulse.turns30d.toLocaleString()} in 30d
          </span>
        </div>
        <div className={styles.pulseCard}>
          <PulseNumber value={pulse.newCompanies7d} />
          <span className={`${styles.pulseLabel} ${styles.tipLabel}`}>
            New companies · 7d
            <InfoTip text="Companies whose account was created in the last 7 days." />
          </span>
          <span className={styles.pulseCaption}>
            {signups.newUsers7d} new users, {signups.pendingInvites} invites
            pending
          </span>
        </div>
        <div className={styles.pulseCard}>
          <PulseNumber
            value={displayedCosts.totalCents7d}
            format="cents"
          />
          <span className={`${styles.pulseLabel} ${styles.tipLabel}`}>
            Coach spend · 7d
            <InfoTip
              text={
                useRealCosts
                  ? "Real invoiced spend from Anthropic's Admin API, scoped to the AiMHigher workspace. Updated nightly at 05:00 UTC."
                  : "Estimated Anthropic API cost across all coach features in the last 7 days. Computed from token counts using hardcoded per-model rates. Configure ANTHROPIC_ADMIN_KEY and ANTHROPIC_WORKSPACE_ID to see real invoiced numbers instead."
              }
            />
          </span>
          <span className={styles.pulseCaption}>
            ${(displayedCosts.totalCents30d / 100).toFixed(2)} in 30d
          </span>
        </div>
      </section>

      {/* ---- At-risk alert (only shown when there's something) ---- */}
      {atRisk.length > 0 ? (
        <section
          className={`${styles.atRiskCard} ${styles.cardStagger2}`}
          aria-label="Companies needing attention"
        >
          <div className={styles.atRiskHeader}>
            <span className={styles.atRiskDot} aria-hidden="true" />
            <h2 className={`${styles.cardTitle} ${styles.tipLabel}`}>
              Needs attention
              <InfoTip text="Companies flagged for: silent 14+ days (no coach activity), a big drop this week (was 4+ in 30 days, now 0), or keep rate under 40% over the last 30 days. Click any row to jump into that company." />
            </h2>
            <span className={styles.atRiskCount}>{atRisk.length}</span>
          </div>
          <ul className={styles.atRiskList}>
            {atRisk.map((c) => (
              <li key={c.companyId} className={styles.atRiskRow}>
                <Link
                  href={`/admin/companies/${c.companyId}`}
                  className={styles.atRiskLink}
                >
                  <span className={styles.atRiskName}>{c.companyName}</span>
                  <span className={styles.atRiskReason}>{c.reason}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---- Two-column: themes + conversations per company ---- */}
      <div className={styles.twoCol}>
        <section
          className={`${styles.card} ${styles.cardStagger3}`}
          aria-label="Top coaching themes"
        >
          <header className={styles.cardHeader}>
            <h2 className={`${styles.cardTitle} ${styles.tipLabel}`}>
              Top coaching themes
              <InfoTip text="Nightly clustering job (runs at 06:00 UTC) samples the most recent conversation titles and openings across the platform, and asks Haiku to bucket them into the 5 most common themes." />
            </h2>
            <span className={styles.cardMeta}>
              {themes.refreshedAt
                ? `${themes.sourceCount} conversations · updated ${relativeDay(themes.refreshedAt)}`
                : "First clustering runs at 06:00 UTC"}
            </span>
          </header>
          {themes.themes.length === 0 ? (
            <p className={styles.emptyNote}>
              No themes snapshot yet. The nightly job at 06:00 UTC will
              cluster the most recent conversations and this card will
              populate on the next page load.
            </p>
          ) : (
            <ol className={styles.themeList}>
              {themes.themes.map((t, i) => (
                <li key={t.label} className={styles.themeItem}>
                  <div className={styles.themeHead}>
                    <span className={styles.themeRank}>{i + 1}</span>
                    <span className={styles.themeLabel}>{t.label}</span>
                    <span className={styles.themeCount}>{t.count}</span>
                  </div>
                  <div
                    className={styles.themeBarTrack}
                    aria-hidden="true"
                  >
                    <div
                      className={styles.themeBarFill}
                      style={{
                        width: `${(t.count / maxThemeCount) * 100}%`,
                      }}
                    />
                  </div>
                  <p className={styles.themeDescription}>{t.description}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          className={`${styles.card} ${styles.cardStagger4}`}
          aria-label="Conversations per company"
        >
          <header className={styles.cardHeader}>
            <h2 className={`${styles.cardTitle} ${styles.tipLabel}`}>
              Conversations per company
              <InfoTip text="Distinct coaching threads started in the last 30 days, per company. A single thread with many turns still counts as one conversation." />
            </h2>
            <span className={styles.cardMeta}>Last 30 days</span>
          </header>
          {activity.length === 0 ? (
            <p className={styles.emptyNote}>No conversations yet.</p>
          ) : (
            <ol className={styles.companyBarList}>
              {activity
                .filter((r) => r.conversations30d > 0)
                .slice(0, 8)
                .map((r) => (
                  <li key={r.companyId} className={styles.companyBarRow}>
                    <Link
                      href={`/admin/companies/${r.companyId}`}
                      className={styles.companyBarName}
                    >
                      {r.companyName}
                    </Link>
                    <div
                      className={styles.companyBarTrack}
                      aria-hidden="true"
                    >
                      <div
                        className={styles.companyBarFill}
                        style={{
                          width: `${(r.conversations30d / maxCompanyConvos) * 100}%`,
                        }}
                      />
                    </div>
                    <span className={styles.companyBarValue}>
                      {r.conversations30d}
                    </span>
                  </li>
                ))}
            </ol>
          )}
        </section>
      </div>

      {/* ---- Practice adoption ---- */}
      <section
        className={`${styles.card} ${styles.cardStagger5}`}
        aria-label="Practice adoption"
      >
        <header className={styles.cardHeader}>
          <h2 className={`${styles.cardTitle} ${styles.tipLabel}`}>
            Practice adoption
            <InfoTip text="How the guided practices are being used across the platform in the last 30 days. Hover the sub-labels for each column's definition." />
          </h2>
          <span className={styles.cardMeta}>Last 30 days</span>
        </header>
        <div className={styles.practiceGrid}>
          {practices.map((p) => (
            <div key={p.practiceId} className={styles.practiceTile}>
              <span className={styles.practiceName}>{p.title}</span>
              <div className={styles.practiceStats}>
                <div className={styles.practiceStat}>
                  <span className={styles.practiceStatValue}>
                    {p.started30d}
                  </span>
                  <span
                    className={`${styles.practiceStatLabel} ${styles.tipLabel}`}
                  >
                    started
                    <InfoTip text="Practice conversations created in the last 30 days, whether or not the person went past the opening chip." />
                  </span>
                </div>
                <div className={styles.practiceStat}>
                  <span className={styles.practiceStatValue}>
                    {p.multiTurn30d}
                  </span>
                  <span
                    className={`${styles.practiceStatLabel} ${styles.tipLabel}`}
                  >
                    engaged
                    <InfoTip text="Practice conversations with 3+ messages — proxy for 'the person actually engaged past the opener.'" />
                  </span>
                </div>
                <div className={styles.practiceStat}>
                  <span className={styles.practiceStatValue}>
                    {p.companies30d}
                  </span>
                  <span
                    className={`${styles.practiceStatLabel} ${styles.tipLabel}`}
                  >
                    companies
                    <InfoTip text="Distinct companies whose users started this practice at least once in the last 30 days." />
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Coach spend ---- */}
      <section
        className={`${styles.card} ${styles.cardStagger6}`}
        aria-label="Coach spend"
      >
        <header className={styles.cardHeader}>
          <h2 className={`${styles.cardTitle} ${styles.tipLabel}`}>
            Coach spend
            <InfoTip
              text={
                useRealCosts
                  ? "Totals and daily chart pull real invoiced spend from Anthropic's Admin API, scoped to the AiMHigher workspace. Per-company mini-bars below stay on the local token-count estimator (Anthropic doesn't segment cost by our companies)."
                  : "Sums the local cost_usd_cents column on coach_token_usage — token counts times hardcoded per-model rates. Set ANTHROPIC_ADMIN_KEY + ANTHROPIC_WORKSPACE_ID to switch this card to real invoiced numbers from Anthropic."
              }
            />
          </h2>
          <span className={styles.cardMeta}>
            {useRealCosts ? "Real · daily · last 30 days" : "Estimated · daily · last 30 days"}
          </span>
        </header>
        <div className={styles.costLayout}>
          <div className={styles.costTotals}>
            <div>
              <span className={styles.costTotalLabel}>Last 7 days</span>
              <span className={styles.costTotalValue}>
                ${(displayedCosts.totalCents7d / 100).toFixed(2)}
              </span>
            </div>
            <div>
              <span className={styles.costTotalLabel}>Last 30 days</span>
              <span className={styles.costTotalValue}>
                ${(displayedCosts.totalCents30d / 100).toFixed(2)}
              </span>
            </div>
          </div>
          <div className={styles.costSparkWrap}>
            <Sparkline
              points={displayedCosts.byDay.map((d) => d.cents)}
              ariaLabel="Daily coach spend over the last 30 days"
            />
          </div>
        </div>
        {costs.byCompany.length > 0 ? (
          <ol className={styles.costCompanyList}>
            {costs.byCompany.slice(0, 8).map((c) => (
              <li key={c.companyId ?? "none"} className={styles.costCompanyRow}>
                <span className={styles.costCompanyName}>{c.companyName}</span>
                <div className={styles.costCompanyTrack} aria-hidden="true">
                  <div
                    className={styles.costCompanyFill}
                    style={{
                      width: `${(c.cents30d / maxCostCents) * 100}%`,
                    }}
                  />
                </div>
                <span className={styles.costCompanyValue}>
                  ${(c.cents30d / 100).toFixed(2)}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      {/* ---- Full company activity table ---- */}
      <section
        className={`${styles.card} ${styles.cardStagger7}`}
        aria-label="Company activity"
      >
        <header className={styles.cardHeader}>
          <h2 className={`${styles.cardTitle} ${styles.tipLabel}`}>
            Company activity
            <InfoTip text="One row per company. Users = distinct people who sent a coach message in the window. Conv. = coaching threads started. Practices = practice conversations started (30d). Keep rate = kept ÷ (kept + missed) commitments (30d). Cost = estimated Anthropic API spend for this company (30d)." />
          </h2>
          <span className={styles.cardMeta}>
            Click a header to sort. Click a company to open it.
          </span>
        </header>
        <ActivityTable rows={activity} />
      </section>
    </PageShell>
  );
}

function relativeDay(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const h = Math.floor(ms / (60 * 60 * 1000));
  if (h < 24) return h <= 1 ? "just now" : `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
