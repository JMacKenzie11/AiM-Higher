"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChatView } from "@/app/(app)/coach/[profileId]/[conversationId]/ChatView";
import {
  newPanelChatAction,
  openAimeeNotificationAction,
  openPanelChatAction,
  recordPanelEventAction,
  type PanelChat,
  type PanelOpenResult,
} from "@/lib/aimee/panel-actions";
import { dismissGuideNudgeAction } from "@/lib/guide/actions";
import type { NotificationItem } from "@/lib/notifications/service";
import { forYouLabel } from "@/lib/notifications/kinds";
import { useReadOpenRecord } from "./OpenRecord";
import { panelGreeting, suggestionsFor } from "@/lib/aimee/suggestions";
import styles from "./AimeeLauncher.module.css";

// THE CONVERSATION IN AIMEE'S PANEL (Steps 3 and 5).
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
//
// "For you" (Step 5): Aimee's invitations to debrief a meeting, and
// chats someone shared, which used to sit in the bell. Opening one
// shows it here in place of the panel conversation; "Not now" on an
// invitation records the decline exactly as the bell did.

const CONTINUE_ON_PAGE = "/ask-aimee/new";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string; href?: string }
  | { kind: "ready"; chat: PanelChat };

export function AimeePanelChat({
  active,
  notifications,
  composerRef,
  focusOnLoad = false,
}: {
  active: boolean;
  notifications: NotificationItem[];
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;
  // Move focus into the message box once the conversation has loaded
  // (the first open, when there was nothing to focus yet). Not on a
  // phone, where it would throw up the keyboard.
  focusOnLoad?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  // Whether the conversation on screen has anything from the person yet.
  const [hasTurns, setHasTurns] = useState(false);
  const loaded = useRef(false);

  // What the panel is beside, read when a message is sent: the path,
  // and a record a drawer has open. Pattern and id only (Step 4).
  const pathname = usePathname() ?? "/";
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const readOpenRecord = useReadOpenRecord();
  const pageContext = useCallback(
    () => ({ path: pathRef.current, record: readOpenRecord() }),
    [readOpenRecord]
  );

  const show = useCallback((result: PanelOpenResult) => {
    if (result.ok) setState({ kind: "ready", chat: result.chat });
    else setState({ kind: "error", message: result.message, href: "href" in result ? result.href : undefined });
  }, []);

  const run = useCallback(
    (load: () => Promise<PanelOpenResult>, failure: string, after?: () => void) => {
      setBusy(true);
      // Off the screen at once: typing into the conversation that is
      // about to be replaced would lose what was typed, and its reply.
      setState({ kind: "loading" });
      load()
        .then((r) => {
          show(r);
          after?.();
        })
        .catch(() => setState({ kind: "error", message: failure }))
        .finally(() => setBusy(false));
    },
    [show]
  );

  useEffect(() => {
    if (!active || loaded.current) return;
    loaded.current = true;
    setState({ kind: "loading" });
    openPanelChatAction()
      .then(show)
      .catch(() => {
        loaded.current = false;
        setState({ kind: "error", message: "Aimee could not be reached. Close the panel and try again." });
      });
  }, [active, show]);

  const ready = state.kind === "ready";
  useEffect(() => {
    if (ready && active && focusOnLoad) composerRef?.current?.focus();
  }, [ready, active, focusOnLoad, composerRef]);

  const startNew = () => run(newPanelChatAction, "A new conversation could not be started. Try again.");
  const backToPanel = () => run(openPanelChatAction, "Your conversation could not be opened. Try again.");
  // Opening an item. On success the conversation shows and the
  // layout's notifications refresh, so the item leaves "For you" and
  // the badge counts down. When it can't be opened, the reason goes ON
  // THE ITEM and the conversation that was on screen comes back
  // (2026-09-29): an error in place of the chat lost what was there.
  const [itemErrors, setItemErrors] = useState<Record<string, { message: string; href?: string }>>({});
  const openNotification = (id: string) => {
    const previous = state;
    setBusy(true);
    setItemErrors(({ [id]: _cleared, ...rest }) => rest);
    setState({ kind: "loading" });
    openAimeeNotificationAction(id)
      .then((r) => {
        if (r.ok) {
          setState({ kind: "ready", chat: r.chat });
          router.refresh();
        } else {
          setState(previous);
          setItemErrors((e) => ({ ...e, [id]: { message: r.message, href: "href" in r ? r.href : undefined } }));
        }
      })
      .catch(() => {
        setState(previous);
        setItemErrors((e) => ({ ...e, [id]: { message: "That could not be opened. Try again." } }));
      })
      .finally(() => setBusy(false));
  };

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

  const chat = state.kind === "ready" ? state.chat : null;
  const isPanelConversation = chat?.conversation.origin === "panel";

  return (
    <section className={styles.chat} aria-label="Conversation with Aimee">
      {notifications.length > 0 ? (
        <section className={styles.forYou} aria-labelledby="aimee-for-you">
          <h3 id="aimee-for-you" className={styles.forYouHeading}>
            For you
          </h3>
          <ul className={styles.forYouList}>
            {notifications.map((n) => (
              <li key={n.id} className={styles.forYouItem}>
                {forYouLabel(n) ? <span className={styles.forYouEyebrow}>{forYouLabel(n)}</span> : null}
                <span className={styles.forYouTitle}>{n.title}</span>
                {itemErrors[n.id] ? (
                  <span className={styles.forYouError} role="status">
                    {itemErrors[n.id].message}
                    {itemErrors[n.id].href ? (
                      <>
                        {" "}
                        <Link href={itemErrors[n.id].href!}>Open it</Link>
                      </>
                    ) : null}
                  </span>
                ) : null}
                <span className={styles.forYouActions}>
                  <button type="button" className={styles.forYouOpen} disabled={busy} onClick={() => openNotification(n.id)}>
                    {n.kind === "guide-nudge" ? "Talk it through" : "Open the chat"}
                  </button>
                  {n.kind === "guide-nudge" ? <NotNow id={n.id} /> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* The bar: a debrief's or shared chat's label and the way back,
          and "New conversation" once something has been said. While the
          panel's own conversation is empty it is already a new one, so
          there is nothing to show (Jason, 2026-09-29). */}
      {(chat && !isPanelConversation) || hasTurns ? (
      <div className={styles.chatBar}>
        {chat && !isPanelConversation ? (
          <span className={styles.chatBarLabel}>
            {chat.practice ? chat.practice.title : chat.access === "owner" ? chat.conversation.title : "Shared with you"}
            {" · "}
            <Link href={`/ask-aimee/${chat.conversation.id}`}>Open on the Aimee page</Link>
          </span>
        ) : (
          <span />
        )}
        <span className={styles.chatBarActions}>
          {chat && !isPanelConversation ? (
            <button type="button" className={styles.newButton} onClick={backToPanel} disabled={busy}>
              Your conversation
            </button>
          ) : null}
          <button type="button" className={styles.newButton} onClick={startNew} disabled={busy || state.kind === "loading"}>
            New conversation
          </button>
        </span>
      </div>
      ) : null}

      {chat ? (
        <ChatView
          // A different conversation is a new component: ChatView holds
          // its thread in state and only reads initialMessages once.
          key={chat.conversation.id}
          variant="panel"
          conversation={chat.conversation}
          initialMessages={chat.messages}
          openablePatterns={chat.openablePatterns}
          currentUserId={chat.currentUserId}
          senders={chat.senders}
          access={chat.access}
          practice={chat.practice}
          subjectName={null}
          subjectPosition={null}
          firstName={null}
          onInAppLink={onInAppLink}
          // Page context, and carrying the conversation over to the
          // Aimee page, are for the panel's own conversations only.
          pageContext={isPanelConversation ? pageContext : undefined}
          linkHref={isPanelConversation ? linkHref : undefined}
          panelGreeting={panelGreeting(chat.firstName)}
          panelSuggestions={suggestionsFor(pathname, chat.role)}
          composerRef={composerRef}
          onHasUserTurns={setHasTurns}
        />
      ) : state.kind === "error" ? (
        <p className={styles.chatNote} role="status">
          {state.message}
          {state.href ? (
            <>
              {" "}
              <Link href={state.href}>Open it</Link>
            </>
          ) : null}
        </p>
      ) : (
        <p className={styles.chatNote} role="status">
          Loading…
        </p>
      )}
    </section>
  );
}

// "Not now" on an invitation: the same action as the bell's, which
// records that the champion declined (guide_nudges) as well as putting
// the notification away. Disabled while in flight; the item leaves when
// the layout revalidates.
function NotNow({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={styles.forYouNotNow}
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await dismissGuideNudgeAction(id);
        });
      }}
    >
      {pending ? "Putting it away…" : "Not now"}
    </button>
  );
}
