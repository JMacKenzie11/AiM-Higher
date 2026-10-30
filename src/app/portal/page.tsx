import Link from "next/link";
import { getPortal, getPortalProposals } from "@/lib/diagnostics/service";
import { BUILD_STEPS, portalBanner, portalBot, portalProject, portalTotals, sortPortalBots } from "@/lib/diagnostics/portal";
import { weekStartUtc } from "@/lib/diagnostics/bots";
import { stageLabel, type AutomationRow } from "@/lib/diagnostics/types";
import { shortDate } from "../(app)/diagnostics/format";
import { PortalBots } from "./PortalBots";
import { BotsPlaceholder, ProjectCard } from "./ProjectCard";
import styles from "./portal.module.css";

// A CLIENT'S DASHBOARD (0307, 0310; Jason, 2026-10-29, the approved
// portal mockup). Three numbers (hours saved this week, in total, and
// the money), a line on any bot needing a look, one card per bot, the
// automations being built with where each is, and the published
// readout. Read as the person: portal_client() and portal_dashboard()
// return their own client's rows and never a failure's reason. Until
// the first automation goes live, "Your project" (0311) leads instead:
// the four stages and what is happening now. A proposal waiting for
// the owner's signature (0312) comes before everything else on the page
// but that card, so it is the first thing they see after signing in.

const hours = (h: number) => (Math.round(h * 10) / 10).toLocaleString("en-CA");

function dates(a: AutomationRow): string {
  if (a.build_starts && a.goes_live) return `${shortDate(a.build_starts)} to ${shortDate(a.goes_live)}`;
  if (a.goes_live) return `Goes live ${shortDate(a.goes_live)}`;
  if (a.build_starts) return `Build starts ${shortDate(a.build_starts)}`;
  return "Dates to come";
}

