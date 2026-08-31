"use client";

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRouter } from "next/navigation";
import {
  generateConversationTitleAction,
  renameConversationAction,
} from "@/lib/coach/actions";
import type {
  CoachingConversation,
  ConversationAccess,
} from "@/lib/coach/service";
import type { OutputCardName, Practice } from "@/lib/practices/registry";
import { ScriptCard } from "@/components/practices/ScriptCard";
import { ChartProposalCard } from "@/components/practices/ChartProposalCard";
import styles from "../../coach.module.css";

// The chat UI. Handles streaming SSE from /api/coach, renders the
// thread, and gives the admin an inline retry when a stream fails.

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  // Author of the message. Only set for persisted rows and for the
  // local user bubble we optimistically insert on send. Assistant
  // rows are attributed to the streamer's session (the person who
  // triggered the turn); the display treats assistant bubbles
  // uniformly as "Coach", so we don't render their created_by.
  created_by?: string;
  streaming?: boolean;
  error?: string | null;
};

// Display info for someone whose messages appear in this thread.
// Populated on the server for every distinct created_by across the
// current message set + every share row, so any bubble can look up
// its author in one map without an extra fetch.
export type SenderInfo = {
  full_name: string;
  avatar_url: string | null;
};

const ABOUT_SUGGESTION_CHIPS = [
  "Prepare for a conversation",
  "Interpret their execution pattern",
  "Help me see what I'm missing",
];

// Ask Aimee starters — wording is fixed by product spec.
const GENERAL_SUGGESTION_CHIPS = [
  "I need help thinking through an issue",
  "I've thought this through and want your feedback",
  "Can you tell me what I'm missing?",
  "Show me how you would approach this",
];

