import type { ReactNode } from "react";
import type { DiagnosticRow, SystemLinkRow, SystemRow, TaskRow } from "@/lib/diagnostics/types";
import { INTERVIEWS_SHOWN } from "@/lib/diagnostics/steps";
import { StepCard } from "./StepCard";
import { DxCheck, DxField } from "./DxField";
import { SystemsWalkthrough } from "./SystemsWalkthrough";
import { WalkthroughTasks } from "./WalkthroughTasks";
import { DxMulti, KnowledgeBaseField } from "./DxChoices";
import { ScoreCards } from "./ScoreCards";
import { screenOf } from "@/lib/diagnostics/screens";
import { INTAKE_CHANNELS } from "@/lib/diagnostics/types";
import styles from "../diagnostics.module.css";

// 1. PRE-FLIGHT. The five working days before kickoff: the tools the
// group lives in, one IT contact, and three ticks. Next waits for
// "access secured": no access by kickoff means the kickoff moves, not
// the build. Under them, the systems walkthrough (phase 4). While the
// people interviews are hidden (steps.ts), the work done in the systems
// is entered here too, with the one company-level AI question.
//
// On the guided screens (Jason, 2026-10-29) each part is a screen of
// its own: tool access and contact, systems, how information moves (and
// where requests come in), tasks, scoring them, and AI tools (and what
// is written down). With no screen, every part shows, as before.
export function PreflightStep({
  diagnostic,
  systems,
  links,
  tasks,
  footer = null,
  screen,
}: {
  diagnostic: DiagnosticRow;
  systems: SystemRow[];
  links: SystemLinkRow[];
  tasks: TaskRow[];
  footer?: ReactNode;
  screen?: string;
}) {
  const id = diagnostic.id;
  const show = (k: string) => !screen || screen === k;
  return (
    <StepCard id="step-preflight" title={screen ? (screenOf("preflight", screen)?.title ?? "Pre-flight") : "Pre-flight"} footer={footer}>
      <div className={styles.body}>
        {show("access") ? (
          <>
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
              {INTERVIEWS_SHOWN ? <DxCheck diagnosticId={id} field="conversations_booked" label="Conversations booked" checked={diagnostic.conversations_booked} /> : null}
            </div>
          </>
        ) : null}
        {!screen ? <SystemsWalkthrough diagnosticId={id} systems={systems} links={links} /> : null}
        {screen === "systems" ? <SystemsWalkthrough diagnosticId={id} systems={systems} links={links} part="systems" /> : null}
        {screen === "links" ? <SystemsWalkthrough diagnosticId={id} systems={systems} links={links} part="links" /> : null}
        {/* Where requests come in (0309). */}
        {show("links") ? (
          <div>
            <DxMulti
              diagnosticId={id}
              field="intake_channels"
              label="Where do requests come in: email, Slack or Teams, phone, CRM, web forms?"
              options={INTAKE_CHANNELS}
              value={diagnostic.intake_channels ?? []}
            />
            <DxField diagnosticId={id} field="intake_other" label="Anywhere else" value={diagnostic.intake_other} maxLength={500} placeholder="Walk-ins, text messages" />
          </div>
        ) : null}
        {INTERVIEWS_SHOWN ? null : (
          <>
            {!screen ? <WalkthroughTasks diagnosticId={id} tasks={tasks} systems={systems} links={links} /> : null}
            {screen === "tasks" ? <WalkthroughTasks diagnosticId={id} tasks={tasks} systems={systems} links={links} scoring={false} /> : null}
            {screen === "score" ? <ScoreCards diagnosticId={id} tasks={tasks} systems={systems} links={links} /> : null}
            {show("ai") ? (
              <>
                <DxField
                  diagnosticId={id}
                  field="ai_tools"
                  label="AI tools the team uses for work"
                  value={diagnostic.ai_tools}
                  multiline
                  placeholder="ChatGPT, Copilot in Outlook, the quoting tool's assistant"
                  hint="One per line or comma. The readout lists them by name."
                  maxLength={2000}
                />
                {/* What is written down (0309). */}
                <KnowledgeBaseField diagnosticId={id} value={diagnostic.knowledge_base} />
              </>
            ) : null}
          </>
        )}
      </div>
    </StepCard>
  );
}
