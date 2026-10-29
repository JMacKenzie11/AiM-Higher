import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireDiagnostics } from "@/lib/diagnostics/access";
import { getDiagnostic, readoutToday } from "@/lib/diagnostics/service";
import { DIAGNOSTIC_STEPS, isStep, stepAfter, stepBefore, stepForStatus, type DiagnosticStep } from "@/lib/diagnostics/steps";
import { toTask, toWin } from "@/lib/diagnostics/types";
import { candidateGroups, capacityMap, summarize, topNextWins } from "@/lib/diagnostics/hours-back";
import { snapshotOf } from "@/lib/diagnostics/systems-snapshot";
import { assembleReadout } from "@/lib/diagnostics/readout";
import { suggestAgentTeam } from "@/lib/diagnostics/agents";
import { STEP_STATE_LABEL, stepStates } from "@/lib/diagnostics/progress";
import { agentTeam } from "@/lib/diagnostics/agents";
import { SCREENS, nextScreen, screenHref, screenOf, screenStates, screensOf, stateOf } from "@/lib/diagnostics/screens";
import { SaveBadge, SaveStatusProvider, ScreenFooter } from "./SaveStatus";
import { Overview } from "./Overview";
import { shortDate } from "../format";
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

// THE ENGAGEMENT PAGE. One Capacity Diagnostic. With no step in the
// address it opens on the overview hub; with one, on a guided screen of
// that step (?step=preflight&screen=systems), each with its progress,
// one save status, and Back, Save and exit, and Next (Jason,
// 2026-10-29, the approved wizard mockup). Any screen can be opened
// directly, and a reload stays on it. Every write goes through the
// caller's own client (lib/diagnostics/actions.ts), and every figure
// comes from lib/diagnostics/hours-back.ts. While the interviews show
// (steps.ts), their two steps keep the one-card shape with the old
// footer.

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DiagnosticPage({ params, searchParams }: PageProps) {
  const session = await requireDiagnostics();
  const { id } = await params;
  const sp = await searchParams;
  const bundle = await getDiagnostic(id);
  if (!bundle) notFound();
  const { diagnostic, client } = bundle;

  const raw = one(sp.step);
  const step: DiagnosticStep | null = isStep(raw) ? raw : null;
  const reached = DIAGNOSTIC_STEPS.findIndex((s) => s.key === stepForStatus(diagnostic.status));

  const tasks = bundle.tasks.map(toTask);
  const win = toWin(bundle.firstWin);
  const suggested = suggestAgentTeam(tasks, {
    systemName: new Map(bundle.systems.map((s) => [s.id, s.name])),
    neverAlone: diagnostic.never_alone ?? [],
    neverAloneOther: diagnostic.never_alone_other,
  });
  const readout = assembleReadout(bundle, readoutToday());
  const screenStatesNow = screenStates(bundle, { agentCount: agentTeam(diagnostic.agent_team, suggested).length, readout });
  const states = stepStates(bundle);

  // The interviews' own steps, shown only while INTERVIEWS_SHOWN.
  const legacy = step === "survey" || step === "conversations";
  const screens = step && !legacy ? screensOf(step) : [];
  const screen = step && !legacy ? (screenOf(step, one(sp.screen)) ?? screens[0]) : null;

  let content: ReactNode = null;
  if (step === "preflight") content = <PreflightStep diagnostic={diagnostic} systems={bundle.systems} links={bundle.links} tasks={bundle.tasks} screen={screen!.key} />;
  if (step === "kickoff") {
    content = (
      <KickoffStep
        diagnostic={diagnostic}
        client={client}
        participants={bundle.participants}
        leadName={session.profile.full_name ?? "the person running this diagnostic"}
        screen={screen!.key}
      />
    );
  }
  if (legacy) {
    const prev = stepBefore(step!);
    const next = stepAfter(step!);
    const footer = (
      <StepFooter
        diagnosticId={id}
        prev={prev ? { key: prev, label: DIAGNOSTIC_STEPS.find((s) => s.key === prev)!.label } : null}
        next={next ? { key: next, label: DIAGNOSTIC_STEPS.find((s) => s.key === next)!.label } : null}
        blocked={null}
      />
    );
    content =
      step === "survey" ? (
        <SurveyStep diagnosticId={id} participants={bundle.participants} tasks={bundle.tasks} answers={bundle.answers} systems={bundle.systems} aiUse={bundle.aiUse} footer={footer} />
      ) : (
        <ConversationsStep diagnosticId={id} participants={bundle.participants} notes={bundle.notes} quotes={bundle.quotes} footer={footer} />
      );
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
        agentTeam={{ saved: diagnostic.agent_team, suggested }}
        screen={screen!.key}
      />
    );
  }
  if (step === "readout") content = <ReadoutStep diagnostic={diagnostic} readout={readout} screen={screen!.key} />;

  // Back and Next run through every screen in order, across the steps;
  // the first screen's Back and the last's Next lead to the overview.
  const overview = `/diagnostics/${id}`;
  const at = screen ? SCREENS.findIndex((s) => s.step === screen.step && s.key === screen.key) : -1;
  const before = at > 0 ? SCREENS[at - 1] : null;
  const after = at >= 0 && at < SCREENS.length - 1 ? SCREENS[at + 1] : null;
  const stepLabel = (k: string) => DIAGNOSTIC_STEPS.find((s) => s.key === k)?.label ?? k;
  const position = screen ? screens.findIndex((s) => s.key === screen.key) + 1 : 0;

  return (
    <PageShell
      eyebrow={`Capacity Diagnostic · ${step ? stepLabel(step) : "Overview"}${diagnostic.archived_at ? ", archived" : ""}`}
      title={client.name}
      subtitle={step ? DIAGNOSTIC_STEPS.find((s) => s.key === step)?.lead : diagnostic.readout_at ? `Readout on ${shortDate(diagnostic.readout_at)}.` : "Start anywhere. Continue takes you to the next thing to do."}
      backHref={`/diagnostics/clients/${client.id}`}
      backLabel={client.name}
      flush
    >
      {/* The overview and the steps as tabs, on the sand under the hero,
          never in it (Jason, 2026-10-29), each step with where it stands
          (lib/diagnostics/progress.ts). A step not reached yet is quieter. */}
      <nav className={styles.tabRow} aria-label="Diagnostic steps">
        <Link href={overview} className={step ? styles.tab : styles.tabActive} aria-current={step ? undefined : "page"}>
          Overview
        </Link>
        {DIAGNOSTIC_STEPS.map((s, i) => {
          const into = screensOf(s.key).length ? (nextScreen(screenStatesNow, s.key) ?? screensOf(s.key)[0]) : null;
          return (
            <Link
              key={s.key}
              href={into ? screenHref(id, into) : `/diagnostics/${id}?step=${s.key}`}
              className={s.key === step ? styles.tabActive : styles.tab}
              aria-current={s.key === step ? "step" : undefined}
              data-ahead={i > reached ? "true" : undefined}
            >
              {s.label}
              <span className={styles.tabState} data-state={states[s.key]}>
                {STEP_STATE_LABEL[states[s.key]]}
              </span>
            </Link>
          );
        })}
      </nav>

      {!step ? <Overview bundle={bundle} states={screenStatesNow} /> : null}

      {screen ? (
        <SaveStatusProvider>
          <section className={styles.screenProgress} aria-label={`${stepLabel(screen.step)} progress`}>
            <div className={styles.screenProgressHead}>
              <span>
                {stepLabel(screen.step)} · {position} of {screens.length}
              </span>
              <SaveBadge />
            </div>
            <div className={styles.progress} aria-hidden="true">
              <div style={{ width: `${Math.round((position / screens.length) * 100)}%` }} />
            </div>
            <ol className={styles.screenList}>
              {screens.map((s, i) => {
                const st = stateOf(screenStatesNow, s);
                return (
                  <li key={s.key}>
                    <Link href={screenHref(id, s)} aria-current={s.key === screen.key ? "page" : undefined} data-state={st}>
                      {st === "done" ? "✓" : `${i + 1}.`} {s.title}
                      <span className={styles.srOnly}>, {st === "done" ? "done" : st === "locked" ? "needs something first" : st === "started" ? "started" : "not started"}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
          <div>
            <h2 className={styles.screenHeading}>{screen.heading}</h2>
            <p className={styles.screenWhy}>{screen.why}</p>
          </div>
          {content}
          <ScreenFooter
            diagnosticId={id}
            overview={overview}
            back={before ? { href: screenHref(id, before), label: before.title } : { href: overview, label: "Overview" }}
            next={after ? { href: screenHref(id, after), label: after.title, step: after.step, crossesStep: after.step !== screen.step } : null}
          />
        </SaveStatusProvider>
      ) : (
        content
      )}

      <p className={styles.archiveRow}>
        <ArchiveButton kind="diagnostic" id={id} archived={Boolean(diagnostic.archived_at)} />
      </p>
    </PageShell>
  );
}
