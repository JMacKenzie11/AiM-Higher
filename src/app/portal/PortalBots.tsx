"use client";

import { useState } from "react";
import type { PortalBot } from "@/lib/diagnostics/portal";
import styles from "./portal.module.css";

// A client's bots as cards (0310, the approved portal mockup): the
// status, the last runs as a strip, this week's runs and hours, the
// hours in total, the schedule and the last run. A card opens its
// details: how the saving is counted, when it runs, the last eight
// weeks and the recent runs. Never why a run failed.

const TONE: Record<string, string> = {
  running_well: styles.chipGood,
  late: styles.chipWarn,
  needs_attention: styles.chipWarn,
  stopped: styles.chipBad,
  not_live: styles.chipQuiet,
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not yet";
const hours = (h: number) => (Math.round(h * 10) / 10).toLocaleString("en-CA");
const money = (n: number, c: string) => `$${Math.round(n).toLocaleString("en-CA")} ${c}`;
const plural = (n: number, noun: string) => `${n.toLocaleString("en-CA")} ${n === 1 ? noun : `${noun}s`}`;

export function PortalBots({ bots }: { bots: PortalBot[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const sel = bots.find((b) => b.id === open) ?? null;
  return (
    <>
      <div className={styles.botGrid}>
        {bots.map((b) => (
          <button
            key={b.id}
            type="button"
            className={styles.botCard}
            aria-expanded={open === b.id}
            aria-controls="portal-bot-details"
            onClick={() => setOpen(open === b.id ? null : b.id)}
          >
            <span className={styles.itemHead}>
              <span className={styles.itemTitle}>{b.name}</span>
              <span className={`${styles.chip} ${TONE[b.status]}`}>{b.statusLabel}</span>
            </span>
            <span className={styles.strip} aria-label={`Last ${b.strip.length} runs: ${b.strip.filter((r) => r === "worked").length} worked`}>
              {b.strip.map((r, i) => (
                <span key={i} data-result={r} />
              ))}
            </span>
            <span className={styles.botStats}>
              <span>
                <span className={styles.muted}>Runs this week</span>
                <strong>{b.runsThisWeek}</strong>
              </span>
              <span>
                <span className={styles.muted}>Hours this week</span>
                <strong>{hours(b.hoursThisWeek)}</strong>
              </span>
              <span>
                <span className={styles.muted}>Hours in total</span>
                <strong>{hours(b.hoursTotal)}</strong>
              </span>
            </span>
            <span className={styles.botFoot}>
              <span>{b.schedule}</span>
              <span>Last run {when(b.lastRunAt)}</span>
            </span>
          </button>
        ))}
      </div>

      {sel ? (
        <section id="portal-bot-details" className={styles.card} aria-label={`${sel.name} details`}>
          <div className={styles.itemHead}>
            <h3 className={styles.cardTitle}>{sel.name}</h3>
            <button type="button" className={styles.signOutDark} onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
          <div className={styles.detailGrid}>
            <div className={styles.detailCol}>
              <span className={styles.detailLabel}>How we count it</span>
              <div className={styles.formula}>
                <div>
                  {plural(sel.itemsThisWeek, sel.itemNoun)} × {hours(sel.minutesPerItem)} minutes = {hours(sel.hoursThisWeek)} hours this week
                  {sel.hourlyRate ? `, worth ${money(sel.dollarsThisWeek, sel.currency)}` : ""}.
                </div>
                <div className={styles.muted}>
                  {hours(sel.minutesPerItem)} minutes a{/^[aeiou]/i.test(sel.itemNoun) ? "n" : ""} {sel.itemNoun}
                  {sel.hourlyRate ? ` and $${hours(sel.hourlyRate)} an hour were` : " was"} agreed with you
                  {sel.agreedOn ? ` on ${new Date(`${sel.agreedOn}T12:00:00Z`).toLocaleDateString("en-CA", { month: "long", day: "numeric" })}` : ""}. A run
                  that fails saves nothing.
                </div>
              </div>
              <span className={styles.detailLabel}>When it runs</span>
              <span>{sel.schedule}</span>
              <span className={styles.muted}>{sel.expectation}</span>
            </div>
            <div className={styles.detailCol}>
              <span className={styles.detailLabel}>Hours saved, last 8 weeks</span>
              <WeekBars weeks={sel.weeks} />
            </div>
          </div>
          <div>
            <span className={styles.detailLabel}>Recent runs</span>
            {sel.recent.length === 0 ? (
              <p className={styles.muted}>No runs yet.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Result</th>
                      <th>Handled</th>
                      <th>Time saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sel.recent.map((r, i) => (
                      <tr key={i}>
                        <td>{when(r.ranAt)}</td>
                        <td className={r.result === "failed" ? styles.bad : undefined}>{r.result === "worked" ? "Worked" : "Did not finish"}</td>
                        <td>{r.result === "worked" ? plural(r.items, sel.itemNoun) : ""}</td>
                        <td>{r.minutes >= 60 ? `${hours(r.minutes / 60)} h` : `${Math.round(r.minutes)} min`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : null}
    </>
  );
}

function WeekBars({ weeks }: { weeks: PortalBot["weeks"] }) {
  const max = Math.max(1, ...weeks.map((w) => w.hours));
  return (
    <figure className={styles.weekBars} aria-label={weeks.map((w) => `Week of ${w.start}: ${hours(w.hours)} hours`).join("; ")}>
      <div className={styles.weekPlot} aria-hidden="true">
        {weeks.map((w) => (
          <span key={w.start}>
            <span className={styles.muted}>{hours(w.hours)}</span>
            <span className={styles.weekBar} style={{ height: `${Math.round((w.hours / max) * 80)}px` }} />
          </span>
        ))}
      </div>
      <div className={styles.weekLabels} aria-hidden="true">
        {weeks.map((w) => (
          <span key={w.start}>{new Date(`${w.start}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}</span>
        ))}
      </div>
    </figure>
  );
}
