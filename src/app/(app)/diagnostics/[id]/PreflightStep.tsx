import type { ReactNode } from "react";
import type { DiagnosticRow, SystemLinkRow, SystemRow } from "@/lib/diagnostics/types";
import { StepCard } from "./StepCard";
import { DxCheck, DxField } from "./DxField";
import { SystemsWalkthrough } from "./SystemsWalkthrough";
import styles from "../diagnostics.module.css";

// 1. PRE-FLIGHT. The five working days before kickoff: the tools the
// group lives in, one IT contact, and three ticks. Next waits for
// "access secured": no access by kickoff means the kickoff moves, not
// the build. Under them, the systems walkthrough (phase 4).
export function PreflightStep({
  diagnostic,
  systems,
  links,
  footer,
}: {
  diagnostic: DiagnosticRow;
  systems: SystemRow[];
  links: SystemLinkRow[];
  footer: ReactNode;
}) {
  const id = diagnostic.id;
  return (
    <StepCard id="step-preflight" title="Pre-flight" footer={footer}>
      <div className={styles.body}>
        <DxField
          diagnosticId={id}
          field="tools_in_use"
          label="Tools the group uses"
          value={diagnostic.tools_in_use}
          multiline
          placeholder="Email platform, spreadsheets, ERP, quoting system"
          maxLength={4000}
        />
        <DxField diagnosticId={id} field="it_contact" label="IT or admin contact" value={diagnostic.it_contact} placeholder="Name and email" maxLength={500} />
        <div className={styles.checks}>
          <DxCheck diagnosticId={id} field="access_secured" label="Access secured for the tools the first win will touch" checked={diagnostic.access_secured} />
          <DxCheck diagnosticId={id} field="brief_sent" label="One-page brief sent to the owner" checked={diagnostic.brief_sent} />
          <DxCheck diagnosticId={id} field="conversations_booked" label="Conversations booked" checked={diagnostic.conversations_booked} />
        </div>
        <SystemsWalkthrough diagnosticId={id} systems={systems} links={links} />
      </div>
    </StepCard>
  );
}
