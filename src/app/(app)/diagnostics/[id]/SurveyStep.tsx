import type { ReactNode } from "react";
import type { AnswerRow, ParticipantRow, TaskRow } from "@/lib/diagnostics/types";
import { StepCard } from "./StepCard";
import { SurveyButton } from "./SurveyDrawer";
import { TaskGrid } from "./TaskGrid";
import styles from "../diagnostics.module.css";

// 3. SURVEY. One survey per person, filled in by the assessor (Jason,
// 2026-10-22: no public page, no participant sign-in): who they are,
// up to ten tasks with hours, energy and judgment, and three open
// answers. Then every task from every person in one grid, where the
// volume check goes in against the biggest tasks and the same work
// rolls up under one title.
export function SurveyStep({
  diagnosticId,
  participants,
  tasks,
  answers,
  footer,
}: {
  diagnosticId: string;
  participants: ParticipantRow[];
  tasks: TaskRow[];
  answers: AnswerRow[];
  footer: ReactNode;
}) {
  const entered = participants.filter((p) => p.survey_entered_at).length;
  const firstOpen = participants.find((p) => !p.survey_entered_at) ?? participants[0];
  return (
    <>
      <StepCard
        id="step-survey"
        title="Surveys"
        meta={`${entered} of ${participants.length} entered`}
        action={
          firstOpen ? <SurveyButton label="Enter a survey" startWith={firstOpen.id} participants={participants} tasks={tasks} answers={answers} /> : null
        }
      >
        {participants.length === 0 ? (
          <p className={styles.empty}>Add the people in scope on the Kickoff step first.</p>
        ) : (
          <ul className={styles.plainList}>
            {participants.map((p) => {
              const n = tasks.filter((t) => t.participant_id === p.id).length;
              return (
                <li key={p.id}>
                  <span>
                    {p.name}
                    {p.role_title ? <span className={styles.muted}>, {p.role_title}</span> : null}
                  </span>
                  <span className={styles.muted}>{p.survey_entered_at ? `${n} task${n === 1 ? "" : "s"}` : "Not entered yet"}</span>
                  <SurveyButton
                    label={p.survey_entered_at ? "Edit survey" : "Enter survey"}
                    startWith={p.id}
                    participants={participants}
                    tasks={tasks}
                    answers={answers}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </StepCard>
      <TaskGrid diagnosticId={diagnosticId} participants={participants} tasks={tasks} footer={footer} />
    </>
  );
}