export function ChatView({
  conversation,
  subjectName,
  subjectPosition,
  firstName,
  initialMessages,
  practice = null,
  access,
  currentUserId,
  senders,
  shareHeader,
}: {
  conversation: CoachingConversation;
  // Null in general (Ask Aimee) mode — no subject on file.
  subjectName: string | null;
  subjectPosition: string | null;
  firstName: string | null;
  initialMessages: UiMessage[];
  // Populated for practice conversations. When set, the empty-state
  // renders PracticeSetup (practice header + opening chips) instead
  // of the default chip row.
  practice?: Practice | null;
  // How the current caller can interact:
  //   'owner' — full control (rename, share, chat, auto-title)
  //   'write' — chat allowed; rename/share/auto-title suppressed
  //   'read'  — composer hidden; helper line offered instead
  access: ConversationAccess;
  // The caller's profile id. Used to decide whether a user bubble
  // should render as "you" vs. show a coworker's name + avatar.
  currentUserId: string;
  // Author id → display info for every distinct writer in this
  // thread (owner + sharees + anyone whose past messages appear in
  // the loaded history). Built server-side so the client renders
  // attribution without additional fetches.
  senders: Record<string, SenderInfo>;
  // Slot for the share button (owner) or the "Shared with N" badge
  // (non-owners). Passed in from the page so the client doesn't
  // need to import the share modal at this layer.
  shareHeader?: ReactNode;
}) {
  const isOwner = access === "owner";
  const canWrite = access === "owner" || access === "write";
  // Attribution shows once at least one sharee exists — with just
  // the owner in the thread, every user bubble is trivially "them",
  // and a name label reads as noise.
  const showAttribution = Object.keys(senders).length > 1;
  const isGeneral = conversation.mode === "general";
  const isPractice = practice !== null;
  const suggestions = isGeneral ? GENERAL_SUGGESTION_CHIPS : ABOUT_SUGGESTION_CHIPS;
  const emptyPrompt = isPractice
    ? "Share the situation below when you're ready."
    : isGeneral
      ? "What's on your mind?"
      : `What's on your mind about ${firstName ?? "them"}?`;
  const composerPlaceholder = isPractice
    ? // skipSetup practices open with a scripted opener that asks a
      // direct question ("Ready to get started?"). A "Describe the
      // situation" placeholder reads as a mismatch there — the
      // leader isn't describing a situation, they're answering. An
      // empty placeholder gives the composer no instructional load
      // and lets the opener stand as the only cue. Legacy practices
      // (skipSetup=false) still use the situation-describe copy.
      practice.skipSetup
      ? ""
      : "Describe the situation…"
    : isGeneral
      ? "Ask Aimee…"
      : "Message coach…";
  const headerSubject = isPractice
    ? `Practice · ${practice.title}`
    : isGeneral
      ? "Ask Aimee · AiMS Leadership Coach"
      : `${subjectName ?? ""}${subjectPosition ? ` · ${subjectPosition}` : ""}`;
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [lastUserAttempt, setLastUserAttempt] = useState<string | null>(null);
  const [title, setTitle] = useState(conversation.title);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conversation.title);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renamePending, startRename] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  // The first exchange is what triggers auto-titling. Track it so
  // subsequent completions don't refire the model call.
  const autoTitledRef = useRef(false);
  // Tracks the in-flight coach fetch so we can cancel it if the user
  // navigates away mid-stream. Without this, the SSE reader loop
  // keeps running on the client (leak) and the server keeps
  // generating tokens into a dead connection until the upstream
  // Anthropic stream times out.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Keep the bottom of the thread in view as the assistant streams,
  // but ONLY while the user is already near the bottom — a hard
  // auto-scroll on every token yanks the page away if they scrolled
  // up to read something earlier in the response.
  //
  // Behavior:
  //   1. On every messages update, if stickToBottomRef is true,
  //      schedule a single scroll via rAF (batches multiple
  //      rapid-fire streaming updates into one paint frame — no
  //      stutter).
  //   2. Track user scroll intent. If they scroll away from the
  //      bottom, flip the ref false. If they scroll back to
  //      within 80px of the bottom, flip it true.
  const stickToBottomRef = useRef(true);
  useEffect(() => {
    function onScroll() {
      const scrollTop = window.scrollY;
      const viewport = window.innerHeight;
      const total = document.documentElement.scrollHeight;
      const distanceFromBottom = total - (scrollTop + viewport);
      stickToBottomRef.current = distanceFromBottom < 80;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const id = requestAnimationFrame(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight });
    });
    return () => cancelAnimationFrame(id);
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string, opts: { retry?: boolean } = {}) => {
      const trimmed = text.trim();
      if ((!trimmed && !opts.retry) || sending) return;
      setSending(true);
      if (!opts.retry) setLastUserAttempt(trimmed);

      // Only place a fresh user bubble when this is a NEW send; on
      // retry the bubble is already there and the server's row already
      // exists — sending another would duplicate. Stamp created_by so
      // attribution shows the sender's name + avatar immediately (the
      // eventual DB row will match).
      if (!opts.retry) {
        setMessages((prev) => [
          ...prev,
          {
            id: `local-u-${Date.now()}`,
            role: "user",
            content: trimmed,
            created_by: currentUserId,
          },
        ]);
      }
      const assistantId = `local-a-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ]);

      // Abort any prior in-flight send (shouldn't happen — the button
      // is disabled while sending — but defensive) and start a fresh
      // controller for this fetch. The unmount effect above aborts it
      // too, which propagates through fetch → reader → server.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/coach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: conversation.id,
            userMessage: trimmed,
            retry: Boolean(opts.retry),
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(
            `Request failed (${response.status}): ${await response.text()}`
          );
        }

        await consumeSse(response.body, controller.signal, {
          onDelta: (chunk) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + chunk }
                  : m
              )
            );
          },
          onError: (message) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, streaming: false, error: message }
                  : m
              )
            );
          },
          onDone: () => {
            setMessages((prev) => {
              const next = prev.map((m) =>
                m.id === assistantId ? { ...m, streaming: false } : m
              );
              // Fire auto-title after the SECOND exchange completes
              // (four total messages). The first user turn is usually
              // a starter chip like "I need help thinking through an
              // issue", which produces a generic title — waiting one
              // more round gets the actual topic. Guard on the exact
              // count so this doesn't refire on later exchanges.
              // Only the owner triggers auto-title; the server action
              // rejects non-owners anyway, but skipping the call
              // avoids a wasted round-trip when a sharee sends the
              // fourth message.
              if (isOwner && !autoTitledRef.current && next.length === 4) {
                autoTitledRef.current = true;
                generateConversationTitleAction(conversation.id)
                  .then((result) => {
                    if (result.ok && result.title) {
                      setTitle(result.title);
                      setRenameValue(result.title);
                      router.refresh();
                    }
                  })
                  .catch((err) => {
                    // Non-fatal — the default title stays.
                    console.warn("auto-title failed", err);
                  });
              }
              return next;
            });
          },
        });
      } catch (error) {
        // Aborts are expected (unmount / re-send / user cancel) —
        // don't surface them as an error bubble the user has to
        // dismiss. Also skip the state update if the controller
        // already fired; the component is likely mid-unmount.
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        const msg =
          error instanceof Error ? error.message : "Something went wrong.";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, streaming: false, error: msg }
              : m
          )
        );
      } finally {
        if (!controller.signal.aborted) {
          setSending(false);
          if (!opts.retry) setInput("");
          textareaRef.current?.focus();
        }
      }
    },
    [conversation.id, sending, currentUserId, isOwner, router]
  );

  function retry() {
    if (!lastUserAttempt) return;
    // Strip the failed assistant slot; keep the user bubble in place.
    setMessages((prev) => prev.filter((m) => !m.error));
    void sendMessage(lastUserAttempt, { retry: true });
  }

  function submitRename() {
    const next = renameValue.trim();
    if (!next || next === title) {
      setRenaming(false);
      setRenameValue(title);
      return;
    }
    setRenameError(null);
    startRename(async () => {
      const result = await renameConversationAction(conversation.id, next);
      if (result.ok) {
        setTitle(next);
        setRenaming(false);
      } else {
        // Was a native alert() — jarring during a screen-shared coach
        // session because it blocks the whole window. Inline the error
        // just under the rename input instead.
        setRenameError(result.message);
      }
    });
  }

  const isEmpty = messages.length === 0;

  return (
    <div className={styles.chatWrap}>
      <div className={styles.chatHeader}>
        <div className={styles.chatHeaderMain}>
          <span className={styles.chatHeaderSubject}>{headerSubject}</span>
          {renaming && isOwner ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <input
                type="text"
                className={styles.chatHeaderTitleInput}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={submitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitRename();
                  if (e.key === "Escape") {
                    setRenaming(false);
                    setRenameValue(title);
                    setRenameError(null);
                  }
                }}
                disabled={renamePending}
                autoFocus
              />
              {renameError ? (
                <span
                  role="alert"
                  style={{
                    color: "var(--aims-danger)",
                    fontSize: 12,
                  }}
                >
                  {renameError}
                </span>
              ) : null}
            </div>
          ) : isOwner ? (
            <button
              type="button"
              className={styles.chatHeaderTitle}
              onClick={() => setRenaming(true)}
              title="Click to rename"
            >
              {title}
            </button>
          ) : (
            // Non-owners see the title as static text — the rename
            // affordance is owner-only. Static <span> keeps the same
            // visual weight as the button without inviting a click.
            <span className={styles.chatHeaderTitle}>{title}</span>
          )}
        </div>
        {shareHeader ? (
          <div className={styles.chatHeaderShare}>{shareHeader}</div>
        ) : null}
      </div>

      <div className={styles.thread}>
        {isEmpty ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyStatePrompt}>
              {isPractice ? practice.title : emptyPrompt}
            </p>
            <div className={styles.chipRow}>
              {(isPractice ? practice.chips ?? [] : suggestions).map(
                (chip) => (
                  <button
                    key={chip}
                    type="button"
                    className={styles.chip}
                    onClick={() => void sendMessage(chip)}
                    disabled={sending}
                  >
                    {chip}
                  </button>
                )
              )}
            </div>
            <p className={styles.chipHint}>
              Or type your own in the box below.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onRetry={m.error ? retry : undefined}
              practice={practice}
              conversationId={conversation.id}
              onFixProposal={() =>
                void sendMessage(
                  "Please re-emit the chart_proposal fenced block using the exact schema — top_seats and functions with responsibilities (LMA first), sub_functions only if we split anything."
                )
              }
              senders={senders}
              currentUserId={currentUserId}
              showAttribution={showAttribution}
            />
          ))
        )}
      </div>

      {!canWrite ? (
        // Read-only sharees see the composer replaced with a helper
        // line rather than a disabled textarea — a greyed-out box
        // invites clicking, then reads as broken. This is explicit
        // about who to ask.
        <div className={styles.readOnlyNotice} role="status">
          Read-only. Ask the owner for write access to reply.
        </div>
      ) : (
      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage(input);
        }}
      >
        {/* Wrapper drives auto-grow via the CSS grid mirror trick — a
            hidden ::after pseudo replicates the textarea's value and
            grows the grid track, and the textarea inherits that track
            size. Doing this in CSS avoids the per-keystroke JS layout
            thrash (setting height=auto then reading scrollHeight) that
            made the sticky composer stutter as the leader typed. */}
        <div className={styles.composerInputWrap} data-value={input}>
          <textarea
            ref={textareaRef}
            className={styles.composerInput}
            placeholder={composerPlaceholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage(input);
              }
            }}
            disabled={sending}
            rows={1}
          />
        </div>
        <button
          type="submit"
          className={styles.sendButton}
          disabled={sending || !input.trim()}
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  onRetry,
  practice,
  conversationId,
  onFixProposal,
  senders,
  currentUserId,
  showAttribution,
}: {
  message: UiMessage;
  onRetry?: () => void;
  practice?: Practice | null;
  conversationId: string;
  onFixProposal?: () => void;
  senders: Record<string, SenderInfo>;
  currentUserId: string;
  showAttribution: boolean;
}) {
  if (message.role === "user") {
    const author =
      message.created_by && message.created_by !== currentUserId
        ? senders[message.created_by] ?? null
        : null;
    // Only surface attribution when the thread is shared AND this
    // bubble is from someone other than the caller. Own bubbles stay
    // unlabeled — the right-aligned position already reads as "you".
    const showLabel = showAttribution && author !== null;
    return (
      <div className={`${styles.bubbleRow} ${styles.bubbleRowUser}`}>
        <div className={styles.bubbleUserGroup}>
          {showLabel ? (
            <div className={styles.bubbleAttribution}>
              {author.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={author.avatar_url}
                  alt=""
                  className={styles.bubbleAvatar}
                />
              ) : (
                <span className={styles.bubbleAvatarFallback} aria-hidden="true">
                  {initialsFor(author.full_name)}
                </span>
              )}
              <span className={styles.bubbleAuthor}>{author.full_name}</span>
            </div>
          ) : null}
          <div className={styles.bubbleUser}>{message.content}</div>
        </div>
      </div>
    );
  }
  // Between "send" and the first streamed token, `message.content`
  // is empty and only the blinking cursor rendered, which reads as
  // "did this break?" for first-time users. Show an explicit
  // "Thinking…" indicator until at least one token has arrived, at
  // which point the streaming content takes over.
  const isThinking = message.streaming && message.content.length === 0;
  const isStreaming = message.streaming === true;

  // Intercept fenced code blocks whose tag matches the current
  // practice's outputCard mapping and swap them for the matching
  // card component. Anything unmapped falls through to a plain <pre>.
  // Registry-driven so adding a new tag→card wiring is a registry
  // entry plus a component in CARD_RENDERERS below.
  const outputCard = practice?.outputCard;
  const markdownComponents: Components = {
    pre({ children }) {
      const only = Children.toArray(children)[0];
      if (isValidElement(only)) {
        const props = only.props as {
          className?: string;
          children?: ReactNode;
        };
        const cls = props.className ?? "";
        const langMatch = cls.match(/language-(\S+)/);
        const tag = langMatch?.[1];
        if (tag && outputCard && outputCard[tag]) {
          const raw = extractCodeText(props.children);
          return renderCard(
            outputCard[tag],
            raw,
            isStreaming,
            conversationId,
            onFixProposal
          );
        }
      }
      return <pre>{children}</pre>;
    },
  };

  return (
    <div className={`${styles.bubbleRow} ${styles.bubbleRowAssistant}`}>
      <div className={styles.bubbleAssistant}>
        {isThinking ? (
          <p className={styles.thinking} role="status" aria-live="polite">
            <span className={styles.thinkingDots} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            Thinking…
          </p>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {message.content}
          </ReactMarkdown>
        )}
        {message.streaming && !isThinking ? (
          <span className={styles.cursor} aria-hidden="true" />
        ) : null}
        {message.error ? (
          <>
            <p className={styles.errorNote}>
              Coach didn&rsquo;t respond: {message.error}
            </p>
            {onRetry ? (
              <button
                type="button"
                className={styles.retryButton}
                onClick={onRetry}
              >
                Try again
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

// Registry name → component dispatch. Keeps the JSON-friendly
// string identifiers in the registry mapped to concrete React
// components here, so client bundles never try to serialize a
// component reference.
function renderCard(
  name: OutputCardName,
  raw: string,
  streaming: boolean,
  conversationId: string,
  onFixProposal?: () => void
): ReactNode {
  switch (name) {
    case "ScriptCard":
      return <ScriptCard raw={raw} streaming={streaming} />;
    case "ChartProposalCard":
      return (
        <ChartProposalCard
          raw={raw}
          streaming={streaming}
          conversationId={conversationId}
          onFixRequest={onFixProposal}
        />
      );
  }
}

// Two-letter initials fallback for the attribution avatar when a
// sharee doesn't have an avatar_url set. Uses the first + last
// space-separated tokens of the display name; degrades gracefully
// for single-word names.
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

// Recursively flatten react-markdown's children of a <code> node
// back to a string. For a plain fenced block this is usually a
// single string, but nested inline children (say syntax highlighter
// spans) can appear — walk them defensively.
function extractCodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractCodeText).join("");
  }
  if (isValidElement(node)) {
    const kids = (node.props as { children?: ReactNode }).children;
    return extractCodeText(kids);
  }
  return "";
}

// Minimal SSE reader. Consumes `event: <name>` and `data: <json>` pairs.
// Honours an AbortSignal so an unmount / re-send cancels the underlying
// reader (previously the loop ran until EOF regardless — orphaning the
// stream on the client and letting the server keep generating tokens
// into a dead connection until its own timeout).
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  handlers: {
    onDelta: (chunk: string) => void;
    onError: (message: string) => void;
    onDone: () => void;
  }
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // If the signal fires (unmount or re-send), cancel the underlying
  // reader immediately — otherwise the awaiting reader.read() promise
  // sits there until the server closes on its own.
  const onAbort = () => {
    reader.cancel().catch(() => {
      // Reader already closed / cancelled — nothing to do.
    });
  };
  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    while (true) {
      if (signal.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        idx = buffer.indexOf("\n\n");

        let event = "message";
        const dataLines: string[] = [];
        for (const line of raw.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7).trim();
          else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
        }
        const dataStr = dataLines.join("\n");
        let parsed: unknown = dataStr;
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          // Fall back to raw string.
        }

        if (event === "delta" && parsed && typeof parsed === "object" && "text" in parsed) {
          const t = (parsed as { text?: unknown }).text;
          if (typeof t === "string") handlers.onDelta(t);
        } else if (event === "error") {
          const message =
            parsed && typeof parsed === "object" && "message" in parsed
              ? String((parsed as { message?: unknown }).message ?? "Error")
              : "Error";
          handlers.onError(message);
        } else if (event === "done") {
          handlers.onDone();
        }
      }
    }
  } catch (err) {
    // Reader.read() throws when the underlying stream is cancelled
    // mid-await — that's the expected path when signal fires. Only
    // rethrow if this wasn't an abort.
    if (!signal.aborted) throw err;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
