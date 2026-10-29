import Link from "next/link";
import type { ReactNode } from "react";
import { formatHours, SCORE_WEIGHTS, type CandidateGroup, type CapacitySummary, type MapPoint } from "@/lib/diagnostics/hours-back";
import { winPattern } from "@/lib/diagnostics/win-patterns";
import { BUILD_EFFORTS, NEVER_ALONE, labelOf, taskWho, type AgentCard, type DiagnosticRow, type ParticipantRow, type TaskRow, type WinRow } from "@/lib/diagnostics/types";
import { limitsText } from "@/lib/diagnostics/agents";
import { AgentTeam } from "./AgentTeam";
import { DxMulti } from "./DxChoices";
import { StepCard } from "./StepCard";
import { CapacityMap } from "./CapacityMap";
import { SystemsMap } from "./SystemsMap";
import type { SystemsSnapshot } from "@/lib/diagnostics/systems-snapshot";
import { WinButton } from "./WinDrawer";
import { INTERVIEWS_SHOWN } from "@/lib/diagnostics/steps";
import { splitList } from "@/lib/diagnostics/readout";
import { DxField } from "./DxField";
import { shortDate } from "../format";
import styles from "../diagnostics.module.css";

// 5. BUILD. The Capacity Map, the scored candidates, and the first win:
// chosen from the library, built with the person who owns the task,
// put in use, then measured over its first full week. The midpoint
// check with the owner is a dated note here. Every figure is from
// hours-back.ts, and the systems figures from systems-snapshot.ts
// (phase 4): the systems map beside the Capacity Map, and the systems
// and AI card for the assessor. While the people interviews are hidden
// (steps.ts) nobody rates a task, so there is no Capacity Map: the
// systems map is the picture.
//
// 0309: candidates rank by score (SCORE_WEIGHTS: hours up, data risk
// and build effort down), with the breakdown shown; Top next wins are
// the low-risk, half-a-day builds among them; the recommended agent
// team; the voice and limits in the guardrails; and the readout date is
// set on Kickoff alone.

const RISK: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

