"use client";

import { useState, useTransition } from "react";
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
  freshnessTab: string;
  freshnessCell: string;
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
      freshnessTab: "",
      freshnessCell: "",
    };
  }
  return {
    kind: mapping.kind,
    file: mapping.file_id,
    tab: mapping.tab,
    keyColumn: mapping.kind === "week_keyed" ? mapping.key_column : "",
    valueColumn: mapping.kind === "week_keyed" ? mapping.value_column : "",
    cell: mapping.kind === "snapshot" ? mapping.cell : "",
    freshnessTab: mapping.kind === "snapshot" ? (mapping.freshness?.tab ?? "") : "",
    freshnessCell: mapping.kind === "snapshot" ? (mapping.freshness?.cell ?? "") : "",
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
  const hasFreshness =
    draft.freshnessTab.trim().length > 0 && draft.freshnessCell.trim().length > 0;
  return {
    kind: "snapshot",
    file_id,
    tab: draft.tab,
    cell: draft.cell,
    ...(hasFreshness
      ? { freshness: { tab: draft.freshnessTab, cell: draft.freshnessCell } }
      : {}),
  };
}

export function ExternalSourceControls({ measureId }: { measureId: string }) {
  const info = useExternalMeasure(measureId);
  const { enabled, canPull, canAdminister } = useExternalMeasures();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [verify, setVerify] = useState<VerifyResponse | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(info?.mapping ?? null));

  if (!enabled) return null;
  const mapping = info?.mapping ?? null;
  if (!mapping && !canAdminister) return null;

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      setMessage({ ok: result.ok, text: result.message });
      // A pull writes an entry, so the row's value has to come back
      // from the server. router.refresh rather than local state: the
      // input's value, the status dot, the trend pills and the
      // receipt all change together, and re-deriving any of them here
      // would be a second source of truth for a number.
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className={styles.controls}>
      {mapping && canPull ? (
        <button
          type="button"
          className={uiStyles.btnSecondary}
          disabled={pending}
          onClick={() => run(() => pullExternalMeasureAction(measureId))}
        >
          {pending ? "Pulling…" : "Pull now"}
        </button>
      ) : null}

      {canAdminister ? (
        <details className={styles.adminWrap}>
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
                  Week keyed — find the row for the week
                </option>
                <option value="snapshot">
                  Snapshot — read one cell as it stands
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
                  Freshness is optional. Fill both boxes and the pull records
                  nothing unless that date is on or after the week&rsquo;s
                  Friday.
                </p>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Freshness tab</span>
                  <input
                    className={styles.input}
                    value={draft.freshnessTab}
                    onChange={(e) =>
                      setDraft({ ...draft, freshnessTab: e.target.value })
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Freshness cell</span>
                  <input
                    className={styles.input}
                    value={draft.freshnessCell}
                    onChange={(e) =>
                      setDraft({ ...draft, freshnessCell: e.target.value })
                    }
                    placeholder="B2"
                  />
                </label>
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
                  run(() => setExternalSourceAction(measureId, candidate));
                }}
              >
                Save source
              </button>
              {mapping ? (
                <>
                  {/* Onboarding, not routine. The client's sheet holds
                      history the platform does not, and without this
                      a new measure has no trend line for a month. */}
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
                  <button
                    type="button"
                    className={uiStyles.btnSecondary}
                    disabled={pending}
                    onClick={() => run(() => clearExternalSourceAction(measureId))}
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
