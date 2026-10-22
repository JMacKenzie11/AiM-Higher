import type { ReactNode } from "react";
import type { ClientRow, DiagnosticRow, ParticipantRow } from "@/lib/diagnostics/types";
import { draftPledge } from "@/lib/diagnostics/pledge";
import { StepCard } from "./StepCard";
import { DxField } from "./DxField";
import { AddPeople } from "./AddPeople";
import { Pledge } from "./Pledge";
import styles from "../diagnostics.module.css";

// 2. KICKOFF. Day one with the owner: the scope, the Capacity
// Destination, the people in scope, and the pledge the owner sends the
// team the same day. Each person added here gets an empty survey for
// the assessor to fill in on the next step.
export function KickoffStep({
  diagnostic,
  client,
  participants,
  leadName,
  footer,
}: {
  diagnostic: DiagnosticRow;
  client: ClientRow;
  participants: ParticipantRow[];
  leadName: string;
  footer: ReactNode;
}) {
  const id = diagnostic.id;
  const draft = draftPledge({ ownerName: client.owner_name, leadName, destination: diagnostic.capacity_destination });
  return (
    <StepCard id="step-kickoff" title="Kickoff" footer={footer}>
      <div className={styles.body}>
        <div className={styles.grid2}>
          <DxField diagnosticId={id} field="kickoff_at" label="Kickoff date" type="date" value={diagnostic.kickoff_at} />
          <DxField diagnosticId={id} field="readout_at" label="Readout date" type="date" value={diagnostic.readout_at} />
          <DxField
            diagnosticId={id}
            field="guarantee_hours"
            label="Guarantee, hours a week"
            type="number"
            value={diagnostic.guarantee_hours}
            hint="Hours the first win gives one person back, measured."
          />
        </div>
        <DxField
          diagnosticId={id}
          field="scope"
          label="Scope"
          value={diagnostic.scope}
          multiline
          placeholder="The one or two roles or departments in scope"
          maxLength={2000}
        />
        <DxField
          diagnosticId={id}
          field="capacity_destination"
          label="Capacity Destination"
          value={diagnostic.capacity_destination}
          multiline
          placeholder="The one priority the owner would point freed hours at"
          maxLength={2000}
        />
      </div>

      <h3 className={styles.subhead}>
        People in scope <span className={styles.subheadMeta}>{participants.length}</span>
      </h3>
      {participants.length > 0 ? (
        <ul className={styles.plainList}>
          {participants.map((p) => (
            <li key={p.id}>
              <span>
                {p.name}
                {p.role_title ? <span className={styles.muted}>, {p.role_title}</span> : null}
              </span>
              <span className={styles.muted}>{p.survey_entered_at ? "Survey entered" : "Survey not entered yet"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.body}>
        <AddPeople diagnosticId={id} />
      </div>

      <h3 className={styles.subhead}>The pledge</h3>
      <div className={styles.body}>
        <Pledge diagnosticId={id} saved={diagnostic.pledge_text} draft={draft} sentAt={diagnostic.pledge_sent_at} />
      </div>
    </StepCard>
  );
}
