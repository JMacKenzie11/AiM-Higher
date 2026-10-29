import Link from "next/link";
import { requireDiagnostics } from "@/lib/diagnostics/access";
import { listBots } from "@/lib/diagnostics/service";
import { botSchedule, type BotStatus } from "@/lib/diagnostics/bots";
import { PageShell } from "@/components/ui/PageShell";
import { SectionNav } from "../SectionNav";
import { BotChip } from "../clients/[id]/BotSection";
import styles from "../diagnostics.module.css";

export const metadata = { title: "Bots" };

// EVERY CLIENT'S BOTS (0308), for the system admin who keeps them: the
// ones needing a look first (Stopped, then Needs attention, then Late),
// then the rest, with why and the hours each saved this week. The same
// health the webhook and the MCP list tools report (lib/diagnostics/bots.ts).

const ORDER: Record<BotStatus, number> = { stopped: 0, needs_attention: 1, late: 2, running_well: 3, not_live: 4 };
const PROBLEM = (s: BotStatus) => s === "stopped" || s === "needs_attention" || s === "late";

function lastRun(iso: string | null): string {
  if (!iso) return "None yet";
  return new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export default async function BotsPage() {
  await requireDiagnostics();
  const bots = (await listBots()).sort(
    (a, b) => ORDER[a.health.status] - ORDER[b.health.status] || a.client.name.localeCompare(b.client.name) || a.automation.title.localeCompare(b.automation.title)
  );
  const today = new Date();
  const dayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const needLook = bots.filter((b) => PROBLEM(b.health.status)).length;
  const well = bots.filter((b) => b.health.status === "running_well").length;
  const hoursWeek = bots.reduce((n, b) => n + b.savings.hoursThisWeek, 0);
  const runsToday = bots.reduce((n, b) => n + b.recent.filter((r) => Date.parse(r.ran_at) >= dayStart).length, 0);

  return (
    <PageShell
      eyebrow="Capacity Diagnostic"
      title="Bots"
      subtitle="Every client's bots, the ones needing a look first."
      flush
    >
      <SectionNav current="bots" />
      <section className={styles.figures} aria-label="Totals">
        <Figure value={String(needLook)} label="Need a look" tone={needLook > 0 ? "bad" : undefined} />
        <Figure value={String(well)} label="Running well" tone="good" />
        <Figure value={hoursWeek.toFixed(1)} label="Hours saved this week, all clients" />
        <Figure value={String(runsToday)} label="Runs reported today (UTC)" />
      </section>

      <section className={styles.card} aria-labelledby="dx-bots">
        <div className={styles.cardHeader}>
          <h2 id="dx-bots" className={styles.cardTitle}>
            Needing a look first, then the rest
          </h2>
          <span className={styles.cardMeta}>{bots.length}</span>
        </div>
        {bots.length === 0 ? (
          <p className={styles.empty}>No bots yet. Add one to an automation on a client&rsquo;s page.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Bot</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Why</th>
                  <th>Last run</th>
                  <th className={styles.num}>Hours this week</th>
                </tr>
              </thead>
              <tbody>
                {bots.map((b) => (
                  <tr key={b.bot.id}>
                    <td>
                      <Link href={`/diagnostics/clients/${b.client.id}`} className={styles.link}>
                        {b.automation.title}
                      </Link>
                      <div className={styles.muted}>
                        {botSchedule(b.bot)} · <code>{b.bot.code}</code>
                      </div>
                    </td>
                    <td>{b.client.name}</td>
                    <td>
                      <BotChip status={b.health.status} />
                    </td>
                    <td className={styles.muted}>{b.health.reason ?? ""}</td>
                    <td>{lastRun(b.lastRunAt)}</td>
                    <td className={styles.num}>{b.savings.hoursThisWeek.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageShell>
  );
}

function Figure({ value, label, tone }: { value: string; label: string; tone?: "good" | "bad" }) {
  return (
    <div className={styles.figure}>
      <span className={`${styles.figureValue} ${tone === "bad" ? styles.figureBad : tone === "good" ? styles.figureGood : ""}`}>{value}</span>
      <span className={styles.figureLabel}>{label}</span>
    </div>
  );
}
