import type { ReactNode } from "react";
import type { ClientRow, DiagnosticRow, ParticipantRow } from "@/lib/diagnostics/types";
import { draftPledge } from "@/lib/diagnostics/pledge";
import { OWNER_WEEK_QUESTIONS } from "@/lib/diagnostics/readout";
import { INTERVIEWS_SHOWN } from "@/lib/diagnostics/steps";
import { StepCard } from "./StepCard";
import { screenOf } from "@/lib/diagnostics/screens";
import { DxField } from "./DxField";
import { AddPeople } from "./AddPeople";
import { Pledge } from "./Pledge";
import styles from "../diagnostics.module.css";

// 2. KICKOFF. Day one with the owner: the owner's own week (0309), the
// scope, the Capacity Destination, the dates and the guarantee, the
// people in scope, and the pledge the owner sends the team the same day. Each person added here gets an empty survey for
// the assessor to fill in on the next step. While the interviews are
// hidden (steps.ts) the people and the pledge are too. On the guided
// screens (Jason, 2026-10-29): the owner's week, scope and the Capacity
// Destination, then dates and the guarantee. With no screen, all show.
export function KickoffStep({
  diagnostic,
  client,
  participants,
  leadName,
  footer = null,
  screen,
}: {
  diagnostic: DiagnosticRow;
  client: ClientRow;
  participants: ParticipantRow[];
  leadName: string;
  footer?: ReactNode;
  screen?: string;
}) {
  const id = diagnostic.id;
  const show = (k: string) => !screen || screen === k;
  const draft = draftPledge({ ownerName: client.owner_name, leadName, destination: diagnostic.capacity_destination });
  return (
    <StepCard id="step-kickoff" title={screen ? (screenOf("kickoff", screen)?.title ?? "Kickoff") : "Kickoff"} footer={footer}>
      {show("owner") ? (
        <>
          {screen ? null : <h3 className={styles.subhead}>The owner&rsquo;s week</h3>}
          <div className={styles.body}>
            {screen ? null : <p className={styles.status}>Where the owner&rsquo;s own time goes. It shows on the readout under The Capacity Destination.</p>}
            <DxField diagnosticId={id} field="owner_wish_list" label={OWNER_WEEK_QUESTIONS.wishList} value={diagnostic.owner_wish_list} multiline maxLength={2000} />
            <DxField diagnosticId={id} field="owner_away_breaks" label={OWNER_WEEK_QUESTIONS.awayBreaks} value={diagnostic.owner_away_breaks} multiline maxLength={2000} />
            <DxField diagnosticId={id} field="owner_bottlenecks" label={OWNER_WEEK_QUESTIONS.bottlenecks} value={diagnostic.owner_bottlenecks} multiline maxLength={2000} />
          </div>
        </>
      ) : null}
      {screen ? null : <h3 className={styles.subhead}>Dates, guarantee and scope</h3>}
      {show("dates") || show("scope") ? (
        <div className={styles.body}>
          {show("dates") ? (
            <div className={styles.grid2}>
              <DxField diagnosticId={id} field="kickoff_at" label="Kickoff date" type="date" value={diagnostic.kickoff_at} />
              <DxField diagnosticId={id} field="readout_at" label="Readout date" type="date" value={diagnostic.readout_at} />
              <DxField
                diagnosticId={id}
                field="guarantee_hours"
                label="Guarantee, hours a week (default: 3, change if needed)"
                type="number"
                value={diagnostic.guarantee_hours}
                hint="The hours a week the first win promises one person back, measured over its first full week. Set it to what you agreed with the owner."
              />
            </div>
          ) : null}
          {show("scope") ? (
            <>
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
            </>
          ) : null}
        </div>
      ) : null}

      {INTERVIEWS_SHOWN && show("scope") ? (
        <>
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
        </>
      ) : null}
    </StepCard>
  );
}
