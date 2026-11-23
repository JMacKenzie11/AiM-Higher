"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CommitmentWithMeta } from "@/lib/commitments/service";
import type { HonorRoll } from "@/lib/welcome/honor-roll";
import type { WeekWins, WelcomeRecap } from "@/lib/welcome/data";
import { formatShortDate } from "@/lib/dates";
import { useRegisterCommitment, useWorkDrawer, type CommitmentContext } from "@/components/work-drawer/context";
import { RecapPlayer } from "./RecapPlayer";
import styles from "./welcome.module.css";

// THE SCOREBOARD (Jason, 2026-11-19): the recap video, last week's
// Follow-Through, what is done so far this week, the week in review,
// the honor roll, and the open commitments ahead. A commitment opens
// the same drawer as on Commitments, with the same edits. The "This
// week" tab of the Dashboard (Jason, 2026-11-21); the page header and
// tabs are the page's own (dashboard/page.tsx).

export type WelcomeBoardProps = {
  recap: WelcomeRecap | null;
  followThrough: { rate: number | null; keptOnTime: number; resolved: number };
  honor: HonorRoll;
  wins: WeekWins;
  // The week in review (BriefSection), streamed by the page.
  brief: ReactNode;
  open: CommitmentWithMeta[];
  writable: string[];
  todayIso: string;
  currentUserId: string;
  isAdmin: boolean;
  roster: CommitmentContext["roster"];
  priorityOptions: CommitmentContext["priorityOptions"];
  functionalAreaOptions: CommitmentContext["functionalAreaOptions"];
};

// Cards a lane shows before "Show N more", so a company far behind sees
// the shape of its week rather than a wall of cards.
const LANE_SHOWS = 6;

const CONFETTI = ["var(--aims-chartreuse)", "var(--aims-sky)", "var(--aims-white)", "var(--aims-cobalt)"];

function weekdayLabel(iso: string): string {
  const weekday = new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
  return `${weekday}, ${formatShortDate(iso)}`;
}

function useCountUp(target: number | null): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (target === null) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setN(target);
      return;
    }
    let v = 0;
    const timer = window.setInterval(() => {
      v = Math.min(target, v + Math.max(1, Math.round(target / 25)));
      setN(v);
      if (v >= target) window.clearInterval(timer);
    }, 40);
    return () => window.clearInterval(timer);
  }, [target]);
  return n;
}

