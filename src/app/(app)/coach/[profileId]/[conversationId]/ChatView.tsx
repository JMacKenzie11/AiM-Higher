"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRouter } from "next/navigation";
import {
  generateConversationTitleAction,
  renameConversationAction,
} from "@/lib/coach/actions";
import type { CoachingConversation } from "@/lib/coach/service";
import styles from "../../coach.module.css";

// The chat UI. Handles streaming SSE from /api/coach, renders the
// thread, and gives the admin an inline retry when a stream fails.

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  streaming?: boolean;
  error?: string | null;
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
}: {
  conversation: CoachingConversation;
  // Null in general (Ask Aimee) mode — no subject on file.
  subjectName: string | null;
  subjectPosition: string | null;
  firstName: string | null;
  initialMessages: UiMessage[];
}) {
  const isGeneral = conversation.mode === "general";
  const suggestions = isGeneral ? GENERAL_SUGGESTION_CHIPS : ABOUT_SUGGESTION_CHIPS;
  const emptyPrompt = isGeneral
    ? "What's on your mind?"
    : `What's on your mind about ${firstName ?? "them"}?`;
  const composerPlaceholder = isGeneral ? "Ask Aimee…" : "Message coach…";
  const headerSubject = isGeneral
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
  const threadRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
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

  // Keep the bottom of the thread in view as the assistant streams.
  // The scroll container here is the window (sticky header + composer
  // sit at page level; the thread just grows the page height), so
  // scrollTo on the thread element itself is a no-op. scrollIntoView
  // on a bottom anchor works regardless of which ancestor scrolls.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = 24;
    el.style.height = `${Math.min(lineHeight * 6, el.scrollHeight)}px`;
  }, [input]);

  const sendMessage = useCallback(
    async (text: string, opts: { retry?: boolean } = {}) => {
      const trimmed = text.trim();
      if ((!trimmed && !opts.retry) || sending) return;
      setSending(true);
      if (!opts.retry) setLastUserAttempt(trimmed);

      // Only place a fresh user bubble when this is a NEW send; on
      // retry the bubble is already there and the server's row already
      // exists — sending another would duplicate.
      if (!opts.retry) {
        setMessages((prev) => [
          ...prev,
          { id: `local-u-${Date.now()}`, role: "user", content: trimmed },
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
              if (!autoTitledRef.current && next.length === 4) {
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
    [conversation.id, sending]
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
          {renaming ? (
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
          ) : (
            <button
              type="button"
              className={styles.chatHeaderTitle}
              onClick={() => setRenaming(true)}
              title="Click to rename"
            >
              {title}
            </button>
          )}
        </div>
      </div>

      <div className={styles.thread} ref={threadRef}>
        {isEmpty ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyStatePrompt}>{emptyPrompt}</p>
            <div className={styles.chipRow}>
              {suggestions.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className={styles.chip}
                  onClick={() => void sendMessage(chip)}
                  disabled={sending}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onRetry={m.error ? retry : undefined}
            />
          ))
        )}
        <div ref={bottomRef} aria-hidden />
      </div>

      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage(input);
        }}
      >
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
        <button
          type="submit"
          className={styles.sendButton}
          disabled={sending || !input.trim()}
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

function MessageBubble({
  message,
  onRetry,
}: {
  message: UiMessage;
  onRetry?: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className={`${styles.bubbleRow} ${styles.bubbleRowUser}`}>
        <div className={styles.bubbleUser}>{message.content}</div>
      </div>
    );
  }
  // Between "send" and the first streamed token, `message.content`
  // is empty and only the blinking cursor rendered, which reads as
  // "did this break?" for first-time users. Show an explicit
  // "Thinking…" indicator until at least one token has arrived, at
  // which point the streaming content takes over.
  const isThinking = message.streaming && message.content.length === 0;
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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
