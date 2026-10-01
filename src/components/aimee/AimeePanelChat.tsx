"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChatView } from "@/app/(app)/coach/[profileId]/[conversationId]/ChatView";
import {
  newPanelChatAction,
  openPanelChatAction,
  recordPanelEventAction,
  type PanelChat,
} from "@/lib/aimee/panel-actions";
import { panelGreeting, suggestionsFor } from "@/lib/aimee/suggestions";
import styles from "./AimeeLauncher.module.css";

// THE CONVERSATION IN AIMEE'S PANEL (Step 3).
//
// Loaded the first time the panel opens, not with the page: the page
// underneath is somebody else's, and most page loads never open the
// panel. After that it stays mounted with the panel (keepMounted), so
// closing and reopening, or moving to another page, keeps the thread
// and any reply still arriving.
//
// It reopens the person's last conversation started in the panel
// (lib/aimee/panel-actions.ts), and "New conversation" starts another.
// A conversation started here never writes coach memory; when one
// turns into coaching, Aimee offers a link to a new conversation on
// the Aimee page, which is counted here when clicked.

const CONTINUE_ON_PAGE = "/ask-aimee/new";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; chat: PanelChat };

export function AimeePanelChat({
  active,
  composerRef,
  focusOnLoad = false,
}: {
  active: boolean;
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;
  // Move focus into the message box once the conversation has loaded
  // (the first open, when there was nothing to focus yet). Not on a
  // phone, where it would throw up the keyboard.
  focusOnLoad?: boolean;
}) {
  const pathname = usePathname() ?? "/";
  const [state, setState] = useState<State>({ kind: "idle" });
  // Whether the conversation on screen has anything from the person yet.
  const [hasTurns, setHasTurns] = useState(false);
  const [starting, setStarting] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (!active || loaded.current) return;
    loaded.current = true;
    setState({ kind: "loading" });
    openPanelChatAction()
      .then((r) => setState(r.ok ? { kind: "ready", chat: r.chat } : { kind: "error", message: r.message }))
      .catch(() => {
        loaded.current = false;
        setState({ kind: "error", message: "Aimee could not be reached. Close the panel and try again." });
      });
  }, [active]);

  const ready = state.kind === "ready";
  useEffect(() => {
    if (ready && active && focusOnLoad) composerRef?.current?.focus();
  }, [ready, active, focusOnLoad, composerRef]);

  const startNew = useCallback(() => {
    setStarting(true);
    // Off the screen at once: typing into the conversation that is about
    // to be replaced would lose what was typed, and its reply with it.
    setState({ kind: "loading" });
    newPanelChatAction()
      .then((r) => {
        if (r.ok) setState({ kind: "ready", chat: r.chat });
        else setState({ kind: "error", message: r.message });
      })
      .catch(() => setState({ kind: "error", message: "A new conversation could not be started. Try again." }))
      .finally(() => setStarting(false));
  }, []);

  // "Continue on the Aimee page" carries this conversation over, so the
  // new one opens with a summary of what was said here.
  const conversationId = state.kind === "ready" ? state.chat.conversation.id : null;
  const linkHref = useCallback(
    (href: string) =>
      conversationId && href.split(/[?#]/)[0] === CONTINUE_ON_PAGE
        ? `${CONTINUE_ON_PAGE}?continue=${conversationId}`
        : href,
    [conversationId]
  );

  const onInAppLink = useCallback((href: string) => {
    if (href.split(/[?#]/)[0] === CONTINUE_ON_PAGE) void recordPanelEventAction("continue_on_page").catch(() => {});
  }, []);

  return (
    <section className={styles.chat} aria-label="Conversation with Aimee">
      {/* "New conversation" only once something has been said: while
          the conversation is empty it is already a new one (Jason,
          2026-09-29). */}
      {hasTurns ? (
        <div className={styles.chatBar}>
          <button
            type="button"
            className={styles.newButton}
            onClick={startNew}
            disabled={starting || state.kind === "loading"}
          >
            New conversation
          </button>
        </div>
      ) : null}
      {state.kind === "ready" ? (
        <ChatView
          // A new conversation is a new component: ChatView holds its
          // thread in state and only reads initialMessages once.
          key={state.chat.conversation.id}
          variant="panel"
          conversation={state.chat.conversation}
          initialMessages={state.chat.messages}
          openablePatterns={state.chat.openablePatterns}
          currentUserId={state.chat.currentUserId}
          senders={state.chat.senders}
          access="owner"
          subjectName={null}
          subjectPosition={null}
          firstName={null}
          onInAppLink={onInAppLink}
          linkHref={linkHref}
          panelGreeting={panelGreeting(state.chat.firstName)}
          panelSuggestions={suggestionsFor(pathname, state.chat.role)}
          composerRef={composerRef}
          onHasUserTurns={setHasTurns}
        />
      ) : state.kind === "error" ? (
        <p className={styles.chatNote} role="status">
          {state.message}
        </p>
      ) : (
        <p className={styles.chatNote} role="status">
          Loading…
        </p>
      )}
    </section>
  );
}
