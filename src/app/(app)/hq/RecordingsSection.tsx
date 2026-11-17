"use client";

import { useState, useTransition } from "react";
import type { CoachingCallsHq } from "@/lib/coaching-calls/hq";
import {
  checkCoachFolderNowAction,
  removeCoachFolderAction,
  type CoachActionResult,
} from "@/lib/coaching-calls/actions";
import { UploadTranscriptForm } from "../leadership/UploadTranscriptForm";
import { FolderControls } from "./CoachingCallsControls";
import ui from "@/components/ui/ui.module.css";
import styles from "./hq.module.css";
import cc from "./coaching-calls.module.css";
import t from "./hq-tabs.module.css";

// Recordings, at the top of the Coaching calls tab (0326). Connected:
// one slim line (the folder, when it was last checked, Check now,
// Upload a call, Settings). Not connected: the setup card, Connect
// Google and how a call finds its company. Upload a call works either
// way: choose the company, then the file (uploadCoachingCallAction,
// for a company the coach is assigned to).

function checkedAgo(iso: string | null): string {
  if (!iso) return "not checked yet";
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 1) return "checked just now";
  if (min < 60) return `checked ${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `checked ${hr} hour${hr === 1 ? "" : "s"} ago`;
  const d = Math.round(hr / 24);
  return `checked ${d} day${d === 1 ? "" : "s"} ago`;
}

export function RecordingsSection({
  data,
  companies,
  today,
  flash,
}: {
  data: CoachingCallsHq;
  companies: ReadonlyArray<{ id: string; name: string }>;
  today: string;
  flash: { connected: string | null; error: string | null };
}) {
  const [panel, setPanel] = useState<"upload" | "settings" | null>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<CoachActionResult | null>(null);
  const run = (fn: () => Promise<CoachActionResult>) =>
    start(async () => {
      setResult(await fn());
    });
  const toggle = (p: "upload" | "settings") => setPanel((cur) => (cur === p ? null : p));

  const flashLines = (
    <>
      {flash.connected ? (
        <p role="status" className={cc.ok}>
          Google connected as {flash.connected}.
        </p>
      ) : null}
      {flash.error ? (
        <p role="alert" className={cc.error}>
          Google wasn&apos;t connected: {flash.error}
        </p>
      ) : null}
    </>
  );

  const uploadPanel =
    panel === "upload" ? (
      <div className={t.panelBox}>
        <h3 className={cc.h3}>Upload a call</h3>
        <p className={t.caption}>Choose the company the call was with, then the transcript.</p>
        <UploadTranscriptForm today={today} kind="coaching" companies={companies} />
      </div>
    ) : null;

  if (!data.folder) {
    return (
      <section className={styles.card} aria-labelledby="hq-recordings">
        <div className={t.headRow}>
          <h2 id="hq-recordings" className={styles.h2}>
            Your call recordings
          </h2>
          <button
            type="button"
            className={`${ui.btn} ${ui.btnSecondary}`}
            aria-expanded={panel === "upload"}
            onClick={() => toggle("upload")}
          >
            Upload a call
          </button>
        </div>
        <p className={cc.text}>Set up your call recordings here, once, for every company you coach.</p>
        {flashLines}
        {data.connectionError ? <p className={cc.error}>{data.connectionError}</p> : null}
        <FolderControls account={data.account} folder={null} />
        {uploadPanel}
        <div className={cc.how}>
          <h3 className={cc.h3}>How AiMS-HQ knows which company a call is with</h3>
          <p className={t.caption}>AiMS-HQ checks each new call in this order:</p>
          <ol className={cc.steps}>
            <li>
              <strong>The file name.</strong> If it includes a company&apos;s name, the call goes to that company. You can
              add other names a company goes by on its Connections tab.
            </li>
            <li>
              <strong>The people on the call.</strong> If someone on it works at one of your companies, the call goes
              there.
            </li>
            <li>
              <strong>You pick.</strong> If neither one settles it, or the call could belong to two companies, it waits
              under Waiting to be analysed for you to choose.
            </li>
          </ol>
          <p className={t.caption}>Calls only ever go to companies you coach.</p>
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.card} ${t.slim}`} aria-label="Your call recordings">
      <div className={t.slimRow}>
        <div className={t.slimText}>
          <span className={data.folder.lastError ? t.dotError : t.dotOk} aria-hidden="true" />
          <span>
            <strong className={t.strong}>Recordings:</strong> Google folder &ldquo;{data.folder.name}&rdquo; ·{" "}
            <span suppressHydrationWarning>{checkedAgo(data.folder.lastCheckedAt)}</span>
          </span>
        </div>
        <div className={cc.actions}>
          <button
            type="button"
            className={`${ui.btn} ${ui.btnSecondary}`}
            disabled={pending}
            onClick={() => run(checkCoachFolderNowAction)}
          >
            {pending ? "Checking..." : "Check now"}
          </button>
          <button
            type="button"
            className={`${ui.btn} ${ui.btnSecondary}`}
            aria-expanded={panel === "upload"}
            onClick={() => toggle("upload")}
          >
            Upload a call
          </button>
          <button
            type="button"
            className={`${ui.btn} ${ui.btnGhost}`}
            aria-expanded={panel === "settings"}
            onClick={() => toggle("settings")}
          >
            Settings
          </button>
        </div>
      </div>
      {flashLines}
      {data.folder.lastError ? <p className={cc.error}>{data.folder.lastError}</p> : null}
      {result ? (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? cc.ok : cc.error}>
          {result.ok ? result.message ?? "Done." : result.message}
        </p>
      ) : null}
      {uploadPanel}
      {panel === "settings" ? (
        <div className={t.panelBox}>
          <p className={cc.text}>
            <span>
              <strong>Google</strong> connected as {data.account ?? "an account that needs reconnecting"}.
            </span>
            <span className={cc.meta}>
              {data.folder.callsFound} call{data.folder.callsFound === 1 ? "" : "s"} found in this folder so far.
            </span>
          </p>
          <div className={cc.actions}>
            <button
              type="button"
              className={`${ui.btn} ${ui.btnSecondary}`}
              disabled={pending}
              onClick={() => run(removeCoachFolderAction)}
            >
              Change folder
            </button>
          </div>
          <p className={t.caption}>
            Change folder lets you choose another one. Calls already filed stay where they are. To disconnect Google, change folder first.
          </p>
        </div>
      ) : null}
    </section>
  );
}
