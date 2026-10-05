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
import {
  OUTPUT_CARD_BY_TAG,
  type OutputCardName,
} from "@/lib/practices/output-cards";
import type { Practice } from "@/lib/practices/registry";
import { linkDecision } from "@/lib/pages/registry";
import Link from "next/link";
import { ScriptCard } from "@/components/practices/ScriptCard";
import { CommitmentDraftCard } from "@/components/coach/CommitmentDraftCard";
import { ChartProposalCard } from "@/components/practices/ChartProposalCard";
import { SessionOfferCard } from "@/components/aimee/SessionOfferCard";
import { RoleDescriptionCard } from "@/components/practices/RoleDescriptionCard";
import {
  AgentPicker,
  type AgentAttachedInfo,
} from "@/components/practices/AgentPicker";
import { stripEmDashes } from "@/lib/voice/strip-dashes";
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
  // What the model is doing while it has produced no text yet.
  // A turn that ends in a tool call streams nothing, so without
  // this the bubble says "Thinking…" for a whole model call plus
  // the tool round trip — measured at most of a minute on one real
  // conversation, with 3,200 output tokens spent behind it.
  activity?: string | null;
  // The model hit its ceiling on this turn, so the text stops
  // mid-token. Reported by the server, not guessed from the text.
  truncated?: boolean;
  error?: string | null;
  // The saved row's id, for a reply streamed in this session (its `id`
  // is a local one, kept as the React key). A card that saves against
  // the message reads it (CommitmentDraftCard). Rows loaded with the
  // page have their real id as `id`.
  savedId?: string | null;
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
  agentPickerPractices = null,
  autoOpen = false,
  revisionPreamble = null,
  access,
  currentUserId,
  senders,
  shareHeader,
  openablePatterns,
  variant = "page",
  pageContext,
  panelGreeting,
  panelSuggestions = [],
  composerRef,
  onHasUserTurns,
  onOpenConversation,
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
  // Registry entries the current caller is allowed to attach as
  // an agent to THIS conversation, pre-filtered by role. Null (or
  // omitted) hides the AgentPicker entirely — used for about-mode
  // threads where the agent slot isn't meaningful.
  agentPickerPractices?: readonly Practice[] | null;
  // Open the conversation by generating the first turn, rather than
  // waiting behind the empty-state chips. Set when the conversation
  // exists to revise something: the person said what they wanted by
  // clicking Revise, and offering them "write a role description for
  // a seat on our Functional Chart" is offering to start over.
  //
  // Per-CONVERSATION, which is why it is not firstTurn. The same
  // agent starts a fresh interview behind chips and a revision by
  // reading the document first; the registry describes the agent and
  // cannot tell those two apart.
  autoOpen?: boolean;
  // The document this conversation is revising, rendered above the
  // thread. Server-rendered from the saved version rather than asked
  // of the model: it is already on file, the renderer is the one the
  // card and the saved page use, and a model asked to reproduce a
  // document verbatim will eventually not.
  revisionPreamble?: ReactNode;
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
  // The pages this person can open (pages/registry.ts,
  // openablePatternsFor), for the link check in replies. Undefined
  // leaves links as they are.
  openablePatterns?: readonly string[];
  // "panel": the conversation in Aimee's panel (components/aimee). The
  // thread scrolls inside its own box rather than the window, since
  // the window belongs to the page beside it; there is no header (the
  // panel has its own); nothing refreshes the page underneath; and a
  // finished reply is announced once, whole, to screen readers.
  variant?: "page" | "panel";
  // Read at send time: what the panel is open beside (the path, and a
  // record a drawer has open), as a pattern and an id only. The server
  // decides what, if anything, Aimee is told (lib/aimee/page-context.ts).
  pageContext?: () => { path: string; record: { pattern: string; id: string } | null };
  // The panel's opening: Aimee's greeting, and questions for the page
  // this person is on (lib/aimee/suggestions.ts). Clicking one asks it.
  panelGreeting?: string;
  panelSuggestions?: readonly string[];
  // Lets the panel focus the message box when it opens.
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;
  // Told whether the person has sent anything yet. The panel hides
  // "New conversation" until they have: an empty one is already new.
  onHasUserTurns?: (has: boolean) => void;
  // Where a guided session started from Aimee's offer opens. The panel
  // passes one to open it in place; the Aimee page navigates.
  onOpenConversation?: (conversationId: string) => void;
}) {
  const inPanel = variant === "panel";
  const isOwner = access === "owner";
  const canWrite = access === "owner" || access === "write";
  // Attribution shows once at least one sharee exists — with just
  // the owner in the thread, every user bubble is trivially "them",
  // and a name label reads as noise.
  const showAttribution = Object.keys(senders).length > 1;
  // The AgentPicker only renders in owner-general chats where the
  // page passed practices. Lock is computed below from the live
  // messages state so it flips the instant a user turn is sent —
  // waiting for initialMessages to update would mean the picker
  // stays interactive until the next page reload.
  const showAgentPicker =
    isOwner &&
    conversation.mode === "general" &&
    agentPickerPractices !== null;
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
  // The thread as last rendered, for code that runs after a reply and
  // must not read it from inside a state update (sendMessage, onDone).
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  // Live lock signal: flips true the moment a user turn lands in
  // the message array (whether the server persisted it yet or
  // it's still an optimistic local bubble). Feeds the AgentPicker's
  // locked prop so the picker's non-interactive label kicks in
  // immediately on send, not on the next page reload.
  const hasUserTurns = messages.some((m) => m.role === "user");
  useEffect(() => {
    onHasUserTurns?.(hasUserTurns);
  }, [hasUserTurns, onHasUserTurns]);
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

  // Auto-fire the generate opener on landing when the attached agent
  // uses firstTurn='generate', OR when this conversation exists to
  // revise something. Ref-guarded so React 18 dev double-invoke
  // doesn't fire the stream twice. Only owners trigger it — sharees
  // see whatever's already there.
  //
  // `autoOpen` is the revision case and it is per-CONVERSATION,
  // which is why it is not firstTurn. The same agent starts a fresh
  // interview behind chips and a revision by reading the document
  // first; the registry describes the agent and cannot tell those
  // two apart.
  const openerFiredRef = useRef(false);
  useEffect(() => {
    if (openerFiredRef.current) return;
    if (!isOwner) return;
    if (!practice) return;
    // A session started from Aimee's offer opens itself too: the
    // person said yes to it, and the summary is all it needs to begin.
    if (practice.firstTurn !== "generate" && !autoOpen && !conversation.handoff_summary) return;
    if (initialMessages.length > 0) return;
    openerFiredRef.current = true;
    runOpenerGeneration();

    // RELEASE THE GUARD ON CLEANUP, or in dev it fires zero times.
    //
    // React 18 StrictMode runs effect → cleanup → effect. The
    // cleanup above this one aborts the in-flight coach fetch on
    // unmount, which is right when somebody navigates away and is
    // also what StrictMode's simulated unmount does: pass one starts
    // the stream, the cleanup kills it, and pass two returns early
    // because the ref says it already fired. The opener never
    // reaches the server and the bubble says "Thinking…" forever.
    //
    // This plumbing had never been exercised — the comment above
    // noted no agent shipped firstTurn: "generate" — so the
    // interaction sat there until a revision became its first
    // caller.
    //
    // Releasing the guard lets pass two fire for real. The
    // `initialMessages.length > 0` check above stops it re-firing on
    // a conversation that already has turns, and `sending` stops a
    // second concurrent stream.
    // Release the guard, and NOTHING ELSE.
    //
    // This cleanup used to drop the empty streaming bubble too, to
    // clear the one pass one left behind when its fetch was aborted.
    // That is wrong: StrictMode's cleanup runs while pass one's
    // fetch is still in flight, and pass two then declines to start
    // another because `sending` is already true. The bubble was
    // removed, the stream filled a message id that no longer
    // existed, and the reply vanished — saved on the server,
    // invisible on the page.
    //
    // The stale bubble is cleared where it is safe to: at the start
    // of the next attempt, which only happens once the previous one
    // has actually finished.
    return () => {
      openerFiredRef.current = false;
    };
    // Depend only on stable inputs — runOpenerGeneration is a
    // useCallback so its identity is stable across re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, practice, autoOpen, initialMessages.length]);

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
  //
  // In the panel the same rule runs against the thread's own box.
  const stickToBottomRef = useRef(true);
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = inPanel ? threadRef.current : null;
    function onScroll() {
      const scrollTop = box ? box.scrollTop : window.scrollY;
      const viewport = box ? box.clientHeight : window.innerHeight;
      const total = box ? box.scrollHeight : document.documentElement.scrollHeight;
      const distanceFromBottom = total - (scrollTop + viewport);
      stickToBottomRef.current = distanceFromBottom < 80;
    }
    const target: HTMLElement | Window = box ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [inPanel]);
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const id = requestAnimationFrame(() => {
      if (inPanel) {
        const box = threadRef.current;
        if (box) box.scrollTop = box.scrollHeight;
      } else {
        window.scrollTo({ top: document.documentElement.scrollHeight });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [messages, inPanel]);

  // THE PANEL ANNOUNCES A REPLY ONCE IT IS COMPLETE. A reply read out
  // token by token as it streams is unusable, so the thread itself is
  // not a live region; this is, and it is filled only on done.
  const [announcement, setAnnouncement] = useState("");

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
      // Counted and collected here rather than read back inside a state
      // update in onDone: the person's sends including this one (a
      // retry's bubble is already there), and the reply as it arrives.
      const userTurnCount =
        messagesRef.current.filter((m) => m.role === "user").length + (opts.retry ? 0 : 1);
      let replyText = "";

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
            ...(pageContext ? { pageContext: pageContext() } : {}),
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
            replyText += chunk;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + chunk, activity: null }
                  : m
              )
            );
          },
          onTool: (label) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, activity: label } : m
              )
            );
          },
          onTruncated: () => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, truncated: true } : m
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
          onDone: (savedId) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, streaming: false, savedId } : m
              )
            );
            // NOTHING BELOW RUNS INSIDE THE STATE UPDATE. It used to: the
            // auto-title server action was called from within the
            // setMessages updater, and React runs updaters while
            // rendering, so calling it there updated the Router during
            // ChatView's render ("Cannot update a component (Router)
            // while rendering a different component (ChatView)", on
            // every second message on dev, since 2026-08-05). An
            // updater has to be pure; these are side effects.
            if (inPanel && replyText) setAnnouncement(`Aimee: ${replyText}`);
            // Fire auto-title after the SECOND user turn's response
            // lands. Counting user messages (not total length)
            // makes this robust to agent openers, which add a
            // pre-conversation assistant turn and would otherwise
            // shift the total-length guard by one. Only the owner
            // triggers auto-title; the server action rejects
            // non-owners anyway, but skipping the call avoids a
            // wasted round-trip when a sharee sends the fourth
            // message.
            if (isOwner && !autoTitledRef.current && userTurnCount === 2) {
              autoTitledRef.current = true;
              generateConversationTitleAction(conversation.id)
                .then((result) => {
                  if (result.ok && result.title) {
                    setTitle(result.title);
                    setRenameValue(result.title);
                    // Not in the panel: the page underneath is
                    // somebody else's and has nothing to update.
                    if (!inPanel) router.refresh();
                  }
                })
                .catch((err) => {
                  // Non-fatal — the default title stays.
                  console.warn("auto-title failed", err);
                });
            }
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
    [conversation.id, sending, currentUserId, isOwner, router, inPanel, pageContext]
  );

  function retry() {
    if (!lastUserAttempt) return;
    // Strip the failed assistant slot; keep the user bubble in place.
    setMessages((prev) => prev.filter((m) => !m.error));
    void sendMessage(lastUserAttempt, { retry: true });
  }

  // AgentPicker callback. Runs whenever the leader attaches or
  // clears an agent. Owns the client-side message state (which
  // useState only initializes once from the initialMessages prop —
  // a router.refresh() alone wouldn't re-sync it). Wipes any
  // optimistic messages, seeds the scripted opener returned by
  // the server, then either fires the generate flow or leaves the
  // slot empty for plain Aimee.
  const handleAgentAttached = useCallback(
    (info: AgentAttachedInfo) => {
      // Cancel any in-flight streaming so a stale response can't
      // land into the newly-swapped agent's turn.
      abortRef.current?.abort();
      const next: UiMessage[] = info.openerContent
        ? [
            {
              id: `local-a-${Date.now()}`,
              role: "assistant",
              content: info.openerContent,
            },
          ]
        : [];
      setMessages(next);
      // Auto-title tracking resets — a new agent = a new topic.
      autoTitledRef.current = false;
      if (info.runGenerateOpener) {
        // Small tick so React commits the wiped state before we
        // append the assistant streaming placeholder.
        setTimeout(() => runOpenerGeneration(), 0);
      }
    },
    // runOpenerGeneration is a stable useCallback — safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Called by the AgentPicker after the server action returns
  // runGenerateOpener=true. Streams the practice's dynamic opener
  // into a fresh assistant bubble via /api/coach — same shape as
  // a normal turn, but with generateOpener:true and no user text.
  const runOpenerGeneration = useCallback(() => {
    if (sending) return;
    setSending(true);

    // Optimistic assistant slot so the "Thinking…" indicator lands
    // immediately. Same id-shape as the normal path.
    //
    // Any EMPTY streaming slot still on screen belongs to an attempt
    // that was aborted — StrictMode's simulated unmount kills the
    // first fetch — and would otherwise sit there as a "Thinking…"
    // that never resolves, above the one that works. Dropped here
    // rather than in the effect's cleanup, because here the previous
    // attempt is provably over: `sending` was false.
    const assistantId = `local-a-${Date.now()}`;
    setMessages((prev) => [
      ...prev.filter((m) => !(m.streaming === true && m.content === "")),
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ]);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    void (async () => {
      try {
        const response = await fetch("/api/coach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: conversation.id,
            generateOpener: true,
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
                  ? { ...m, content: m.content + chunk, activity: null }
                  : m
              )
            );
          },
          onTool: (label) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, activity: label } : m
              )
            );
          },
          onTruncated: () => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, truncated: true } : m
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
          onDone: (savedId) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, streaming: false, savedId } : m
              )
            );
          },
        });
      } catch (error) {
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
            m.id === assistantId ? { ...m, streaming: false, error: msg } : m
          )
        );
      } finally {
        if (!controller.signal.aborted) setSending(false);
      }
    })();
  }, [conversation.id, sending]);

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
    <div
      className={inPanel ? `${styles.chatWrap} ${styles.chatWrapPanel}` : styles.chatWrap}
      data-conversation-id={conversation.id}
    >
      {inPanel ? (
        <p className={styles.srOnly} aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      ) : null}
      {inPanel ? null : (
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
        {showAgentPicker ? (
          <div className={styles.chatHeaderShare}>
            <AgentPicker
              conversationId={conversation.id}
              practices={agentPickerPractices ?? []}
              currentAgent={practice}
              locked={hasUserTurns}
              onAgentAttached={handleAgentAttached}
            />
          </div>
        ) : null}
        {shareHeader ? (
          <div className={styles.chatHeaderShare}>{shareHeader}</div>
        ) : null}
      </div>
      )}

      <div
        ref={threadRef}
        className={inPanel ? `${styles.thread} ${styles.threadPanel}` : styles.thread}
        data-testid="coach-thread"
      >
        {revisionPreamble}
        {isEmpty && autoOpen ? null : isEmpty && inPanel && !isPractice ? (
          // THE PANEL'S OPENING: a small message from Aimee, the size of
          // her replies, and the page's questions under it. The page's
          // big gradient card took most of a 400px panel (Jason,
          // 2026-09-29).
          <div className={styles.panelOpening}>
            <div className={`${styles.bubbleRow} ${styles.bubbleRowAssistant}`}>
              <div className={styles.bubbleAssistant}>{panelGreeting ?? emptyPrompt}</div>
            </div>
            {panelSuggestions.length > 0 ? (
              <div className={styles.panelChips} data-testid="panel-suggestions">
                {panelSuggestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className={styles.panelChip}
                    onClick={() => void sendMessage(q)}
                    disabled={sending}
                  >
                    {q}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : isEmpty ? (
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
              Or type your own prompt in the box below.
            </p>
          </div>
        ) : (
          messages.map((m, i) => (
            <MessageBubble
              key={m.id}
              message={m}
              // Something the person said after this message, which
              // settles an offer card in it (Not now, or anything else).
              settled={messages.slice(i + 1).some((later) => later.role === "user")}
              onOpenConversation={onOpenConversation}
              onRetry={m.error ? retry : undefined}
              practice={practice}
              conversationId={conversation.id}
              onFixProposal={(nudge) => void sendMessage(nudge)}
              senders={senders}
              currentUserId={currentUserId}
              showAttribution={showAttribution}
              openablePatterns={openablePatterns}
              // The panel is 400px wide, too narrow for a chart or a
              // role description to read well; the cards link to the
              // same conversation on the Aimee page.
              fullSizeHref={inPanel ? `/ask-aimee/${conversation.id}` : undefined}
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
          Read-only. Ask the owner for Collaborate access to reply.
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
            ref={(el) => {
              textareaRef.current = el;
              if (composerRef) composerRef.current = el;
            }}
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
  practice: _practice,
  conversationId,
  onFixProposal,
  senders,
  currentUserId,
  showAttribution,
  openablePatterns,
  fullSizeHref,
  settled = false,
  onOpenConversation,
}: {
  message: UiMessage;
  onRetry?: () => void;
  practice?: Practice | null;
  conversationId: string;
  // Takes the nudge, because the nudge belongs to the CARD. It was
  // a no-argument callback closing over the chart builder's text,
  // so "Fix the proposal" on the role description card asked the
  // agent to re-emit a chart_proposal block it has never heard of,
  // and the agent said so. Each card knows what it failed to parse;
  // nothing above it does.
  onFixProposal?: (nudge: string) => void;
  senders: Record<string, SenderInfo>;
  currentUserId: string;
  showAttribution: boolean;
  openablePatterns?: readonly string[];
  fullSizeHref?: string;
  settled?: boolean;
  onOpenConversation?: (conversationId: string) => void;
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
      <div
        className={`${styles.bubbleRow} ${styles.bubbleRowUser}`}
        data-testid="coach-bubble"
      >
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
  // known tag -> card map and swap them for the matching
  // card component. Anything unmapped falls through to a plain <pre>.
  // Registry-driven so adding a new tag→card wiring is a registry
  // entry plus a component in CARD_RENDERERS below.
  // The tag -> card map is global now, not per agent. Any agent
  // whose prompt tells the model to emit one of the known tags gets
  // the card, including one built in the Hub.
  const outputCard = OUTPUT_CARD_BY_TAG;
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
            onFixProposal,
            message.truncated === true,
            message.savedId ?? (message.id.startsWith("local-") ? null : message.id),
            fullSizeHref,
            { settled, onOpenConversation }
          );
        }
      }
      return <pre>{children}</pre>;
    },
    // LINKS ARE CHECKED WHERE THEY ARE DRAWN. Aimee is told the pages
    // this person can open, and only links to those; this makes it
    // hold whatever she writes. An in-app link to a page outside
    // openablePatterns renders as plain text, so a team member is never
    // offered a door to an admin page. Checked here rather than by
    // rewriting the saved reply because replies stream: the reader
    // sees the link as it arrives. The page itself still refuses anyone
    // it should (its own guard and RLS); this is about not advertising.
    a({ href, children }) {
      const decision = linkDecision(href, openablePatterns);
      if (decision === "text") return <span>{children}</span>;
      if (decision === "in-app") {
        return <Link href={href as string}>{children}</Link>;
      }
      return <a href={href}>{children}</a>;
    },
  };

  return (
    <div
      className={`${styles.bubbleRow} ${styles.bubbleRowAssistant}`}
      data-testid="coach-bubble"
    >
      <div className={styles.bubbleAssistant}>
        {isThinking ? (
          <p className={styles.thinking} role="status" aria-live="polite">
            <span className={styles.thinkingDots} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {message.activity ?? "Thinking…"}
          </p>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {/* Dashes out of every reply as it is shown, streaming
                included (Jason, 2026-09-29). Run on the whole text so
                far, so a dash settles into its comma or colon as the
                next word arrives; the route saves the same result. */}
            {stripEmDashes(message.content)}
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
  onFixProposal?: (nudge: string) => void,
  truncated = false,
  // The saved message's id; null until it is saved.
  messageId: string | null = null,
  // Set in the panel: where the card opens at full width.
  fullSizeHref?: string,
  // For Aimee's offer card: whether the person has said anything since,
  // and where a started session opens.
  offer: {
    settled?: boolean;
    onOpenConversation?: (conversationId: string) => void;
  } = {}
): ReactNode {
  switch (name) {
    case "SessionOfferCard":
      return (
        <SessionOfferCard
          raw={raw}
          streaming={streaming}
          messageId={messageId}
          settled={offer.settled === true}
          onReply={onFixProposal}
          onOpenConversation={offer.onOpenConversation}
        />
      );
    case "CommitmentDraftCard":
      return (
        <CommitmentDraftCard
          raw={raw}
          streaming={streaming}
          conversationId={conversationId}
          messageId={messageId}
        />
      );
    case "ScriptCard":
      return <ScriptCard raw={raw} streaming={streaming} />;
    case "ChartProposalCard":
      return (
        <ChartProposalCard
          raw={raw}
          streaming={streaming}
          conversationId={conversationId}
          onFixRequest={onFixProposal}
          fullSizeHref={fullSizeHref}
        />
      );
    case "RoleDescriptionCard":
      return (
        <RoleDescriptionCard
          raw={raw}
          streaming={streaming}
          conversationId={conversationId}
          onFixRequest={onFixProposal}
          truncated={truncated}
          fullSizeHref={fullSizeHref}
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
    onTool: (label: string) => void;
    onError: (message: string) => void;
    // The model ran out of room. The text simply stops, with no
    // marker in it, so this is the only honest way to know.
    onTruncated: () => void;
    // With the saved assistant message's id, when the server sent one.
    onDone: (savedId: string | null) => void;
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
        } else if (
          event === "tool" &&
          parsed &&
          typeof parsed === "object" &&
          "label" in parsed
        ) {
          const label = (parsed as { label?: unknown }).label;
          if (typeof label === "string") handlers.onTool(label);
        } else if (event === "error") {
          const message =
            parsed && typeof parsed === "object" && "message" in parsed
              ? String((parsed as { message?: unknown }).message ?? "Error")
              : "Error";
          handlers.onError(message);
        } else if (event === "truncated") {
          handlers.onTruncated();
        } else if (event === "done") {
          const id =
            parsed && typeof parsed === "object" && "assistantMessageId" in parsed
              ? (parsed as { assistantMessageId?: unknown }).assistantMessageId
              : null;
          handlers.onDone(typeof id === "string" ? id : null);
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