export default async function PortalPage() {
  const [view, proposals] = await Promise.all([getPortal(), getPortalProposals()]);
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
  const now = new Date();
  const bots = sortPortalBots(view.bots.map((b) => portalBot(b, now)));
  const totals = portalTotals(
    bots,
    view.bots.map((b) => b.first_run_at),
    view.bots.map((b) => b.automation.goes_live)
  );
  const banner = portalBanner(bots);
  const withBot = new Set(view.bots.map((b) => b.automation.id));
  const building = view.automations.filter((a) => a.stage !== "live");
  const liveNoBot = view.automations.filter((a) => a.stage === "live" && !withBot.has(a.id));
  const change = totals.hoursThisWeek - totals.hoursLastWeek;
  const weekOf = new Date(weekStartUtc(now)).toLocaleDateString("en-CA", { month: "long", day: "numeric", timeZone: "UTC" });
  const project = bots.length ? null : portalProject(view.diagnostic, view.automations, now.toISOString().slice(0, 10));

  return (
    <>
      <div className={styles.hero}>
        <div className={`${styles.heroInner} ${project ? styles.heroOverlap : ""}`}>
          <h1 className={styles.title}>Your automations</h1>
          <p className={styles.eyebrow}>{project ? "Here is where your project stands." : `Week of ${weekOf}. Figures update each time a bot runs.`}</p>
        </div>
      </div>
      <main className={`${styles.main} ${project ? styles.mainOverlap : ""}`}>
        {project ? <ProjectCard project={project} readoutPublished={Boolean(view.readoutPublishedAt)} /> : null}

        {proposals
          .filter((p) => !p.client_signed_at)
          .map((p) => (
            <section key={p.id} className={`${styles.card} ${styles.readoutCard} ${styles.proposalCard}`} aria-labelledby={`proposal-${p.id}`}>
              <div>
                <p className={styles.proposalKick}>Ready for your signature</p>
                <h2 id={`proposal-${p.id}`} className={styles.cardTitle}>
                  {p.title}
                </h2>
                <p className={styles.muted}>Version {p.version}, sent {shortDate(p.published_at.slice(0, 10))}. Read it through, then sign it on the same page.</p>
              </div>
              <span className={styles.actions}>
                <Link href={`/portal/proposals/${p.id}`} className={styles.primaryLink}>
                  Review and sign
                </Link>
              </span>
            </section>
          ))}

        {bots.length ? (
          <section className={styles.totals} aria-label="Totals">
            <div className={styles.total}>
              <span className={styles.muted}>Hours saved this week</span>
              <span className={styles.totalValue}>{hours(totals.hoursThisWeek)}</span>
              <span className={change >= 0 ? styles.good : styles.muted}>
                {change === 0 ? "The same as last week" : `${change > 0 ? "Up" : "Down"} ${hours(Math.abs(change))} hours on last week`}
              </span>
            </div>
            <div className={styles.total}>
              <span className={styles.muted}>Hours saved in total</span>
              <span className={styles.totalValue}>{hours(totals.hoursTotal)}</span>
              <span className={styles.muted}>{totals.firstLive ? `Since the first bot went live on ${shortDate(totals.firstLive)}` : "Since the first bot went live"}</span>
            </div>
            <div className={styles.total}>
              <span className={styles.muted}>Saved to date</span>
              <span className={styles.totalValue}>
                ${Math.round(totals.dollarsTotal).toLocaleString("en-CA")} <span className={styles.currency}>{totals.currency}</span>
              </span>
              <span className={styles.muted}>
                {totals.rate ? `${hours(totals.hoursTotal)} hours at the agreed $${hours(totals.rate)} an hour` : `${hours(totals.hoursTotal)} hours at the agreed rates`}
              </span>
            </div>
          </section>
        ) : null}

        {banner ? (
          <section className={styles.banner} data-tone={banner.tone} aria-label="Status">
            <strong>{banner.lead}</strong> {banner.detail}
          </section>
        ) : null}

        <section className={styles.section} aria-labelledby="portal-bots">
          <div className={styles.itemHead}>
            <h2 id="portal-bots" className={styles.sectionTitle}>
              Your bots
            </h2>
            {bots.length ? (
              <span className={styles.legend}>
                <span data-result="worked">Worked</span>
                <span data-result="failed">Did not finish</span>
              </span>
            ) : null}
          </div>
          {bots.length ? (
            <PortalBots bots={bots} />
          ) : liveNoBot.length ? null : (
            <BotsPlaceholder next={project?.at === 2 ? project.next : null} full={!project || project.at < 2} />
          )}
          {liveNoBot.length ? (
            <ul className={styles.list}>
              {liveNoBot.map((a) => (
                <li key={a.id} className={styles.item}>
                  <div className={styles.itemHead}>
                    <span className={styles.itemTitle}>{a.title}</span>
                    <span className={`${styles.chip} ${styles.chipGood}`}>Live</span>
                  </div>
                  <p className={styles.muted}>{a.goes_live ? `Live since ${shortDate(a.goes_live)}` : "Live"}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {building.length ? (
          <section className={styles.section} aria-labelledby="portal-building">
            <div>
              <h2 id="portal-building" className={styles.sectionTitle}>
                Being built
              </h2>
              <p className={styles.muted}>Each automation moves to Your bots when it goes live.</p>
            </div>
            {building.map((a) => {
              const at = BUILD_STEPS.indexOf(a.stage as (typeof BUILD_STEPS)[number]);
              return (
                <div key={a.id} className={styles.project}>
                  <div className={styles.projectText}>
                    <div className={styles.itemHead}>
                      <span className={styles.itemTitle}>{a.title}</span>
                      {a.stage === "paused" ? <span className={`${styles.chip} ${styles.chipQuiet}`}>Paused</span> : null}
                    </div>
                    <p className={styles.muted}>
                      {dates(a)}
                      {a.champion ? ` · Champion: ${a.champion}` : ""}
                    </p>
                    {a.latest_update ? (
                      <p className={styles.update}>
                        {a.latest_update_at ? <span className={styles.muted}>{shortDate(a.latest_update_at)}: </span> : null}
                        {a.latest_update}
                      </p>
                    ) : null}
                  </div>
                  <ol className={styles.stepper} aria-label={`Stage: ${stageLabel(a.stage)}`}>
                    {BUILD_STEPS.map((s, i) => (
                      <li key={s} data-state={a.stage === "paused" ? "paused" : i < at ? "done" : i === at ? "current" : "todo"} aria-current={i === at ? "step" : undefined}>
                        <span className={styles.stepDot} aria-hidden="true" />
                        <span>{stageLabel(s)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </section>
        ) : null}

        {proposals
          .filter((p) => p.client_signed_at)
          .map((p) => (
            <section key={p.id} className={`${styles.card} ${styles.readoutCard}`} aria-labelledby={`proposal-${p.id}`}>
              <div>
                <h2 id={`proposal-${p.id}`} className={styles.cardTitle}>
                  {p.title}
                </h2>
                <p className={styles.muted}>Signed {shortDate(p.client_signed_at!.slice(0, 10))}. Version {p.version}.</p>
              </div>
              <span className={styles.actions}>
                <Link href={`/portal/proposals/${p.id}`} className={styles.secondaryLink}>
                  Read it here
                </Link>
                <a href={`/portal/proposals/${p.id}/pdf`} className={styles.primaryLink}>
                  Download the PDF
                </a>
              </span>
            </section>
          ))}

        {view.readoutPublishedAt ? (
          <section className={`${styles.card} ${styles.readoutCard}`} aria-labelledby="portal-readout">
            <div>
              <h2 id="portal-readout" className={styles.cardTitle}>
                Your Capacity Diagnostic readout
              </h2>
              <p className={styles.muted}>
                Published {shortDate(view.readoutPublishedAt.slice(0, 10))}. Where the hours were going, the first win, and the 90-day roadmap these automations came from.
              </p>
            </div>
            <span className={styles.actions}>
              <Link href="/portal/readout" className={styles.secondaryLink}>
                Read it here
              </Link>
              <a href="/portal/readout/pdf" className={styles.primaryLink}>
                Download the PDF
              </a>
            </span>
          </section>
        ) : null}
      </main>
    </>
  );
}
