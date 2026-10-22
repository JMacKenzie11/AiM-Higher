import type { ReactNode } from "react";
import { PrivacyNote } from "@/components/ui/PrivacyNote";
import { formatHours } from "@/lib/diagnostics/hours-back";
import { hoursBackSentence, joinWishes, percent, PRIVACY_LINE, type ReadoutData } from "@/lib/diagnostics/readout";
import { READOUT_SECTIONS, type ReadoutSection } from "@/lib/diagnostics/types";
import { CapacityMap } from "../CapacityMap";
import { shortDate } from "../../format";
import styles from "../../diagnostics.module.css";

// The readout as the owner reads it, in the order the readout runs. One
// shape for the draft and the published copy; the PDF draws the same
// sections from the same data (lib/diagnostics/pdf/ReadoutPdf.tsx).

const titleOf = (k: ReadoutSection) => READOUT_SECTIONS.find((s) => s.key === k)!.title;

function Section({ k, r, children }: { k: ReadoutSection; r: ReadoutData; children: ReactNode }) {
  return (
    <section className={styles.card} aria-labelledby={`readout-${k}`}>
      <div className={styles.cardHeader}>
        <h2 id={`readout-${k}`} className={styles.cardTitle}>
          {titleOf(k)}
        </h2>
      </div>
      <div className={styles.body}>
        {r.narrative[k] ? <p className={styles.readoutLead}>{r.narrative[k]}</p> : null}
        {children}
      </div>
    </section>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.figure}>
      <span className={styles.figureValue}>{value}</span>
      <span className={styles.figureLabel}>{label}</span>
    </div>
  );
}

export function ReadoutView({ r }: { r: ReadoutData }) {
  const h = r.hoursBack;
  return (
    <>
      <PrivacyNote>{PRIVACY_LINE}</PrivacyNote>

      <Section k="in_their_words" r={r}>
        {r.quotes.length === 0 ? (
          <p className={styles.muted}>No lines approved yet.</p>
        ) : (
          r.quotes.map((q, i) => (
            <blockquote key={i} className={styles.readoutQuote}>
              <p>{q.text}</p>
              {q.name ? <footer>{q.name}</footer> : null}
            </blockquote>
          ))
        )}
      </Section>

      <Section k="first_win" r={r}>
        {r.firstWin ? (
          <>
            <p>
              <strong>{r.firstWin.title}</strong>, a {r.firstWin.pattern.toLowerCase()} for {r.firstWin.serves.toLowerCase() || "the team"} ({r.firstWin.role}).
            </p>
            <div className={styles.figures}>
              <Figure value={formatHours(r.firstWin.baselineMinutes)} label="Minutes per unit before" />
              <Figure value={formatHours(r.firstWin.afterMinutes)} label="Minutes per unit after" />
              <Figure value={formatHours(r.firstWin.unitsPerWeek)} label="Units a week" />
              <Figure
                value={formatHours(r.firstWin.measured)}
                label={r.firstWin.measuredWeekEnding ? `Hours back, week ending ${shortDate(r.firstWin.measuredWeekEnding)}` : "Hours back, measured"}
              />
            </div>
          </>
        ) : (
          <p className={styles.muted}>The first win has not been chosen yet.</p>
        )}
      </Section>

      <Section k="capacity_map" r={r}>
        <CapacityMap points={r.map.points} />
        <div className={styles.figures}>
          <Figure value={String(r.map.tasks)} label="Tasks mapped" />
          <Figure value={String(r.map.candidates)} label="Draining and routine" />
          <Figure value={formatHours(r.map.totalHours)} label="Hours a week on these tasks" />
          <Figure value={formatHours(r.map.candidateHours)} label="Of them, draining and routine" />
          <Figure value={formatHours(r.map.checkedHours)} label="Of them, volume-checked" />
        </div>
      </Section>

      <Section k="hours_back" r={r}>
        <div className={styles.figures}>
          <Figure value={formatHours(h.measured)} label="Measured hours back a week" />
          <Figure value={formatHours(h.projected)} label="Projected hours back a week" />
          <Figure value={percent(h.recoveryRate)} label="Recovery rate" />
          <Figure
            value={h.guaranteeMet == null ? "Not yet" : h.guaranteeMet ? "Met" : "Not met"}
            label={`Guarantee: ${formatHours(h.guaranteeHours)} hours a week for one person`}
          />
        </div>
        <p className={styles.muted}>{hoursBackSentence(h)}</p>
      </Section>

      <Section k="destination" r={r}>
        <p>{r.destination.text?.trim() || "Not named yet."}</p>
        {r.destination.roles.length > 0 ? (
          <ul className={styles.plainList}>
            {r.destination.roles.map((role) => (
              <li key={role.role}>
                <span>
                  <strong>{role.role}</strong>
                  {role.wishes.length ? `: ${joinWishes(role.wishes)}` : ""}
                </span>
                <span>{formatHours(role.hours)} hours a week</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section k="next_wins" r={r}>
        {r.nextWins.length === 0 ? (
          <p className={styles.muted}>None yet. A next win is a candidate with low data risk and a build of half a day or less.</p>
        ) : (
          <ol className={styles.plainList}>
            {r.nextWins.map((w) => (
              <li key={w.title}>
                <span>
                  <strong>{w.title}</strong>, helps {w.helps.join(", ") || "the team"}
                </span>
                <span>
                  {formatHours(w.hours)} hours a week, data risk {w.dataRisk ?? "not set"}, build {w.buildEffortHours == null ? "not estimated" : `${formatHours(w.buildEffortHours)} hours`}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section k="guardrails" r={r}>
        <div className={styles.figures}>
          <Figure value={String(r.guardrails.tools.length)} label={r.guardrails.tools.length === 1 ? "Tool in use" : "Tools in use"} />
        </div>
        {r.guardrails.tools.length ? <p className={styles.muted}>{r.guardrails.tools.join(", ")}</p> : null}
        {r.guardrails.dataAtRisk ? (
          <p>
            <strong>Data at risk:</strong> {r.guardrails.dataAtRisk}
          </p>
        ) : null}
        {r.guardrails.rules.length ? (
          <ol className={styles.readoutRules}>
            {r.guardrails.rules.map((rule, i) => (
              <li key={i}>{rule}</li>
            ))}
          </ol>
        ) : null}
      </Section>

      <Section k="roadmap" r={r}>
        {r.roadmap.length === 0 ? (
          <p className={styles.muted}>Not set yet.</p>
        ) : (
          <ol className={styles.plainList}>
            {r.roadmap.map((item, i) => (
              <li key={i}>
                <span>
                  <strong>{item.title}</strong>
                  {item.champion ? `, champion: ${item.champion}` : ""}
                </span>
                <span>{item.target_week ? `Week ${item.target_week}` : "Week not set"}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </>
  );
}
