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
import { PageShell } from "@/components/ui/PageShell";
import { PulseNumber } from "./PulseNumber";
import { ActivityTable } from "./ActivityTable";
import { Sparkline } from "./Sparkline";
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

  const [pulse, activity, practices, costs, signups, themes] =
    await Promise.all([
      getPlatformPulse(),
      getCompanyActivity(),
      getPracticeAdoption(),
      getModelCostSummary(),
      getSignupStats(),
      getLatestThemes(),
    ]);
  const atRisk = computeAtRisk(activity);

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
          <span className={styles.pulseLabel}>Active users · 7d</span>
          <span className={styles.pulseCaption}>
            {pulse.activeUsers30d} in the last 30
          </span>
        </div>
        <div className={styles.pulseCard}>
          <PulseNumber value={pulse.turns7d} />
          <span className={styles.pulseLabel}>Coaching turns · 7d</span>
          <span className={styles.pulseCaption}>
            {pulse.turns30d.toLocaleString()} in 30d
          </span>
        </div>
        <div className={styles.pulseCard}>
          <PulseNumber value={pulse.newCompanies7d} />
          <span className={styles.pulseLabel}>New companies · 7d</span>
          <span className={styles.pulseCaption}>
            {signups.newUsers7d} new users, {signups.pendingInvites} invites
            pending
          </span>
        </div>
        <div className={styles.pulseCard}>
          <PulseNumber
            value={pulse.costUsdCents7d}
            format="cents"
          />
          <span className={styles.pulseLabel}>Coach spend · 7d</span>
          <span className={styles.pulseCaption}>
            ${(costs.totalCents30d / 100).toFixed(2)} in 30d
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
            <h2 className={styles.cardTitle}>Needs attention</h2>
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
            <h2 className={styles.cardTitle}>Top coaching themes</h2>
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
            <h2 className={styles.cardTitle}>Conversations per company</h2>
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
          <h2 className={styles.cardTitle}>Practice adoption</h2>
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
                  <span className={styles.practiceStatLabel}>started</span>
                </div>
                <div className={styles.practiceStat}>
                  <span className={styles.practiceStatValue}>
                    {p.multiTurn30d}
                  </span>
                  <span className={styles.practiceStatLabel}>engaged</span>
                </div>
                <div className={styles.practiceStat}>
                  <span className={styles.practiceStatValue}>
                    {p.companies30d}
                  </span>
                  <span className={styles.practiceStatLabel}>companies</span>
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
          <h2 className={styles.cardTitle}>Coach spend</h2>
          <span className={styles.cardMeta}>Daily, last 30 days</span>
        </header>
        <div className={styles.costLayout}>
          <div className={styles.costTotals}>
            <div>
              <span className={styles.costTotalLabel}>Last 7 days</span>
              <span className={styles.costTotalValue}>
                ${(costs.totalCents7d / 100).toFixed(2)}
              </span>
            </div>
            <div>
              <span className={styles.costTotalLabel}>Last 30 days</span>
              <span className={styles.costTotalValue}>
                ${(costs.totalCents30d / 100).toFixed(2)}
              </span>
            </div>
          </div>
          <div className={styles.costSparkWrap}>
            <Sparkline
              points={costs.byDay.map((d) => d.cents)}
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
          <h2 className={styles.cardTitle}>Company activity</h2>
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
