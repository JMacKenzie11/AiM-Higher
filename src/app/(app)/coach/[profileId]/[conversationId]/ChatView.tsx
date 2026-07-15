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
import { renameConversationAction } from "@/lib/coach/actions";
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

const SUGGESTION_CHIPS = [
  "Prepare for a conversation",
  "Interpret their execution pattern",
  "Help me see what I'm missing",
];

export function ChatView({
  conversation,
  subjectName,
  subjectPosition,
  firstName,
  initialMessages,
}: {
  conversation: CoachingConversation;
  subjectName: string;
  subjectPosition: string | null;
  firstName: string;
  initialMessages: UiMessage[];
}) {
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [lastUserAttempt, setLastUserAttempt] = useState<string | null>(null);
  const [title, setTitle] = useState(conversation.title);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conversation.title);
  const [renamePending, startRename] = useTransition();
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
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

      try {
        const response = await fetch("/api/coach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: conversation.id,
            userMessage: trimmed,
            retry: Boolean(opts.retry),
          }),
        });
        if (!response.ok || !response.body) {
          throw new Error(
            `Request failed (${response.status}): ${await response.text()}`
          );
        }

        await consumeSse(response.body, {
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
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, streaming: false } : m
              )
            );
          },
        });
      } catch (error) {
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
        setSending(false);
        if (!opts.retry) setInput("");
        textareaRef.current?.focus();
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
    startRename(async () => {
      const result = await renameConversationAction(conversation.id, next);
      if (result.ok) {
        setTitle(next);
        setRenaming(false);
      } else {
        alert(result.message);
      }
    });
  }

  const isEmpty = messages.length === 0;

  return (
    <div className={styles.chatWrap}>
      <div className={styles.chatHeader}>
        <div className={styles.chatHeaderMain}>
          <span className={styles.chatHeaderSubject}>
            {subjectName}
            {subjectPosition ? ` · ${subjectPosition}` : ""}
          </span>
          {renaming ? (
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
                }
              }}
              disabled={renamePending}
              autoFocus
            />
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
            <p className={styles.emptyStatePrompt}>
              What&rsquo;s on your mind about {firstName}?
            </p>
            <div className={styles.chipRow}>
              {SUGGESTION_CHIPS.map((chip) => (
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
          placeholder={`Message coach…`}
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
  return (
    <div className={`${styles.bubbleRow} ${styles.bubbleRowAssistant}`}>
      <div className={styles.bubbleAssistant}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {message.content}
        </ReactMarkdown>
        {message.streaming ? (
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
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  handlers: {
    onDelta: (chunk: string) => void;
    onError: (message: string) => void;
    onDone: () => void;
  }
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
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
}
