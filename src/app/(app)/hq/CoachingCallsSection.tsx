import type { CoachingCallsHq } from "@/lib/coaching-calls/hq";
import { FolderControls, MoveCall, SortCall } from "./CoachingCallsControls";
import styles from "./hq.module.css";
import cc from "./coaching-calls.module.css";

// Coach HQ: your own folder of coaching calls, and the calls in it
// waiting to be sorted (0326). Only the coach sees this, about their
// own folder: loadCoachingCallsHq reads through their client.
// This is the one place a coach sets up call recordings; a company's
// Connections tab no longer offers coaching calls (Jason, 2026-11-16).

export function CoachingCallsSection({
  data,
  companies,
  flash,
}: {
  data: CoachingCallsHq;
  companies: ReadonlyArray<{ id: string; name: string }>;
  flash: { connected: string | null; error: string | null };
}) {
  return (
    <div className={cc.row}>
      <section className={`${styles.card} ${cc.folder}`} aria-labelledby="coaching-calls-folder">
        <h2 id="coaching-calls-folder" className={styles.h2}>
          Your coaching calls folder
        </h2>
        {!data.folder ? (
          <p className={cc.text}>Set up your call recordings here, once, for every company you coach.</p>
        ) : null}
        {flash.connected ? (
          <p role="status" className={cc.ok}>Google connected as {flash.connected}.</p>
        ) : null}
        {flash.error ? (
          <p role="alert" className={cc.error}>Google wasn&apos;t connected: {flash.error}</p>
        ) : null}
        <FolderControls
          account={data.account}
          folder={data.folder}
        />
        <div className={cc.how}>
          <h3 className={cc.h3}>How a call finds its company</h3>
          <ol className={cc.steps}>
            <li>The file name holds one of the company&apos;s names, listed under Names that identify this company on its Connections tab.</li>
            <li>Someone on the call is a person at one of your companies, by name or email.</li>
            <li>Otherwise it waits under Calls to sort, and you choose.</li>
          </ol>
          <p className={styles.sectionCaption}>
            Only companies you coach are matched. A call that matches two companies waits for you.
          </p>
        </div>
      </section>

      <section className={`${styles.card} ${cc.sort}`} aria-labelledby="calls-to-sort">
        <div className={cc.headRow}>
          <h2 id="calls-to-sort" className={styles.h2}>
            Calls to sort
          </h2>
          <span className={styles.sectionCaption}>{data.toSort.length} waiting</span>
        </div>
        {data.toSort.length === 0 ? (
          <p className={styles.empty}>
            {data.folder ? "Nothing to sort. Every call found its company." : "Connect your folder and calls that can't be matched wait here."}
          </p>
        ) : (
          <ul className={cc.list}>
            {data.toSort.map((call) => (
              <li key={call.id} className={cc.item}>
                <div className={cc.itemHead}>
                  <div>
                    <div className={cc.title}>{call.title}</div>
                    <div className={cc.meta}>
                      {new Date(call.heldOn).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                      {call.onTheCall.length > 0 ? ` · on the call: ${call.onTheCall.join(", ")}` : ""}
                    </div>
                  </div>
                  <span className={cc.chip}>{call.reason === "several" ? "Matches 2 or more companies" : "No match"}</span>
                </div>
                <SortCall meetingId={call.id} companies={companies} suggestedAlias={call.suggestedAlias} />
              </li>
            ))}
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
    </div>
  );
}
