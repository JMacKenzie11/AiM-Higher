"use client";

import { useId, useState, useTransition } from "react";
import {
  checkCoachFolderNowAction,
  connectCoachFolderAction,
  disconnectCoachGoogleAction,
  fileCoachingCallAction,
  moveCoachingCallAction,
  removeCoachFolderAction,
  setAsideCoachingCallAction,
  type CoachActionResult,
} from "@/lib/coaching-calls/actions";
import ui from "@/components/ui/ui.module.css";
import cc from "./coaching-calls.module.css";

// The buttons on Coach HQ's coaching calls cards (0326). Each action
// checks the coach again and writes through their own client; these
// only send the form and say what happened.

function useAction() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<CoachActionResult | null>(null);
  const run = (fn: () => Promise<CoachActionResult>) =>
    start(async () => {
      setResult(await fn());
    });
  const message = result ? (
    <p role={result.ok ? "status" : "alert"} className={result.ok ? cc.ok : cc.error}>
      {result.ok ? result.message ?? "Done." : result.message}
    </p>
  ) : null;
  return { pending, run, message };
}

export function FolderControls({
  account,
  folder,
}: {
  account: string | null;
  folder: { name: string; status: string; lastCheckedAt: string | null; lastError: string | null; callsFound: number } | null;
}) {
  const { pending, run, message } = useAction();
  const [url, setUrl] = useState("");
  const inputId = useId();

  if (!account) {
    return (
      <>
        <p className={cc.text}>
          Connect the Google account your calls are recorded on. AiMS reads the one folder you choose, and nothing else.
        </p>
        <div className={cc.actions}>
          <a href="/api/oauth/google/start?for=coach" className={`${ui.btn} ${ui.btnPrimary}`}>
            Connect Google
          </a>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={cc.text}>
        <div>
          <strong>Google</strong> connected as {account}
        </div>
        {folder ? (
          <>
            <div>
              Folder: <strong>{folder.name}</strong>
            </div>
            <div className={cc.meta}>
              {folder.lastCheckedAt
                ? `Checked ${new Date(folder.lastCheckedAt).toLocaleString()}`
                : "Not checked yet"}
              {` · ${folder.callsFound} call${folder.callsFound === 1 ? "" : "s"} found`}
            </div>
            {folder.lastError ? <div className={cc.error}>{folder.lastError}</div> : null}
          </>
        ) : null}
      </div>

      {folder ? (
        <div className={cc.actions}>
          <button type="button" className={`${ui.btn} ${ui.btnSecondary}`} disabled={pending} onClick={() => run(checkCoachFolderNowAction)}>
            {pending ? "Checking..." : "Check now"}
          </button>
          <button type="button" className={`${ui.btn} ${ui.btnSecondary}`} disabled={pending} onClick={() => run(removeCoachFolderAction)}>
            Change folder
          </button>
        </div>
      ) : (
        <form
          className={cc.folderForm}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData();
            fd.set("folder_url", url);
            run(() => connectCoachFolderAction(fd));
          }}
        >
          <label htmlFor={inputId} className={ui.label}>
            The folder your calls are saved in
          </label>
          <input
            id={inputId}
            className={ui.input}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/..."
            required
          />
          <div className={cc.actions}>
            <button type="submit" className={`${ui.btn} ${ui.btnPrimary}`} disabled={pending}>
              {pending ? "Connecting..." : "Use this folder"}
            </button>
            <button type="button" className={`${ui.btn} ${ui.btnGhost}`} disabled={pending} onClick={() => run(disconnectCoachGoogleAction)}>
              Disconnect Google
            </button>
          </div>
        </form>
      )}
      {message}
    </>
  );
}

const NOT_A_CALL = "not-a-call";

export function SortCall({
  meetingId,
  companies,
  suggestedAlias,
}: {
  meetingId: string;
  companies: ReadonlyArray<{ id: string; name: string }>;
  suggestedAlias: string | null;
}) {
  const { pending, run, message } = useAction();
  const [choice, setChoice] = useState("");
  const [addAlias, setAddAlias] = useState(true);
  const selectId = useId();

  return (
    <form
      className={cc.sortForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (choice === NOT_A_CALL) {
          run(() => setAsideCoachingCallAction(meetingId));
          return;
        }
        const fd = new FormData();
        fd.set("meeting_id", meetingId);
        fd.set("company_id", choice);
        if (addAlias && suggestedAlias) {
          fd.set("add_alias", "on");
          fd.set("alias", suggestedAlias);
        }
        run(() => fileCoachingCallAction(fd));
      }}
    >
      <div className={cc.sortRow}>
        <div className={cc.sortField}>
          <label htmlFor={selectId} className={ui.label}>
            Company
          </label>
          <select id={selectId} className={ui.select} value={choice} onChange={(e) => setChoice(e.target.value)} required>
            <option value="">Choose a company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NOT_A_CALL}>Not a coaching call</option>
          </select>
        </div>
        <button type="submit" className={`${ui.btn} ${ui.btnPrimary}`} disabled={pending || !choice}>
          {pending ? "Filing..." : choice === NOT_A_CALL ? "Set aside" : "File it"}
        </button>
      </div>
      {suggestedAlias && choice !== NOT_A_CALL ? (
        <label className={cc.check}>
          <input type="checkbox" checked={addAlias} onChange={(e) => setAddAlias(e.target.checked)} />
          Send future calls named &ldquo;{suggestedAlias}&rdquo; here too
        </label>
      ) : null}
      {message}
    </form>
  );
}

export function MoveCall({
  meetingId,
  currentCompanyId,
  companies,
}: {
  meetingId: string;
  currentCompanyId: string;
  companies: ReadonlyArray<{ id: string; name: string }>;
}) {
  const { pending, run, message } = useAction();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const others = companies.filter((c) => c.id !== currentCompanyId);
  if (others.length === 0) return null;
  if (!open) {
    return (
      <button type="button" className={`${ui.btn} ${ui.btnGhost} ${ui.btnSm}`} onClick={() => setOpen(true)}>
        Move
      </button>
    );
  }
  return (
    <form
      className={cc.moveForm}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.set("meeting_id", meetingId);
        fd.set("company_id", to);
        run(() => moveCoachingCallAction(fd));
      }}
    >
      <select aria-label="Move to" className={ui.select} value={to} onChange={(e) => setTo(e.target.value)} required>
        <option value="">Move to...</option>
        {others.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button type="submit" className={`${ui.btn} ${ui.btnSecondary} ${ui.btnSm}`} disabled={pending || !to}>
        {pending ? "Moving..." : "Move"}
      </button>
      {message}
    </form>
  );
}
