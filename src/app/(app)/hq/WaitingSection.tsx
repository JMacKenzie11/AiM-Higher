"use client";

import { useState } from "react";
import type { CoachingCallsHq } from "@/lib/coaching-calls/hq";
import { shortDay } from "@/lib/hq/derive";
import { AnalyseCall, MoveCall } from "./CoachingCallsControls";
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
}: {
  data: CoachingCallsHq;
  companies: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [done, setDone] = useState<Array<{ id: string; line: string }>>([]);
  const doneIds = new Set(done.map((d) => d.id));
  const waiting = data.toSort.filter((c) => !doneIds.has(c.id));
  const nameOf = new Map(companies.map((c) => [c.id, c.name] as const));

  return (
    <section className={styles.card} aria-labelledby="hq-waiting">
      <div className={t.headRow}>
        <h2 id="hq-waiting" className={styles.h2}>
          Waiting to be analysed
        </h2>
        <span className={t.caption}>{waiting.length} waiting</span>
      </div>
      <p className={t.caption}>
        Confirm the company and AiMS analyses the call. Only you, the company&apos;s other coaches and its AiMS Champion see it.
      </p>

      {done.map((d) => (
        <p key={d.id} role="status" className={t.doneLine}>
          {d.line}
        </p>
      ))}

      {waiting.length === 0 ? (
        <p className={styles.empty}>
          {data.folder
            ? "Nothing is waiting. Every call found its company."
            : "Connect your folder and calls that can't be matched wait here."}
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
