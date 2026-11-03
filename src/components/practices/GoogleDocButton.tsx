"use client";

import { useEffect, useState, useTransition } from "react";
import {
  disconnectGoogleDocsAction,
  getGoogleDocsCardStateAction,
  saveVisionToGoogleDocAction,
  type GoogleDocsCardState,
} from "@/lib/google-docs/actions";
import styles from "./VividVisionCard.module.css";

// Save to Google Docs on the Vivid Vision card (0318).
//
// First press: the person has no Google connection, so the page goes
// to Google's sign-in, naming this vision. The callback saves it on
// the server and sends them back with gdoc=<message>&gdoc_saved=1, and
// the card shows the doc's link (it reads the link from the database,
// so it is there on every later visit too). After that, one press
// saves or updates the doc and opens it in a new tab: the tab is
// opened on the click, before the save, because a browser blocks one
// opened later, and closed again if the save does not land.
//
// Hidden entirely when the site has no Google Docs app set up.

type Enabled = Extract<GoogleDocsCardState, { enabled: true }>;

export function GoogleDocButton({ conversationId, messageId }: { conversationId: string; messageId: string }) {
  const [state, setState] = useState<GoogleDocsCardState | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    getGoogleDocsCardStateAction(conversationId)
      .then((s) => live && setState(s))
      .catch(() => live && setState({ enabled: false }));
    return () => {
      live = false;
    };
  }, [conversationId]);

  // Back from Google's sign-in: say how it went, for this card only,
  // and take the markers off the address. The save itself already
  // happened on the server.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("gdoc") !== messageId) return;
    const saved = params.get("gdoc_saved") === "1";
    const failed = params.get("gdoc_error");
    for (const k of ["gdoc", "gdoc_saved", "gdoc_error", "gdoc_connected"]) params.delete(k);
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    if (saved) setNote("Saved to Google Docs.");
    else if (failed) setError(failed === "access_denied" ? "Google wasn't connected, so nothing was saved." : "That didn't save to Google Docs. Try the button again.");
  }, [messageId]);

  if (!state?.enabled) return null;

  const update = (patch: Partial<Enabled>) => setState((s) => (s && s.enabled ? { ...s, ...patch } : s));

  const press = () => {
    setError(null);
    setNote(null);
    if (!state.connected) {
      connect();
      return;
    }
    const tab = window.open("about:blank", "_blank");
    startTransition(async () => {
      const r = await saveVisionToGoogleDocAction({ conversationId, messageId });
      if (r.ok) {
        update({ hasDoc: true, docUrl: r.url });
        setNote(r.updated ? "Your Google Doc is updated." : "Saved to Google Docs.");
        if (tab) tab.location.href = r.url;
        return;
      }
      tab?.close();
      if ("connect" in r) connect();
      else setError(r.message);
    });
  };

  function connect() {
    const q = new URLSearchParams({
      conversation: conversationId,
      message: messageId,
      return: `${window.location.pathname}${window.location.search}`,
    });
    window.location.href = `/api/oauth/google-docs/start?${q.toString()}`;
  }

  const disconnect = () => {
    startTransition(async () => {
      await disconnectGoogleDocsAction();
      update({ connected: false, connectedAs: null });
      setNote(null);
    });
  };

  return (
    <>
      <button type="button" className={styles.secondaryButton} disabled={pending} data-testid="vivid-vision-google-doc" onClick={press}>
        {pending ? "Saving to Google Docs…" : state.hasDoc ? "Update Google Doc" : "Save to Google Docs"}
      </button>
      {state.docUrl || note || error || state.connected ? (
        <p className={styles.gdocStatus} role="status">
          {note ? <strong>{note} </strong> : null}
          {error ? <span role="alert">{error} </span> : null}
          {state.docUrl ? (
            <a href={state.docUrl} target="_blank" rel="noopener noreferrer" data-testid="vivid-vision-google-doc-link">
              Open your Google Doc
            </a>
          ) : null}
          {state.docUrl && state.connected ? " · " : null}
          {state.connected ? (
            <>
              {state.connectedAs ? `Google: ${state.connectedAs}. ` : null}
              <button type="button" className={styles.linkButton} onClick={disconnect} disabled={pending}>
                Disconnect
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </>
  );
}
