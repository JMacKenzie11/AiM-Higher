import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireDiagnostics } from "@/lib/diagnostics/access";
import { getDiagnostic, readoutToday } from "@/lib/diagnostics/service";
import { DIAGNOSTIC_STEPS, isStep, stepAfter, stepBefore, stepForStatus, type DiagnosticStep } from "@/lib/diagnostics/steps";
import { statusLabel, toTask, toWin } from "@/lib/diagnostics/types";
import { candidateGroups, capacityMap, summarize, topNextWins } from "@/lib/diagnostics/hours-back";
import { snapshotOf } from "@/lib/diagnostics/systems-snapshot";
import { assembleReadout } from "@/lib/diagnostics/readout";
import { suggestAgentTeam } from "@/lib/diagnostics/agents";
import { STEP_STATE_LABEL, stepStates } from "@/lib/diagnostics/progress";
import { PageShell } from "@/components/ui/PageShell";
import { ArchiveButton } from "../ActionButtons";
import { StepFooter } from "./StepFooter";
import { PreflightStep } from "./PreflightStep";
import { KickoffStep } from "./KickoffStep";
import { SurveyStep } from "./SurveyStep";
import { ConversationsStep } from "./ConversationsStep";
import { BuildStep } from "./BuildStep";
import { ReadoutStep } from "./ReadoutStep";
import styles from "../diagnostics.module.css";

export const metadata = { title: "Capacity Diagnostic" };

// THE ENGAGEMENT PAGE. One Capacity Diagnostic, walked as steps in the
// weekly meeting's shape: one card per step, Back and Next at its foot,
// the step and nothing else in the URL. Every write goes through the
// caller's own client (lib/diagnostics/actions.ts), and every figure
// comes from lib/diagnostics/hours-back.ts.

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DiagnosticPage({ params, searchParams }: PageProps) {
  const session = await requireDiagnostics();
  const { id } = await params;
  const sp = await searchParams;
  const bundle = await getDiagnostic(id);
  if (!bundle) notFound();
  const { diagnostic, client } = bundle;

  const raw = Array.isArray(sp.step) ? sp.step[0] : sp.step;
  const step: DiagnosticStep = isStep(raw) ? raw : stepForStatus(diagnostic.status);
  const index = DIAGNOSTIC_STEPS.findIndex((s) => s.key === step);
  const reached = DIAGNOSTIC_STEPS.findIndex((s) => s.key === stepForStatus(diagnostic.status));
  const prev = stepBefore(step);
  const next = stepAfter(step);

  const footer = (
    <StepFooter
      diagnosticId={id}
      prev={prev ? { key: prev, label: DIAGNOSTIC_STEPS.find((s) => s.key === prev)!.label } : null}
      next={next ? { key: next, label: DIAGNOSTIC_STEPS.find((s) => s.key === next)!.label } : null}
      blocked={step === "preflight" && !diagnostic.access_secured ? "Tick access secured to move on." : null}
    />
  );

  const tasks = bundle.tasks.map(toTask);
  const states = stepStates(bundle);
  const win = toWin(bundle.firstWin);

  let content: ReactNode = null;
  if (step === "preflight") content = <PreflightStep diagnostic={diagnostic} systems={bundle.systems} links={bundle.links} tasks={bundle.tasks} footer={footer} />;
  if (step === "kickoff") {
    content = (
      <KickoffStep
        diagnostic={diagnostic}
        client={client}
        participants={bundle.participants}
        leadName={session.profile.full_name ?? "the person running this diagnostic"}
        footer={footer}
      />
    );
  }
  if (step === "survey") {
    content = <SurveyStep diagnosticId={id} participants={bundle.participants} tasks={bundle.tasks} answers={bundle.answers} systems={bundle.systems} aiUse={bundle.aiUse} footer={footer} />;
  }
  if (step === "conversations") {
    content = <ConversationsStep diagnosticId={id} participants={bundle.participants} notes={bundle.notes} quotes={bundle.quotes} footer={footer} />;
  }
  if (step === "build") {
    content = (
      <BuildStep
        diagnostic={diagnostic}
        participants={bundle.participants}
        tasks={bundle.tasks}
        firstWin={bundle.firstWin}
        summary={summarize(tasks, win, Number(diagnostic.guarantee_hours))}
        groups={candidateGroups(tasks)}
        next={topNextWins(tasks, win)}
        points={capacityMap(tasks)}
        snapshot={snapshotOf(bundle)}
        agentTeam={{
          saved: diagnostic.agent_team,
          suggested: suggestAgentTeam(tasks, {
            systemName: new Map(bundle.systems.map((s) => [s.id, s.name])),
            neverAlone: diagnostic.never_alone ?? [],
            neverAloneOther: diagnostic.never_alone_other,
          }),
        }}
        footer={footer}
      />
    );
  }
  if (step === "readout") {
    content = <ReadoutStep diagnostic={diagnostic} readout={assembleReadout(bundle, readoutToday())} footer={footer} />;
  }

  return (
    <PageShell
      eyebrow={`Capacity Diagnostic · ${DIAGNOSTIC_STEPS[index].label}${diagnostic.archived_at ? ", archived" : ""}`}
      title={client.name}
      subtitle={DIAGNOSTIC_STEPS[index].lead}
      backHref={`/diagnostics/clients/${client.id}`}
      backLabel={client.name}
      flush
    >
      {/* The steps as tabs, on the sand under the hero, never in it
          (Jason, 2026-10-29), each with where it stands (0309,
          lib/diagnostics/progress.ts). A step not reached yet is quieter. */}
      <nav className={styles.tabRow} aria-label="Diagnostic steps">
        {DIAGNOSTIC_STEPS.map((s, i) => (
          <Link
            key={s.key}
            href={`/diagnostics/${id}?step=${s.key}`}
            className={s.key === step ? styles.tabActive : styles.tab}
            aria-current={s.key === step ? "step" : undefined}
            data-ahead={i > reached ? "true" : undefined}
          >
            {s.label}
            <span className={styles.tabState} data-state={states[s.key]}>
              {STEP_STATE_LABEL[states[s.key]]}
            </span>
          </Link>
        ))}
      </nav>
      {content}
      <p className={styles.archiveRow}>
        <ArchiveButton kind="diagnostic" id={id} archived={Boolean(diagnostic.archived_at)} />
      </p>
    </PageShell>
  );
}
