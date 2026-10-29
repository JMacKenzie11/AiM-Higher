import { getPortal } from "@/lib/diagnostics/service";
import { stageLabel, type AutomationRow } from "@/lib/diagnostics/types";
import { shortDate } from "../(app)/diagnostics/format";
import styles from "./portal.module.css";

// A client's dashboard (0307). For now, the automations being built
// for them, read only: where each one is, when it goes live, who
// champions it, and the latest update. The bots' health and savings
// join it once bots report their runs.

const TONE: Record<string, string> = {
  live: styles.chipGood,
  testing: styles.chipWarn,
  building: styles.chipInfo,
  planned: styles.chipQuiet,
  paused: styles.chipQuiet,
};

function when(a: AutomationRow): string {
  if (a.stage === "live") return a.goes_live ? `Live since ${shortDate(a.goes_live)}` : "Live";
  if (a.build_starts && a.goes_live) return `${shortDate(a.build_starts)} to ${shortDate(a.goes_live)}`;
  if (a.goes_live) return `Goes live ${shortDate(a.goes_live)}`;
  if (a.build_starts) return `Build starts ${shortDate(a.build_starts)}`;
  return "Dates to come";
}

export default async function PortalPage() {
  const view = await getPortal();
  if (!view) {
    return (
      <main className={styles.main}>
        <section className={styles.card}>
          <h1 className={styles.cardTitle}>Nothing to show yet</h1>
          <p className={styles.muted}>Your dashboard isn&rsquo;t set up yet. The person running your diagnostic will let you know when it is.</p>
        </section>
      </main>
    );
  }
  const { client, automations } = view;
  return (
    <>
      <div className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Your automations</p>
          <h1 className={styles.title}>{client.name}</h1>
        </div>
      </div>
      <main className={styles.main}>
        <section className={styles.card} aria-labelledby="portal-automations">
          <h2 id="portal-automations" className={styles.cardTitle}>
            Automations
          </h2>
          {automations.length === 0 ? (
            <p className={styles.muted}>None yet. They appear here as they are planned.</p>
          ) : (
            <ul className={styles.list}>
              {automations.map((a) => (
                <li key={a.id} className={styles.item}>
                  <div className={styles.itemHead}>
                    <span className={styles.itemTitle}>{a.title}</span>
                    <span className={`${styles.chip} ${TONE[a.stage] ?? styles.chipQuiet}`}>{stageLabel(a.stage)}</span>
                  </div>
                  <p className={styles.muted}>
                    {when(a)}
                    {a.champion ? `. Champion: ${a.champion}` : ""}
                  </p>
                  {a.latest_update ? (
                    <p className={styles.update}>
                      {a.latest_update}
                      {a.latest_update_at ? <span className={styles.muted}> ({shortDate(a.latest_update_at)})</span> : null}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
