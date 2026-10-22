import type { ReactNode } from "react";
import { formatHours, type CandidateGroup, type CapacitySummary, type MapPoint } from "@/lib/diagnostics/hours-back";
import { winPattern } from "@/lib/diagnostics/win-patterns";
import type { DiagnosticRow, ParticipantRow, TaskRow, WinRow } from "@/lib/diagnostics/types";
import { StepCard } from "./StepCard";
import { CapacityMap } from "./CapacityMap";
import { WinButton } from "./WinDrawer";
import { DxField } from "./DxField";
import { shortDate } from "../format";
import styles from "../diagnostics.module.css";

// 5. BUILD. The Capacity Map, the scored candidates, and the first win:
// chosen from the library, built with the person who owns the task,
// put in use, then measured over its first full week. The midpoint
// check with the owner is a dated note here. Every figure is from
// hours-back.ts.

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
  footer,
}: {
  diagnostic: DiagnosticRow;
  participants: ParticipantRow[];
  tasks: TaskRow[];
  firstWin: WinRow | null;
  summary: CapacitySummary;
  groups: CandidateGroup[];
  next: CandidateGroup[];
  points: MapPoint[];
  footer: ReactNode;
}) {
  const names = new Map(participants.map((p) => [p.id, p.name]));
  const winTask = firstWin ? tasks.find((t) => t.id === firstWin.task_id) : undefined;
  const pattern = firstWin ? winPattern(firstWin.pattern) : undefined;

  return (
    <>
      <StepCard id="step-build" title="Capacity Map" meta={`${summary.tasks} tasks, ${summary.candidates} candidates`}>
        {points.length === 0 ? (
          <p className={styles.empty}>The map fills in as surveys are entered.</p>
        ) : (
          <div className={styles.body}>
            <div className={styles.figures}>
              <Figure value={formatHours(summary.totalHours)} label="Hours a week on these tasks" />
              <Figure value={formatHours(summary.candidateHours)} label="Hours on candidates" />
              <Figure value={formatHours(summary.checkedHours)} label="Hours volume-checked" />
            </div>
            <CapacityMap points={points} />
          </div>
        )}
      </StepCard>

      <StepCard id="dx-candidates" title="Candidates" meta={`${groups.length}`}>
        {groups.length === 0 ? (
          <p className={styles.empty}>No task is both draining and routine yet. A task can be made a candidate on the Survey step.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Task</th>
                  <th className={styles.num}>People</th>
                  <th className={styles.num}>Hours a week</th>
                  <th className={styles.num}>Checked</th>
                  <th className={styles.num}>Score</th>
                  <th>Data risk</th>
                  <th className={styles.num}>Build hours</th>
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
                    <td className={styles.num}>{Math.round(g.score)}</td>
                    <td>{g.dataRisk ? RISK[g.dataRisk] : "Not set"}</td>
                    <td className={styles.num}>{g.buildEffortHours == null ? "Not set" : formatHours(g.buildEffortHours)}</td>
                    <td>{g.quickWin ? <span className={styles.chip}>Quick win</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {next.length > 0 ? (
          <>
            <h3 className={styles.subhead}>Top next wins</h3>
            <ul className={styles.plainList}>
              {next.map((g) => (
                <li key={g.key}>
                  <span>{g.title}</span>
                  <span className={styles.muted}>
                    {formatHours(g.hours)} hours a week, {g.people} {g.people === 1 ? "person" : "people"}
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
                ({pattern?.title ?? firstWin.pattern}), for {winTask ? `${winTask.title}, ${names.get(winTask.participant_id) ?? ""}` : "a task no longer listed"}
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

      <StepCard id="dx-midpoint" title="Midpoint check" footer={footer}>
        <div className={styles.body}>
          <div className={styles.grid2}>
            <DxField diagnosticId={diagnostic.id} field="midpoint_at" label="Date" type="date" value={diagnostic.midpoint_at} />
            <DxField diagnosticId={diagnostic.id} field="readout_at" label="Readout date" type="date" value={diagnostic.readout_at} />
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
    </>
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
