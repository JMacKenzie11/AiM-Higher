"use client";

import { useState } from "react";
import type { CoachingCallsHq } from "@/lib/coaching-calls/hq";
import { shortDay } from "@/lib/hq/derive";
import { AnalyseCall, MoveCall } from "./CoachingCallsControls";
import { UploadTranscriptForm } from "../leadership/UploadTranscriptForm";
import ui from "@/components/ui/ui.module.css";
import styles from "./hq.module.css";
import cc from "./coaching-calls.module.css";
import t from "./hq-tabs.module.css";

// Waiting to be analysed (was Calls to sort, 0326): the calls from the
// coach's own folder that found no company, or more than one. Each
// shows its date, length when the transcript says, who was on it, and
// AiMS's best guess with why, already chosen in the picker. Analyse
// files it and starts the analysis; the line that replaces it says so.
// No Undo: a filed call moves between companies with Move (below), and
// nothing puts one back in the queue.

const NUMBER_WORDS = ["", "one", "two", "three", "four", "five"];

export function WaitingSection({
  data,
  companies,
  today,
}: {
  today: string;
  data: CoachingCallsHq;
  companies: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [done, setDone] = useState<Array<{ id: string; line: string }>>([]);
  // Upload a call lives here, with the calls (Jason, 2026-11-17; it was
  // on the recordings card).
  const [uploading, setUploading] = useState(false);
  const doneIds = new Set(done.map((d) => d.id));
  const waiting = data.toSort.filter((c) => !doneIds.has(c.id));
  const nameOf = new Map(companies.map((c) => [c.id, c.name] as const));

  return (
    <section className={styles.card} aria-labelledby="hq-waiting">
      <div className={t.headRow}>
        <h2 id="hq-waiting" className={styles.h2}>
          Waiting to be analysed
        </h2>
        <div className={t.headActions}>
          {waiting.length > 0 ? <span className={t.caption}>{waiting.length} waiting</span> : null}
          <button
            type="button"
            className={`${ui.btn} ${ui.btnSecondary}`}
            aria-expanded={uploading}
            onClick={() => setUploading((u) => !u)}
          >
            Upload a call
          </button>
        </div>
      </div>
      {uploading ? (
        <div className={t.panelBox}>
          <h3 className={cc.h3}>Upload a call</h3>
          <p className={t.caption}>Choose the company the call was with, then the transcript.</p>
          <UploadTranscriptForm today={today} kind="coaching" companies={companies} />
        </div>
      ) : null}
      <p className={t.caption}>
        These are calls AiMS-HQ couldn&apos;t match to a company on its own. Pick the right company and AiMS-HQ
        will analyse the call. Only the company&apos;s coaches, its admins and the people they have added will see it.
      </p>

      {done.map((d) => (
        <p key={d.id} role="status" className={t.doneLine}>
          {d.line}
        </p>
      ))}

      {waiting.length === 0 ? (
        <p className={styles.empty}>
          {data.folder
            ? "You're all caught up. Every call found its company."
            : "Once your folder is connected, any call AiMS-HQ can't match to a company will wait here for you."}
        </p>
      ) : (
        <ul className={t.rowList}>
          {waiting.map((call) => {
            const meta = [
              shortDay(call.heldOn),
              call.minutes ? `${call.minutes} min` : null,
              call.onTheCall.length > 0 ? call.onTheCall.join(", ") : null,
            ].filter(Boolean);
            const likely = new Set(call.candidates?.companyIds ?? (call.guess ? [call.guess.companyId] : []));
            const options = companies.map((c) => ({
              ...c,
              group: likely.has(c.id) ? ("likely" as const) : ("other" as const),
            }));
            options.sort((a, b) => (a.group === b.group ? 0 : a.group === "likely" ? -1 : 1));
            const n = call.candidates?.companyIds.length ?? 0;
            const count = NUMBER_WORDS[n] ?? String(n);
            return (
              <li key={call.id} className={t.waitRow}>
                <div className={t.needsText}>
                  <span className={t.needsName}>{call.title}</span>
                  <span className={t.caption}>{meta.join(" · ")}</span>
                  {call.guess ? (
                    <span className={t.needsReason}>
                      Looks like <strong>{nameOf.get(call.guess.companyId) ?? "one of your companies"}</strong>: {call.guess.because}.
                    </span>
                  ) : call.candidates ? (
                    <span className={t.needsReason}>
                      {call.candidates.on === "people"
                        ? `People from ${count} of your companies were on it. Which one is it for?`
                        : `Its name matches ${count} of your companies. Which one is it for?`}
                    </span>
                  ) : (
                    <span className={t.needsReason}>Nothing on it matched one of your companies. Which one is it for?</span>
                  )}
                </div>
                <AnalyseCall
                  meetingId={call.id}
                  title={call.title}
                  companies={options}
                  suggestedAlias={call.suggestedAlias}
                  preselect={call.guess?.companyId ?? null}
                  onDone={(line) => setDone((cur) => [...cur, { id: call.id, line }])}
                />
              </li>
            );
          })}
        </ul>
      )}

      {data.filed.length > 0 ? (
        <div className={cc.filed}>
          <h3 className={cc.h3}>Filed automatically this week</h3>
          <ul className={cc.filedList}>
            {data.filed.map((f) => (
              <li key={f.id} className={cc.filedItem}>
                <span>
                  <strong>{f.companyName}</strong> · {f.title}
                  {f.because ? ` · ${f.because}` : ""}
                </span>
                <MoveCall meetingId={f.id} currentCompanyId={f.companyId} companies={companies} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
