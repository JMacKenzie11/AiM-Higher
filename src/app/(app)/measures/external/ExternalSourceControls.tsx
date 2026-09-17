"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  backfillExternalMeasureAction,
  clearExternalSourceAction,
  pullExternalMeasureAction,
  setExternalSourceAction,
  verifyExternalSourceAction,
  type VerifyResponse,
} from "@/lib/external-measures/actions";
import { extractFileId, type ExternalMapping } from "@/lib/external-measures/mapping";
import uiStyles from "@/components/ui/ui.module.css";
import { useExternalMeasure, useExternalMeasures } from "./ExternalMeasuresContext";
import styles from "./external.module.css";

// Pull now, and (for a system_admin) the mapping itself.
//
// PHASE 1 IS DELIBERATELY MINIMAL. No file picker, no tab list, no
// heading list — a system_admin is told the file, the tab and the
// headings by the client and types them in. Phase 4 is where a client
// does this themselves, and it needs all three of those plus an
// explanation of what a pull is allowed to overwrite. Building the
// friendly version now would mean building it for an audience of one
// person who already knows the answers.
//
// What it does have is VERIFY, and that is the part worth keeping.
// A mapping is four strings that are all plausible and all easy to
// get wrong, and the only way to know is to read the sheet. Verify
// reads it and shows what it found, and cannot write: it does not
// call record_external_pull, so there is no path from this button to
// an entry or a log row.

type Draft = {
  kind: "week_keyed" | "snapshot";
  file: string;
  tab: string;
  keyColumn: string;
  valueColumn: string;
  cell: string;
  // CARRIED, NOT EDITED. There are no freshness inputs on this panel
  // — removed on the product owner's call, because two boxes about
  // spreadsheet staleness are a riddle to anybody who did not design
  // the feature. The mapping shape still supports it and the pull
  // still enforces it, so a mapping that has one (set by a script, or
  // by the phase 2 scheduler) must survive an admin opening this
  // panel and pressing Save. A form that silently deletes
  // configuration it does not display is a trap.
  freshness?: { tab: string; cell: string };
};

function draftFrom(mapping: ExternalMapping | null): Draft {
  if (!mapping) {
    return {
      kind: "week_keyed",
      file: "",
      tab: "",
      keyColumn: "",
      valueColumn: "",
      cell: "",
    };
  }
  return {
    kind: mapping.kind,
    file: mapping.file_id,
    tab: mapping.tab,
    keyColumn: mapping.kind === "week_keyed" ? mapping.key_column : "",
    valueColumn: mapping.kind === "week_keyed" ? mapping.value_column : "",
    cell: mapping.kind === "snapshot" ? mapping.cell : "",
    freshness: mapping.kind === "snapshot" ? mapping.freshness : undefined,
  };
}

// The draft as the shape the action expects, or null when the file
// field does not yield an id. Everything else is validated by
// parseMapping on the server; this only handles the one field whose
// input is a pasted URL.
function toMapping(draft: Draft): unknown | null {
  const file_id = extractFileId(draft.file);
  if (!file_id) return null;
  if (draft.kind === "week_keyed") {
    return {
      kind: "week_keyed",
      file_id,
      tab: draft.tab,
      key_column: draft.keyColumn,
      value_column: draft.valueColumn,
    };
  }
  return {
    kind: "snapshot",
    file_id,
    tab: draft.tab,
    cell: draft.cell,
    // Passed straight back out if it was there. See the note on Draft.
    ...(draft.freshness ? { freshness: draft.freshness } : {}),
  };
}

