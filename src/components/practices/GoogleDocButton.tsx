"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
// to Google's sign-in and comes back here with gdoc_connected=1 and
// gdoc=<message>, and the save finishes on its own. After that, one
// press saves (or updates) the doc and opens it in a new tab. The tab
// is opened on the click, before the save, because a browser blocks
// one opened later; it is closed again if the save does not land.
//
// Hidden entirely when the site has no Google Docs app set up.

export function GoogleDocButton({ conversationId, messageId }: { conversationId: string; messageId: string }) {
  const [state, setState] = useState<GoogleDocsCardState | null>(null);
  const [link, setLink] = useState<{ url: string; updated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const resumed = useRef(false);

  useEffect(() => {
    let live = true;
    getGoogleDocsCardStateAction(conversationId)
      .then((s) => live && setState(s))
      .catch(() => live && setState({ enabled: false }));
    return () => {
      live = false;
    };
  }, [conversationId]);

  const run = (tab: Window | null) => {
    setError(null);
    startTransition(async () => {
      const r = await saveVisionToGoogleDocAction({ conversationId, messageId });
      if (r.ok) {
        setLink({ url: r.url, updated: r.updated });
        setState((s) => (s && s.enabled ? { ...s, connected: true, hasDoc: true } : s));
        if (tab) tab.location.href = r.url;
        return;
      }
      tab?.close();
      if ("connect" in r) {
        const back = `${window.location.pathname}${window.location.search ? `${window.location.search}&` : "?"}gdoc=${encodeURIComponent(messageId)}`;
        window.location.href = `/api/oauth/google-docs/start?return=${encodeURIComponent(back)}`;
        return;
      }
      setError(r.message);
    });
  };

  // Back from Google's sign-in: finish the save for this card only,
  // once, and take the markers off the address.
  useEffect(() => {
    if (resumed.current || !state?.enabled) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("gdoc") !== messageId) return;
    resumed.current = true;
    const connected = params.get("gdoc_connected") === "1";
    const failed = params.get("gdoc_error");
    for (const k of ["gdoc", "gdoc_connected", "gdoc_error"]) params.delete(k);
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    if (connected) run(null);
    else if (failed) setError(failed === "access_denied" ? "Google wasn't connected, so nothing was saved." : "Google didn't connect this time. Try again.");
    // run is stable enough for a one-shot resume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, messageId]);

  if (!state?.enabled) return null;

  const disconnect = () => {
    startTransition(async () => {
      await disconnectGoogleDocsAction();
      setState((s) => (s && s.enabled ? { ...s, connected: false, connectedAs: null } : s));
      setLink(null);
    });
  };

  return (
    <>
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={pending}
        data-testid="vivid-vision-google-doc"
        onClick={() => run(state.connected ? window.open("about:blank", "_blank") : null)}
      >
        {pending ? "Saving to Google Docs…" : state.hasDoc ? "Update Google Doc" : "Save to Google Docs"}
      </button>
      {link || error || state.connected ? (
        <p className={styles.gdocStatus} role="status">
          {link ? (
            <>
              {link.updated ? "Your Google Doc is updated. " : "Saved to Google Docs. "}
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                Open it
              </a>
              {state.connected ? " · " : null}
            </>
          ) : null}
          {error ? <span role="alert">{error} </span> : null}
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
