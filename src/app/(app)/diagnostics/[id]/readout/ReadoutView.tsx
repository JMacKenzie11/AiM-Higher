import type { ReactNode } from "react";
import { PrivacyNote } from "@/components/ui/PrivacyNote";
import { formatHours } from "@/lib/diagnostics/hours-back";
import { buildText, hoursBackSentence, joinWishes, ownerWeekLines, percent, PRIVACY_LINE, readoutSections, sectionTitle, showsPrivacyLine, type ReadoutData } from "@/lib/diagnostics/readout";
import type { ReadoutSection } from "@/lib/diagnostics/types";
import { CapacityMap } from "../CapacityMap";
import { SystemsMap } from "../SystemsMap";
import { shortDate } from "../../format";
import styles from "../../diagnostics.module.css";

// The readout as the owner reads it, in the order the readout runs. One
// shape for the draft and the published copy; the PDF draws the same
// sections from the same data (lib/diagnostics/pdf/ReadoutPdf.tsx).

// A section the readout does not run (readoutSections) draws nothing.
function Section({ k, r, children }: { k: ReadoutSection; r: ReadoutData; children: ReactNode }) {
  if (!readoutSections(r).includes(k)) return null;
  return (
    <section className={styles.card} aria-labelledby={`readout-${k}`}>
      <div className={styles.cardHeader}>
        <h2 id={`readout-${k}`} className={styles.cardTitle}>
          {sectionTitle(k, r)}
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
      {showsPrivacyLine(r) ? <PrivacyNote>{PRIVACY_LINE}</PrivacyNote> : null}

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
        {r.ownerWeek ? (
          <>
            <h3 className={styles.subhead}>The owner&rsquo;s week</h3>
            <ul className={styles.plainList}>
              {ownerWeekLines(r.ownerWeek).map(([q, a]) => (
                <li key={q} className={styles.qa}>
                  <span className={styles.muted}>{q}</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </>
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
                  {formatHours(w.hours)} hours a week, data risk {w.dataRisk ?? "not set"}, build {buildText(w)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {r.agentTeam?.length ? (
        <Section k="agent_team" r={r}>
          {r.agentTeam.map((a, i) => (
            <div key={i} className={styles.agentCard}>
              <strong>{a.name}</strong>
              {a.role ? <span>{a.role}</span> : null}
              {a.routine ? <span className={styles.muted}>Routine: {a.routine}</span> : null}
              {a.connectors ? <span className={styles.muted}>Connects to: {a.connectors}</span> : null}
              {a.limits ? <span className={styles.muted}>Limits: {a.limits}</span> : null}
            </div>
          ))}
        </Section>
      ) : null}

      {r.systems ? (
        <Section k="guardrails" r={r}>
          <SystemsAndAi r={r} />
        </Section>
      ) : (
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
        <VoiceAndLimits r={r} />
        {r.guardrails.rules.length ? (
          <ol className={styles.readoutRules}>
            {r.guardrails.rules.map((rule, i) => (
              <li key={i}>{rule}</li>
            ))}
          </ol>
        ) : null}
      </Section>
      )}

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

// How the business sounds and what an agent never does alone (0309).
function VoiceAndLimits({ r }: { r: ReadoutData }) {
  return (
    <>
      {r.guardrails.voice ? (
        <p>
          <strong>How the business sounds:</strong> {r.guardrails.voice}
        </p>
      ) : null}
      {r.guardrails.neverAlone ? <p>{r.guardrails.neverAlone}.</p> : null}
    </>
  );
}

// The Systems and AI Snapshot (phase 4): the systems map, the top three
// connections carried by hand, AI use as counts and tool names, and the
// guardrails.
function SystemsAndAi({ r }: { r: ReadoutData }) {
  const sys = r.systems!;
  return (
    <>
      {sys.map.systems.length ? <SystemsMap systems={sys.map.systems} connections={sys.map.connections} /> : null}
      {sys.handCarried.length ? (
        <ol className={styles.plainList}>
          {sys.handCarried.map((c, i) => (
            <li key={i}>
              <span>
                <strong>
                  {c.from} to {c.to}
                </strong>
                , {c.whatMoves.join(", ")}
              </span>
              <span>{formatHours(c.hours)} hours a week by hand</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.muted}>No information is carried between systems by hand.</p>
      )}
      {sys.ai.answered ? (
        <>
          <div className={styles.figures}>
            <Figure value={`${sys.ai.usingAny} of ${sys.ai.answered}`} label="Use an AI tool for work" />
            <Figure value={String(sys.ai.usingPersonal)} label="Use a tool they found themselves" />
          </div>
          {sys.ai.tools.length ? <p className={styles.muted}>{sys.ai.tools.map((t) => `${t.tool} (${t.users})`).join(", ")}</p> : null}
        </>
      ) : null}
      {sys.aiTools?.length ? (
        <p>
          <strong>AI tools the team uses:</strong> {sys.aiTools.join(", ")}
        </p>
      ) : null}
      {r.guardrails.dataAtRisk ? (
        <p>
          <strong>Data at risk:</strong> {r.guardrails.dataAtRisk}
        </p>
      ) : null}
      <VoiceAndLimits r={r} />
      {r.guardrails.rules.length ? (
        <ol className={styles.readoutRules}>
          {r.guardrails.rules.map((rule, i) => (
            <li key={i}>{rule}</li>
          ))}
        </ol>
      ) : null}
    </>
  );
}