export function WelcomeBoard(props: WelcomeBoardProps) {
  const { recap, followThrough, honor, wins, open, todayIso } = props;
  const pct = useCountUp(followThrough.rate);
  const [mode, setMode] = useState<"day" | "person">("day");
  // Lanes opened past their first few cards, by mode and lane.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());

  const pastDue = useMemo(() => open.filter((c) => c.due_date < todayIso), [open, todayIso]);
  const winRows = useMemo(() => {
    const max = wins.people[0]?.n ?? 1;
    return wins.people.slice(0, 5).map((p) => ({ ...p, w: `${(p.n / max) * 100}%` }));
  }, [wins]);

  const lanes = useMemo(() => {
    if (mode === "day") {
      const out: Array<{ key: string; title: string; past: boolean; items: Array<{ c: CommitmentWithMeta; top: string }> }> = [];
      if (pastDue.length > 0) {
        out.push({
          key: "past",
          title: "Past due",
          past: true,
          items: pastDue.map((c) => ({ c, top: `${c.owner?.full_name ?? "Unassigned"} · was due ${formatShortDate(c.due_date)}` })),
        });
      }
      const byDate = new Map<string, CommitmentWithMeta[]>();
      for (const c of open) {
        if (c.due_date < todayIso) continue;
        byDate.set(c.due_date, [...(byDate.get(c.due_date) ?? []), c]);
      }
      for (const [date, cs] of byDate) {
        out.push({
          key: date,
          title: date === todayIso ? `Today, ${formatShortDate(date)}` : weekdayLabel(date),
          past: false,
          items: cs.map((c) => ({ c, top: c.owner?.full_name ?? "Unassigned" })),
        });
      }
      return out;
    }
    const byPerson = new Map<string, CommitmentWithMeta[]>();
    for (const c of open) {
      const name = c.owner?.full_name ?? "Unassigned";
      byPerson.set(name, [...(byPerson.get(name) ?? []), c]);
    }
    return [...byPerson.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([name, cs]) => ({
        key: name,
        title: name,
        past: false,
        items: cs.map((c) => ({
          c,
          top: c.due_date < todayIso ? `Was due ${formatShortDate(c.due_date)}` : weekdayLabel(c.due_date),
        })),
      }));
  }, [mode, open, pastDue, todayIso]);

  const writable = useMemo(() => new Set(props.writable), [props.writable]);
  const gaugeOff = followThrough.rate === null ? 283 : 283 - (283 * followThrough.rate) / 100;

  return (
    <div className={styles.page}>
      <div className={styles.bento}>
        <section className={`${styles.tile} ${styles.vid} ${styles.pop}`} style={{ animationDelay: "0.05s" }} aria-label="Weekly recap video">
          <div className={styles.frame}>
            {recap ? (
              <RecapPlayer src={recap.embedUrl} />
            ) : (
              <div className={styles.noVideo}>
                <span className={styles.noVideoIcon} aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path d="M8 5l11 7-11 7z" fill="var(--aims-chartreuse)" />
                  </svg>
                </span>
                This week&apos;s recap video shows here when it&apos;s ready.
              </div>
            )}
          </div>
        </section>

        <section className={`${styles.tile} ${styles.navy} ${styles.score} ${styles.pop}`} style={{ animationDelay: "0.12s" }}>
          <p className={styles.lbl}>Follow-through last week</p>
          {followThrough.rate === null ? (
            <p className={styles.quiet}>No commitments were due last week.</p>
          ) : (
            <div
              className={styles.gauge}
              role="img"
              aria-label={`${followThrough.keptOnTime} of ${followThrough.resolved} commitments kept on time, ${followThrough.rate} percent`}
            >
              <svg viewBox="0 0 200 120" aria-hidden="true">
                <path d="M10 110 A90 90 0 0 1 190 110" fill="none" stroke="#2C4165" strokeWidth="16" strokeLinecap="round" />
                <path
                  className={styles.arc}
                  d="M10 110 A90 90 0 0 1 190 110"
                  fill="none"
                  stroke="var(--aims-chartreuse)"
                  strokeWidth="16"
                  strokeLinecap="round"
                  style={{ ["--off" as string]: gaugeOff }}
                />
              </svg>
              <div className={styles.num}>
                <b>{pct}%</b>
                <span>
                  {followThrough.keptOnTime} of {followThrough.resolved} kept on time
                </span>
              </div>
            </div>
          )}
        </section>

        <section className={`${styles.tile} ${styles.wins} ${styles.pop}`} style={{ animationDelay: "0.19s" }}>
          <p className={styles.lbl}>Done this week</p>
          <div className={styles.lnum}>{wins.total}</div>
          {wins.total === 0 ? (
            <p className={styles.empty} style={{ marginTop: 12 }}>The first wins of the week show here.</p>
          ) : (
            <div className={styles.lwho}>
              {winRows.map((l) => (
                <div key={l.name} className={styles.lrow}>
                  <span title={l.name}>{l.name}</span>
                  <span className={styles.lbar}>
                    <i style={{ width: l.w }} />
                  </span>
                  <span>{l.n}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className={`${styles.briefSlot} ${styles.pop}`} style={{ animationDelay: "0.24s" }}>
          {props.brief}
        </div>

        <section className={`${styles.tile} ${styles.honor} ${styles.pop}`} style={{ animationDelay: "0.26s" }}>
          <p className={styles.lbl} style={{ margin: 0 }}>
            Honor roll
          </p>
          {honor.mode === "none" ? (
            <p className={styles.honorEmpty}>Nobody kept a commitment due last week yet.</p>
          ) : (
            <div className={styles.podium}>
              {honor.people.map((h) => (
                <article key={h.id} className={`${styles.hero} ${h.lead ? styles.gold : ""}`}>
                  {h.celebrate
                    ? Array.from({ length: 10 }, (_, c) => (
                        <span
                          key={c}
                          className={styles.conf}
                          aria-hidden="true"
                          style={{
                            left: `${8 + c * 9}%`,
                            background: CONFETTI[c % 4],
                            animationDelay: `${(c * 0.33).toFixed(2)}s`,
                            animationDuration: `${2.6 + (c % 3) * 0.6}s`,
                          }}
                        />
                      ))
                    : null}
                  <span className={styles.medal} aria-hidden="true">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--aims-navy)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12l4 4L19 6" />
                    </svg>
                  </span>
                  <span className={styles.ribbon}>{h.ribbon}</span>
                  <div className={styles.hn}>{h.name}</div>
                  <div className={styles.hw}>{h.why}</div>
                </article>
              ))}
            </div>
          )}
          {honor.more > 0 ? (
            <p className={styles.more}>
              And {honor.more} more with a clean sweep.
            </p>
          ) : null}
        </section>

        <section className={`${styles.tile} ${styles.ahead} ${styles.pop}`} style={{ animationDelay: "0.33s" }}>
          <div className={styles.aheadHead}>
            <p className={styles.lbl} style={{ margin: 0 }}>
              Open commitments
            </p>
            <div className={styles.seg} role="group" aria-label="Group by">
              <button type="button" aria-pressed={mode === "day"} onClick={() => setMode("day")}>
                By day
              </button>
              <button type="button" aria-pressed={mode === "person"} onClick={() => setMode("person")}>
                By person
              </button>
            </div>
          </div>
          {open.length === 0 ? (
            <p className={styles.empty}>Nothing open for the coming week.</p>
          ) : (
            <div className={styles.lanes}>
              {lanes.map((ln) => (
                <div key={ln.key} className={`${styles.lane} ${ln.past ? styles.past : ""}`}>
                  <h3>
                    {ln.title}
                    <span>{ln.items.length}</span>
                  </h3>
                  {(opened.has(`${mode}:${ln.key}`) ? ln.items : ln.items.slice(0, LANE_SHOWS)).map(({ c, top }, k) => (
                    <CommitmentCard
                      key={c.id}
                      commitment={c}
                      top={top}
                      delay={k}
                      mine={c.owner_id === props.currentUserId}
                      ctx={{
                        roster: props.roster,
                        priorityOptions: props.priorityOptions,
                        functionalAreaOptions: props.functionalAreaOptions,
                        todayIso,
                        canResolve: writable.has(c.id),
                        canLink: writable.has(c.id),
                        canReassign: writable.has(c.id),
                        currentUserId: props.currentUserId,
                        isAdmin: props.isAdmin,
                      }}
                    />
                  ))}
                  {ln.items.length > LANE_SHOWS && !opened.has(`${mode}:${ln.key}`) ? (
                    <button
                      type="button"
                      className={styles.showMore}
                      onClick={() => setOpened((prev) => new Set(prev).add(`${mode}:${ln.key}`))}
                    >
                      Show {ln.items.length - LANE_SHOWS} more
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CommitmentCard({
  commitment,
  top,
  delay,
  mine,
  ctx,
}: {
  commitment: CommitmentWithMeta;
  top: string;
  delay: number;
  mine: boolean;
  ctx: CommitmentContext;
}) {
  useRegisterCommitment(commitment, ctx);
  const drawer = useWorkDrawer();
  return (
    <button
      type="button"
      className={`${styles.card} ${mine ? styles.mine : ""}`}
      style={{ animationDelay: `${Math.min(delay, 12) * 0.05}s` }}
      data-commitment-id={commitment.id}
      onClick={(e) => drawer?.openCommitment(commitment.id, e.currentTarget)}
    >
      <b>{top}</b>
      {commitment.description}
    </button>
  );
}