export function ExternalSourceControls({
  measureId,
  className,
}: {
  measureId: string;
  // Supplied by the row so this can span the measures grid. It has to
  // arrive as a prop rather than be wrapped by the caller: the row is
  // `display: contents`, so a wrapper would be a grid item in its own
  // right and would draw an empty full-width strip under every
  // measure on the page, feature off or on.
  className?: string;
}) {
  const info = useExternalMeasure(measureId);
  const { enabled, canPull, canAdminister, weeks } = useExternalMeasures();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [verify, setVerify] = useState<VerifyResponse | null>(null);
  // A REF, NOT STATE. The disclosure stays uncontrolled — React never
  // sets its `open` prop, so it keeps owning whether it is open and a
  // server refresh cannot reopen it behind the user's back. Closing
  // it after a save is one imperative nudge, which is a different
  // thing from owning the state: the last attempt to own a panel's
  // open state on this page threw away an in-flight router.refresh()
  // and the saved row never appeared.
  const panelRef = useRef<HTMLDetailsElement>(null);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(info?.mapping ?? null));
  // Which week a pull targets. Always one of the platform's own
  // week-endings; the select below offers those and nothing else.
  //
  // THE DEFAULT FOLLOWS THE MAPPING, and there are three cases rather
  // than two:
  //
  //   week_keyed            this week. The sheet has a row per week
  //                         and this week's is the one being filled.
  //   snapshot, no freshness  this week. The mapping means "whatever
  //                         is in that cell right now", so now is the
  //                         week it belongs to.
  //   snapshot + freshness  the last COMPLETED week. A dashboard that
  //                         carries an as-of date is reporting a
  //                         closed period, so the current week is the
  //                         one week its number is certainly not
  //                         about, and defaulting there would hand a
  //                         new user a decline on their first press.
  const mappingForWeek = info?.mapping ?? null;
  const reportsAClosedPeriod =
    mappingForWeek?.kind === "snapshot" && !!mappingForWeek.freshness;
  const defaultWeek =
    reportsAClosedPeriod && weeks.length > 1
      ? weeks[weeks.length - 2]
      : (weeks[weeks.length - 1] ?? "");
  const [week, setWeek] = useState<string>(defaultWeek);

  if (!enabled) return null;
  const mapping = info?.mapping ?? null;
  if (!mapping && !canAdminister) return null;

  // `closeOnSuccess` is for the two actions that END a task. Saving
  // or clearing a mapping is finished business and the panel should
  // get out of the way; pulling a week is not, and leaves everything
  // where it was so the button can be pressed again for another week.
  function run(
    fn: () => Promise<{ ok: boolean; message: string }>,
    closeOnSuccess = false
  ) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok && closeOnSuccess) {
        if (panelRef.current) panelRef.current.open = false;
        // The read that verify printed described the mapping as it
        // was being edited. Once saved, leaving it on screen means
        // reopening the panel later shows a result from a session
        // that ended.
        setVerify(null);
      }
      // A pull writes an entry, so the row's value has to come back
      // from the server. router.refresh rather than local state: the
      // input's value, the status dot, the trend pills and the
      // receipt all change together, and re-deriving any of them here
      // would be a second source of truth for a number.
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className={className ? `${styles.controls} ${className}` : styles.controls}>
      {mapping && canPull ? (
        <div className={styles.pullRow}>
          <button
            type="button"
            className={uiStyles.btnSecondary}
            disabled={pending}
            onClick={() => run(() => pullExternalMeasureAction(measureId, week))}
          >
            {pending ? "Pulling…" : "Pull now"}
          </button>
          {/* The weeks the platform recognises, and only those. The
              action re-checks the choice against the same list, so
              this select is a convenience rather than the boundary. */}
          <label className={styles.weekPick}>
            <span className={styles.srOnly}>Week to pull</span>
            <select
              className={styles.input}
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              disabled={pending}
            >
              {[...weeks].reverse().map((w, i) => (
                <option key={w} value={w}>
                  {i === 0 ? `${w} (this week)` : w}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {canAdminister ? (
        <details className={styles.adminWrap} ref={panelRef}>
          <summary className={styles.adminSummary}>
            {mapping ? "External source" : "Add external source"}
          </summary>
          <div className={styles.adminPanel}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Kind</span>
              <select
                className={styles.input}
                value={draft.kind}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    kind: e.target.value as Draft["kind"],
                  })
                }
              >
                <option value="week_keyed">
                  Week keyed: find the row for the week
                </option>
                <option value="snapshot">
                  Snapshot: read one cell in real time
                </option>
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Spreadsheet link or id</span>
              <input
                className={styles.input}
                value={draft.file}
                onChange={(e) => setDraft({ ...draft, file: e.target.value })}
                placeholder="https://docs.google.com/spreadsheets/d/…"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Tab name</span>
              <input
                className={styles.input}
                value={draft.tab}
                onChange={(e) => setDraft({ ...draft, tab: e.target.value })}
                placeholder="Dashboard Data"
              />
            </label>

            {draft.kind === "week_keyed" ? (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Key column heading</span>
                  <input
                    className={styles.input}
                    value={draft.keyColumn}
                    onChange={(e) =>
                      setDraft({ ...draft, keyColumn: e.target.value })
                    }
                    placeholder="Week Ending"
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Value column heading</span>
                  <input
                    className={styles.input}
                    value={draft.valueColumn}
                    onChange={(e) =>
                      setDraft({ ...draft, valueColumn: e.target.value })
                    }
                    placeholder="Pounds Shipped"
                  />
                </label>
              </>
            ) : (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Cell</span>
                  <input
                    className={styles.input}
                    value={draft.cell}
                    onChange={(e) => setDraft({ ...draft, cell: e.target.value })}
                    placeholder="B7"
                  />
                </label>
                <p className={styles.fieldNote}>
                  Reads whatever is in that cell at the moment you pull, and
                  records it against the week you choose.
                </p>
              </>
            )}

            <div className={styles.adminActions}>
              <button
                type="button"
                className={uiStyles.btnSecondary}
                disabled={pending}
                onClick={() => {
                  const candidate = toMapping(draft);
                  if (!candidate) {
                    setMessage({
                      ok: false,
                      text: "That does not look like a Google Sheets link or id.",
                    });
                    return;
                  }
                  setMessage(null);
                  startTransition(async () => {
                    setVerify(
                      await verifyExternalSourceAction(measureId, candidate)
                    );
                  });
                }}
              >
                Verify
              </button>
              <button
                type="button"
                className={uiStyles.btnSecondary}
                disabled={pending}
                onClick={() => {
                  const candidate = toMapping(draft);
                  if (!candidate) {
                    setMessage({
                      ok: false,
                      text: "That does not look like a Google Sheets link or id.",
                    });
                    return;
                  }
                  run(() => setExternalSourceAction(measureId, candidate), true);
                }}
              >
                Save source
              </button>
              {mapping ? (
                <>
                  {/* Onboarding, not routine, and week_keyed only: a
                      snapshot has one value for one period, so
                      walking it over four weeks would write the same
                      number into all four. The action refuses it too;
                      this just does not offer it. */}
                  {mapping.kind === "week_keyed" ? (
                  <button
                    type="button"
                    className={uiStyles.btnSecondary}
                    disabled={pending}
                    onClick={() => {
                      setMessage(null);
                      startTransition(async () => {
                        const result = await backfillExternalMeasureAction(
                          measureId,
                          4
                        );
                        if (!result.ok) {
                          setMessage({ ok: false, text: result.message });
                          return;
                        }
                        // Week by week, because "3 of 4 worked" is
                        // the answer that matters and a single
                        // summary line hides which one did not.
                        setMessage({
                          ok: true,
                          text: result.results
                            .map((r) => `${r.weekEnding}: ${r.outcome}`)
                            .join(" · "),
                        });
                        router.refresh();
                      });
                    }}
                  >
                    Pull last 4 weeks
                  </button>
                  ) : null}
                  <button
                    type="button"
                    className={uiStyles.btnSecondary}
                    disabled={pending}
                    onClick={() =>
                      run(() => clearExternalSourceAction(measureId), true)
                    }
                  >
                    Clear
                  </button>
                </>
              ) : null}
            </div>

            {verify ? <VerifyPanel result={verify} /> : null}
          </div>
        </details>
      ) : null}

      {message ? (
        <p className={message.ok ? styles.messageOk : styles.messageBad}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

function VerifyPanel({ result }: { result: VerifyResponse }) {
  if (!result.ok) {
    return <p className={styles.messageBad}>{result.message}</p>;
  }
  return (
    <div className={styles.verify}>
      <p className={styles.verifyDescription}>{result.description}</p>
      {result.rows.length === 0 ? (
        <p className={styles.messageBad}>
          Nothing was found to show. The tab may be empty, or the key column may
          hold something other than dates.
        </p>
      ) : (
        <dl className={styles.receiptList}>
          {result.rows.map((row) => (
            <div key={row.label} className={styles.receiptRow}>
              <dt className={styles.receiptLabel}>{row.label}</dt>
              <dd className={styles.receiptValue}>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {result.note ? <p className={styles.verifyNote}>{result.note}</p> : null}
    </div>
  );
}
