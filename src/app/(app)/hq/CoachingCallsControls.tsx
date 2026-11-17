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

  const connectFolder = (folder: string) => {
    const fd = new FormData();
    fd.set("folder_url", folder);
    run(() => connectCoachFolderAction(fd));
  };

  const pasteForm = (
    <form
      className={cc.folderForm}
      onSubmit={(e) => {
        e.preventDefault();
        connectFolder(url);
      }}
    >
      <label htmlFor={inputId} className={cc.label}>
        The folder your calls are saved in
      </label>
      <input
        id={inputId}
        className={cc.input}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://drive.google.com/drive/folders/..."
        required
      />
      <p className={cc.meta}>Open the folder in Google Drive and copy the address from your browser.</p>
      <div className={cc.actions}>
        <button type="submit" className={`${ui.btn} ${ui.btnPrimary}`} disabled={pending}>
          {pending ? "Connecting..." : "Use this folder"}
        </button>
      </div>
    </form>
  );

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
        <div className={cc.folderForm}>
          {pasteForm}
          <div className={cc.actions}>
            <button type="button" className={`${ui.btn} ${ui.btnGhost}`} disabled={pending} onClick={() => run(disconnectCoachGoogleAction)}>
              Disconnect Google
            </button>
          </div>
        </div>
      )}
      {message}
    </>
  );
}

// One call waiting to be analysed: choose the company (AiMS's best
// guess already chosen when there is one) and Analyse, or Not a
// coaching call. Analyse files it through fileCoachingCallAction, which
// also adds the file name's first naming word as one of the company's
// names when the box is ticked (it is, by default). On success the
// parent shows a confirmation line in place of the row.
export function AnalyseCall({
  meetingId,
  title,
  companies,
  suggestedAlias,
  preselect,
  onDone,
}: {
  meetingId: string;
  title: string;
  companies: ReadonlyArray<{ id: string; name: string; group?: "likely" | "other" }>;
  suggestedAlias: string | null;
  preselect: string | null;
  onDone: (line: string) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState(preselect ?? "");
  // The name to remember for next time: AiMS-HQ's guess, which the coach
  // can change or clear (Jason, 2026-11-17: the guess can be the wrong
  // word, such as the coach's own name).
  const [addAlias, setAddAlias] = useState(Boolean(suggestedAlias));
  const [alias, setAlias] = useState(suggestedAlias ?? "");
  const selectId = useId();
  const aliasId = useId();
  const likely = companies.filter((c) => c.group === "likely");
  const others = companies.filter((c) => c.group !== "likely");
  const nameOf = (id: string) => companies.find((c) => c.id === id)?.name ?? "that company";

  const analyse = () =>
    start(async () => {
      setError(null);
      const fd = new FormData();
      fd.set("meeting_id", meetingId);
      fd.set("company_id", choice);
      if (addAlias && alias.trim()) {
        fd.set("add_alias", "on");
        fd.set("alias", alias.trim());
      }
      const r = await fileCoachingCallAction(fd);
      if (!r.ok) return setError(r.message);
      const aliasNote =
        r.message && r.message.startsWith("Filed. ") ? ` ${r.message.slice("Filed. ".length)}` : "";
      onDone(`${title} is being analysed for ${nameOf(choice)}.${aliasNote}`);
    });

  const setAside = () =>
    start(async () => {
      setError(null);
      const r = await setAsideCoachingCallAction(meetingId);
      if (!r.ok) return setError(r.message);
      onDone(`${title} was set aside. Its words aren't kept.`);
    });

  return (
    <div className={cc.sortForm}>
      <div className={cc.sortRow}>
        <label htmlFor={selectId} className={cc.srOnly}>
          Company for {title}
        </label>
        <select id={selectId} className={cc.select} value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Choose a company</option>
          {likely.length > 0 && others.length > 0 ? (
            <>
              <optgroup label="On this call">
                {likely.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Your other companies">
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            </>
          ) : (
            companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))
          )}
        </select>
        <button type="button" className={`${ui.btn} ${ui.btnPrimary}`} disabled={pending || !choice} onClick={analyse}>
          {pending ? "Working..." : "Analyse"}
        </button>
        <button type="button" className={`${ui.btn} ${ui.btnGhost}`} disabled={pending} onClick={setAside}>
          Not a coaching call
        </button>
      </div>
      <div className={cc.aliasRow}>
        <label className={cc.check}>
          <input type="checkbox" checked={addAlias} onChange={(e) => setAddAlias(e.target.checked)} />
          Remember for next time: calls with this word in the file name go to the same company
        </label>
        <label htmlFor={aliasId} className={cc.srOnly}>
          Word to remember for {title}
        </label>
        <input
          id={aliasId}
          className={`${cc.input} ${cc.aliasInput}`}
          value={alias}
          maxLength={80}
          placeholder="A word in the file name, such as the company's name"
          disabled={!addAlias}
          onChange={(e) => setAlias(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className={cc.error}>
          {error}
        </p>
      ) : null}
    </div>
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
      <select aria-label="Move to" className={cc.select} value={to} onChange={(e) => setTo(e.target.value)} required>
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
