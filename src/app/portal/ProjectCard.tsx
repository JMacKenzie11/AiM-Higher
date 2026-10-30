import Link from "next/link";
import { monthDay, type PortalProject, type ProjectStepKey } from "@/lib/diagnostics/portal";
import styles from "./portal.module.css";

// "YOUR PROJECT" (0311; Jason, 2026-10-30, the approved mockup). The
// four stages with the current one marked, a date under each, and what
// is happening now. Sits over the hero's lower edge; shown until the
// first automation goes live. And the bots placeholder beneath it.

const ICONS: Record<ProjectStepKey | "done", React.ReactNode> = {
  diagnostic: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  readout: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M9 12h7M9 16h7M9 8h3" />
    </>
  ),
  building: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />,
  running: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M12 4v4M9 13h.01M15 13h.01M10 16.5h4" />
    </>
  ),
  done: <path d="M5 12.5l4.5 4.5L19 7.5" />,
};

const STATE_WORD = { done: "Done", current: "Now", todo: null } as const;

export function ProjectCard({ project, readoutPublished }: { project: PortalProject; readoutPublished: boolean }) {
  return (
    <section className={`${styles.card} ${styles.projectCard}`} aria-labelledby="portal-project">
      <div className={styles.itemHead}>
        <h2 id="portal-project" className={styles.sectionTitle}>
          Your project
        </h2>
        <span className={styles.muted}>Step {project.at + 1} of 4</span>
      </div>
      <ol className={styles.journey}>
        {project.steps.map((s) => (
          <li key={s.key} data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
            <div className={styles.journeyHead}>
              <span className={styles.journeyIcon}>
                <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {ICONS[s.state === "done" ? "done" : s.key]}
                </svg>
              </span>
              {STATE_WORD[s.state] ? <span className={styles.journeyWord}>{STATE_WORD[s.state]}</span> : null}
            </div>
            <strong className={styles.journeyTitle}>{s.title}</strong>
            {s.state === "done" ? null : <span className={styles.journeyAbout}>{s.about}</span>}
            <span className={styles.muted}>
              {s.when}
              {s.key === "readout" && readoutPublished ? (
                <>
                  {" · "}
                  <Link href="/portal/readout" className={styles.link}>
                    Read it
                  </Link>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      <p className={styles.nowLine}>
        <span className={styles.nowLabel}>What happens now</span>
        <span>{project.now}</span>
      </p>
    </section>
  );
}

// A friendly bot and, while the diagnostic is on, the three numbers the
// dashboard will show, at nothing yet.
export function BotsPlaceholder({ next, full }: { next: PortalProject["next"]; full: boolean }) {
  return (
    <div className={`${styles.card} ${styles.botsEmpty}`} data-full={full ? "true" : undefined}>
      <svg aria-hidden="true" className={styles.botArt} viewBox="0 0 180 150" fill="none">
        <circle cx="90" cy="78" r="66" fill="var(--aims-sky-tint)" />
        <path d="M90 22v14" stroke="#1F3352" strokeWidth="3" strokeLinecap="round" />
        <circle cx="90" cy="18" r="6" fill="#D6E264" stroke="#1F3352" strokeWidth="3" />
        <rect x="48" y="36" width="84" height="66" rx="18" fill="#FFFFFF" stroke="#1F3352" strokeWidth="3" />
        <circle cx="74" cy="66" r="7" fill="#3551A4" />
        <circle cx="106" cy="66" r="7" fill="#3551A4" />
        <path d="M78 84c6 6 18 6 24 0" stroke="#1F3352" strokeWidth="3" strokeLinecap="round" />
        <rect x="40" y="58" width="8" height="20" rx="4" fill="#1F3352" />
        <rect x="132" y="58" width="8" height="20" rx="4" fill="#1F3352" />
        {full ? (
          <g transform="translate(48 116)">
            {[0, 14, 28, 42, 56, 70].map((x, i) => (
              <rect key={x} x={x} y="0" width="10" height="16" rx="3" fill={i < 4 ? "#3E7141" : "#C9CED8"} />
            ))}
          </g>
        ) : null}
      </svg>
      <div className={styles.botsEmptyText}>
        <div>
          <h3 className={styles.cardTitle}>{next ? `${next.title} will be your first bot` : "Your first bot will appear here"}</h3>
          <p className={styles.muted}>
            {next?.goesLive
              ? `From ${monthDay(next.goesLive)} you will see each run here, the hours it saves and what that time is worth.`
              : "Once a bot goes live, this page shows each time it runs, the hours it saves your team, and what that time is worth."}
          </p>
        </div>
        {full ? (
          <div className={styles.ghostTotals}>
            {["Hours saved this week", "Hours saved in total", "Saved to date"].map((label, i) => (
              <div key={label} className={styles.ghostTotal}>
                <span className={styles.muted}>{label}</span>
                <span className={styles.ghostValue}>{i === 2 ? "$0" : "0"}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