export function BuildStep({
  diagnostic,
  participants,
  tasks,
  firstWin,
  summary,
  groups,
  next,
  points,
  snapshot,
  agentTeam,
  footer = null,
  screen,
}: {
  diagnostic: DiagnosticRow;
  participants: ParticipantRow[];
  tasks: TaskRow[];
  firstWin: WinRow | null;
  summary: CapacitySummary;
  groups: CandidateGroup[];
  next: CandidateGroup[];
  points: MapPoint[];
  snapshot: SystemsSnapshot;
  agentTeam: { saved: AgentCard[] | null; suggested: AgentCard[] };
  footer?: ReactNode;
  // A guided screen (Jason, 2026-10-29): candidates (with the map, the
  // first win and the systems), agents, guardrails or midpoint. With
  // none, every card shows.
  screen?: string;
}) {
  const show = (k: string) => !screen || screen === k;
  const names = new Map(participants.map((p) => [p.id, p.name]));
  const winTask = firstWin ? tasks.find((t) => t.id === firstWin.task_id) : undefined;
  const pattern = firstWin ? winPattern(firstWin.pattern) : undefined;
  const who = INTERVIEWS_SHOWN ? { one: "person", many: "people", head: "People" } : { one: "role", many: "roles", head: "Roles" };
  const aiTools = splitList(diagnostic.ai_tools);

  return (
    <>
      {show("candidates") ? (
      <>
      <StepCard id="step-build" title={INTERVIEWS_SHOWN ? "Capacity Map" : "Systems map"} meta={`${summary.tasks} ${summary.tasks === 1 ? "task" : "tasks"}, ${summary.candidates} ${summary.candidates === 1 ? "candidate" : "candidates"}`}>
        <div className={styles.body}>
          {summary.tasks ? (
            <div className={styles.figures}>
              <Figure value={formatHours(summary.totalHours)} label="Hours a week on these tasks" />
              <Figure value={formatHours(summary.candidateHours)} label="Hours on candidates" />
              <Figure value={formatHours(summary.checkedHours)} label="Hours volume-checked" />
            </div>
          ) : null}
          {INTERVIEWS_SHOWN ? (
            <div className={styles.systemsMaps}>
              {points.length === 0 ? <p className={styles.empty}>The map fills in as surveys are entered.</p> : <CapacityMap points={points} />}
              {snapshot.systems.length ? (
                <SystemsMap systems={snapshot.systems} connections={snapshot.connections} />
              ) : (
                <p className={styles.empty}>The systems map fills in as systems are added on Pre-flight.</p>
              )}
            </div>
          ) : snapshot.systems.length ? (
            <SystemsMap systems={snapshot.systems} connections={snapshot.connections} />
          ) : (
            <p className={styles.empty}>The systems map fills in as systems are added on Pre-flight.</p>
          )}
        </div>
      </StepCard>

      <StepCard id="dx-candidates" title="Candidates" meta={`${groups.length}`}>
        {groups.length === 0 ? (
          <p className={styles.empty}>
            {INTERVIEWS_SHOWN
              ? "No task is both draining and routine yet. A task can be made a candidate on the Survey step."
              : "No candidates yet. Every task entered on Pre-flight is one, unless you leave it out there."}
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Task</th>
                  <th className={styles.num}>{who.head}</th>
                  <th className={styles.num}>Hours a week</th>
                  <th className={styles.num}>Checked</th>
                  <th>Data risk</th>
                  <th>Build effort</th>
                  <th className={styles.num}>Score</th>
                  <th>How it adds up</th>
                  <th>
                    <span className={styles.srOnly}>Quick win</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.key}>
                    <td>{g.title}</td>
                    <td className={styles.num}>{g.people}</td>
                    <td className={styles.num}>{formatHours(g.hours)}</td>
                    <td className={styles.num}>{formatHours(g.checkedHours)}</td>
                    <td>{g.dataRisk ? RISK[g.dataRisk] : "Not set"}</td>
                    <td>{labelOf(BUILD_EFFORTS, g.buildEffort)}</td>
                    <td className={styles.num}>{Math.round(g.score)}</td>
                    <td className={styles.muted}>
                      {Math.round(g.breakdown.hours)} for hours, {signed(g.breakdown.dataRisk)} for risk, {signed(g.breakdown.buildEffort)} for build
                    </td>
                    <td>{g.quickWin ? <span className={styles.chip}>Quick win</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={`${styles.status} ${styles.cardLead}`}>
          Score: {SCORE_WEIGHTS.perHour} for each hour a week, less {-SCORE_WEIGHTS.dataRisk.medium} for medium data risk or {-SCORE_WEIGHTS.dataRisk.high} for high, less {-SCORE_WEIGHTS.buildEffort.one_two_days} for a 1 to 2 day build or {-SCORE_WEIGHTS.buildEffort.more} for a longer one. Not scored yet counts as less {-SCORE_WEIGHTS.dataRisk.unset} and {-SCORE_WEIGHTS.buildEffort.unset}.
        </p>
        <h3 className={styles.subhead}>Top 3 next wins</h3>
        {next.length === 0 ? (
          <p className={styles.empty}>None yet. A next win is a candidate with low data risk and a build of half a day or less, other than the first win.</p>
        ) : null}
        {next.length > 0 ? (
          <>
            <ul className={styles.plainList}>
              {next.map((g) => (
                <li key={g.key}>
                  <span>{g.title}</span>
                  <span className={styles.muted}>
                    {formatHours(g.hours)} hours a week, {g.people} {g.people === 1 ? who.one : who.many}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </StepCard>

      <StepCard
        id="dx-first-win"
        title="First win"
        action={
          tasks.length > 0 ? (
            <WinButton diagnosticId={diagnostic.id} win={firstWin} tasks={tasks} participants={participants} label={firstWin ? "Edit first win" : "Choose first win"} />
          ) : null
        }
      >
        {!firstWin ? (
          <p className={styles.empty}>Choose the first win from the library once the candidates are scored.</p>
        ) : (
          <div className={styles.body}>
            <p>
              <strong>{firstWin.title}</strong>
              <span className={styles.muted}>
                {" "}
                ({pattern?.title ?? firstWin.pattern}), for {winTask ? `${winTask.title}, ${taskWho(winTask, names)}` : "a task no longer listed"}
              </span>
            </p>
            <p className={styles.muted}>
              Built {shortDate(firstWin.built_at)}. In use from {shortDate(firstWin.in_use_from)}.
              {firstWin.measured_week_ending ? ` Measured the week ending ${shortDate(firstWin.measured_week_ending)}.` : " Not measured yet."}
            </p>
            <div className={styles.figures}>
              <Figure value={formatHours(summary.measured)} label="Measured hours back a week" />
              <Figure value={summary.recoveryRate == null ? "Not yet" : `${Math.round(summary.recoveryRate * 100)}%`} label="Recovery rate" />
              <Figure value={formatHours(summary.projected)} label="Projected hours back a week, across the other candidates" />
              <Figure
                value={summary.guaranteeMet == null ? "Not yet" : summary.guaranteeMet ? "Met" : "Not met"}
                label={`Guarantee: ${formatHours(Number(diagnostic.guarantee_hours))} hours for one person`}
              />
            </div>
            <p className={styles.muted}>Measured and projected are kept apart. The projection uses the rate the first win achieved.</p>
          </div>
        )}
      </StepCard>

      <StepCard id="dx-systems" title="Systems and AI" meta={snapshot.handCarried.length ? `${formatHours(snapshot.handCarriedHours)} hours a week carried by hand` : undefined}>
        <div className={styles.body}>
          <div>
            <h3 className={styles.subhead}>Carried by hand</h3>
            {snapshot.handCarried.length === 0 ? (
              <p className={styles.empty}>No information typed in again or exported and imported yet.</p>
            ) : (
              <ol className={styles.plainList}>
                {snapshot.handCarried.map((c) => (
                  <li key={`${c.fromId}>${c.toId}`}>
                    <span>
                      {c.from} to {c.to}
                      <span className={styles.muted}>, {c.whatMoves.join(", ")}</span>
                    </span>
                    <span className={styles.muted}>
                      {formatHours(c.hoursCarried)} hours a week, {c.tasks === 1 ? "1 task" : `${c.tasks} tasks`}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {snapshot.unlinked.length ? (
            <div>
              <h3 className={styles.subhead}>Copying with no link yet</h3>
              <p className={styles.muted}>These tasks copy between systems the walkthrough did not link. Add the link on Pre-flight so their hours count.</p>
              <ul className={styles.plainList}>
                {snapshot.unlinked.map((u) => (
                  <li key={`${u.fromId}>${u.toId}`}>
                    <span>
                      {u.from} to {u.to}
                    </span>
                    <span className={styles.muted}>
                      {formatHours(u.hours)} hours a week, {u.tasks === 1 ? "1 task" : `${u.tasks} tasks`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <h3 className={styles.subhead}>AI use</h3>
            {!INTERVIEWS_SHOWN ? (
              aiTools.length ? (
                <p>{aiTools.join(", ")}</p>
              ) : (
                <p className={styles.empty}>Add the AI tools the team uses on Pre-flight.</p>
              )
            ) : snapshot.ai.answered === 0 ? (
              <p className={styles.empty}>Nobody has answered the AI questions yet.</p>
            ) : (
              <>
                <p>
                  {snapshot.ai.usingAny} of {snapshot.ai.answered} use an AI tool for work; {snapshot.ai.usingPersonal} use one they found themselves.
                  {snapshot.ai.tools.length ? ` ${snapshot.ai.tools.map((t) => `${t.tool} (${t.users})`).join(", ")}.` : ""}
                </p>
                {snapshot.usesAsWritten.length ? (
                  <>
                    <p className={styles.muted}>What they use it for, as written. For you only; the readout shows counts and tool names.</p>
                    <ul>
                      {snapshot.usesAsWritten.map((u, i) => (
                        <li key={i}>{u}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      </StepCard>

      </>
      ) : null}

      {show("agents") ? (
      <StepCard id="dx-agent-team" title="Recommended agent team" meta={`${(agentTeam.saved?.length ? agentTeam.saved : agentTeam.suggested).length}`}>
        <AgentTeam
          diagnosticId={diagnostic.id}
          saved={agentTeam.saved}
          suggested={agentTeam.suggested}
          defaultLimits={limitsText(diagnostic.never_alone ?? [], diagnostic.never_alone_other)}
        />
      </StepCard>
      ) : null}

      {show("guardrails") ? (
      <StepCard id="dx-guardrails" title="Guardrails snapshot">
        <div className={styles.body}>
          <p className={styles.muted}>
            The tools in use come from pre-flight. Add how the business sounds, what an agent must never do alone, the kinds of data the builds would touch and three rules to put in place now.
          </p>
          <DxField
            diagnosticId={diagnostic.id}
            field="brand_voice"
            label="How the business sounds when it writes to customers"
            value={diagnostic.brand_voice}
            multiline
            placeholder="Friendly and direct. First names. Short emails, no jargon."
            maxLength={2000}
          />
          <DxMulti diagnosticId={diagnostic.id} field="never_alone" label="An agent never does these alone" options={NEVER_ALONE} value={diagnostic.never_alone ?? []} />
          <DxField diagnosticId={diagnostic.id} field="never_alone_other" label="Anything else it never does alone" value={diagnostic.never_alone_other} maxLength={500} />
          <DxField
            diagnosticId={diagnostic.id}
            field="data_at_risk"
            label="Data at risk"
            value={diagnostic.data_at_risk}
            multiline
            placeholder="Customer contact details in the inbox, pricing in the quote sheet"
            maxLength={2000}
          />
          <DxField
            diagnosticId={diagnostic.id}
            field="guardrail_rules"
            label="Three rules, one per line"
            value={diagnostic.guardrail_rules}
            multiline
            placeholder={"A person reads every draft before it goes to a customer"}
            maxLength={2000}
          />
        </div>
      </StepCard>

      ) : null}

      {show("midpoint") ? (
      <StepCard id="dx-midpoint" title="Midpoint check" footer={footer}>
        <div className={styles.body}>
          <div className={styles.grid2}>
            <DxField diagnosticId={diagnostic.id} field="midpoint_at" label="Date" type="date" value={diagnostic.midpoint_at} />
            <div>
              <span className={styles.status}>Readout date</span>
              <p>
                {diagnostic.readout_at ? shortDate(diagnostic.readout_at) : "Not set"}{" "}
                <Link href={`/diagnostics/${diagnostic.id}?step=kickoff`} className={styles.link}>
                  Edit on Kickoff
                </Link>
              </p>
            </div>
          </div>
          <DxField
            diagnosticId={diagnostic.id}
            field="midpoint_note"
            label="Note"
            value={diagnostic.midpoint_note}
            multiline
            placeholder="The early measured number shared, the readout date and attendees confirmed"
            maxLength={4000}
          />
        </div>
      </StepCard>
      ) : null}
    </>
  );
}

// A weight with its sign: "0", "-20".
const signed = (n: number) => (n > 0 ? `+${Math.round(n)}` : String(Math.round(n)));

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.figure}>
      <span className={styles.figureValue}>{value}</span>
      <span className={styles.figureLabel}>{label}</span>
    </div>
  );
}
