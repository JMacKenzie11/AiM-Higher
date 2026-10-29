import Link from "next/link";
import {
  SCREENS,
  nextAction,
  nextScreen,
  screenHref,
  screensOf,
  skippedSoFar,
  stateOf,
  stepFromScreens,
  stepPercent,
  type ScreenState,
} from "@/lib/diagnostics/screens";
import { STEP_STATE_LABEL } from "@/lib/diagnostics/progress";
import { DIAGNOSTIC_STEPS } from "@/lib/diagnostics/steps";
import type { DiagnosticBundle } from "@/lib/diagnostics/types";
import styles from "../diagnostics.module.css";

// THE OVERVIEW HUB (the guided screens; Jason, 2026-10-29, approved
// mockup). What /diagnostics/[id] opens on: what to do next and a
// Continue straight to it, each step's place and share done with its
// next action, every screen with where it stands (open any of them),
// what was skipped on the way, and the one lock: Publish needs the
// first win's measured week.

const DOT_LABEL: Record<ScreenState, string> = { done: "Done", started: "Started", not_started: "Not started", locked: "Needs something first" };

export function Overview({ bundle, states }: { bundle: Pick<DiagnosticBundle, "diagnostic" | "systems" | "links" | "tasks" | "firstWin">; states: Record<string, ScreenState> }) {
  const id = bundle.diagnostic.id;
  const next = nextScreen(states);
  const skipped = skippedSoFar(bundle, states);
  const steps = DIAGNOSTIC_STEPS.filter((s) => screensOf(s.key).length > 0);
  const publishLocked = states["readout.publish"] === "locked";

  return (
    <>
      {next ? (
        <section className={styles.nextUp} aria-labelledby="dx-next">
          <div>
            <div className={styles.status}>Next up</div>
            <h2 id="dx-next" className={styles.screenHeading}>
              {nextAction(next, bundle)}
            </h2>
            <p className={styles.screenWhy}>
              {DIAGNOSTIC_STEPS.find((s) => s.key === next.step)?.label} · {next.title}. {next.why}
            </p>
          </div>
          <Link href={screenHref(id, next)} className={styles.primary}>
            Continue
          </Link>
        </section>
      ) : (
        <section className={styles.nextUp} aria-labelledby="dx-next">
          <h2 id="dx-next" className={styles.screenHeading}>
            Every screen is done.
          </h2>
        </section>
      )}

      <section className={styles.stepCards} aria-label="Steps">
        {steps.map((s) => {
          const state = stepFromScreens(s.key, states);
          const pct = stepPercent(s.key, states);
          const stepNext = nextScreen(states, s.key);
          return (
            <article key={s.key} className={styles.stepCard}>
              <div className={styles.screenProgressHead}>
                <h3 className={styles.cardTitle}>{s.label}</h3>
                <span className={styles.tabState} data-state={state}>
                  {STEP_STATE_LABEL[state]}
                </span>
              </div>
              <div className={styles.progress} data-tone={state === "complete" ? "good" : undefined} role="img" aria-label={`${pct}% done`}>
                <div style={{ width: `${pct}%` }} />
              </div>
              <span className={styles.status}>{pct}% done</span>
              <p>{stepNext ? nextAction(stepNext, bundle) : "Everything here is done."}</p>
              <Link href={stepNext ? screenHref(id, stepNext) : screenHref(id, screensOf(s.key)[0])} className={styles.link}>
                Open {s.label}
              </Link>
            </article>
          );
        })}
      </section>

      <section className={styles.card} aria-labelledby="dx-every-screen">
        <div className={styles.cardHeader}>
          <h2 id="dx-every-screen" className={styles.cardTitle}>
            Every screen
          </h2>
          <span className={styles.status}>Open any of them. Nothing is locked unless it needs something first.</span>
        </div>
        <div className={styles.everyScreen}>
          {steps.map((s) => (
            <div key={s.key}>
              <h3>{s.label}</h3>
              {SCREENS.filter((x) => x.step === s.key).map((x) => {
                const state = stateOf(states, x);
                return (
                  <div key={x.key} className={styles.screenDot} data-state={state}>
                    <div>
                      <Link href={screenHref(id, x)} className={styles.link}>
                        {x.title}
                      </Link>
                      <span className={styles.srOnly}>, {DOT_LABEL[state]}</span>
                      {state === "locked" ? <div className={styles.lockNote}>Needs a measured first win</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {skipped.length ? (
        <section className={styles.card} aria-labelledby="dx-skipped">
          <div className={styles.cardHeader}>
            <h2 id="dx-skipped" className={styles.cardTitle}>
              Skipped so far
            </h2>
          </div>
          <p className={`${styles.status} ${styles.cardLead}`}>None of these stop you moving on. The ones marked Readout show on the readout.</p>
          <ul className={styles.plainList}>
            {skipped.map((k) => (
              <li key={k.text}>
                <span>
                  {k.onReadout ? <span className={`${styles.chip} ${styles.chipWarn}`}>Readout</span> : null} {k.text}
                </span>
                <Link href={screenHref(id, { step: k.step as never, key: k.screen })} className={styles.link}>
                  {SCREENS.find((x) => x.step === k.step && x.key === k.screen)?.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {publishLocked ? (
        <section className={styles.card} aria-labelledby="dx-locked">
          <div className={styles.body}>
            <h2 id="dx-locked" className={styles.cardTitle}>
              Publishing the readout needs a first win
            </h2>
            <p className={styles.status}>The readout leads with the first win&rsquo;s measured hours. Choose it and measure its first full week.</p>
            <span>
              <Link href={screenHref(id, { step: "build", key: "candidates" })} className={styles.secondary}>
                {bundle.firstWin ? "Measure the first win" : "Choose the first win"}
              </Link>
            </span>
          </div>
        </section>
      ) : null}
    </>
  );
}
