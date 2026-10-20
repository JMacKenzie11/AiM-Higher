"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { Drawer } from "@/components/ui/Drawer";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { NotesEditor } from "@/components/notes/NotesEditor";
import { NotesView } from "@/components/notes/NotesView";
import { CommitmentResolutionChip } from "@/components/plan/CommitmentResolutionChip";
import { CommitmentRow } from "@/app/(app)/commitments/CommitmentRow";
import {
  changeCommitmentLinkAction,
  type LinkTarget,
  createCommitmentAction,
  reassignCommitmentAction,
  rescheduleCommitmentAction,
  saveCommitmentNotesAction,
  updateCommitmentDescriptionAction,
} from "@/lib/commitments/actions";
import {
  createIssueFromDrawerAction,
  deleteIssueAction,
  saveIssueAction,
} from "@/lib/issues/actions";
import { splitThread } from "@/lib/issues/thread";
import { cleanNotes, type NotesDoc } from "@/lib/notes/clean";
import { dueLabel } from "@/lib/commitments/due-label";
import type { CommitmentWithMeta } from "@/lib/commitments/service";
import type { IssueWithCommitments } from "@/lib/issues/service";
import {
  WorkDrawerContext,
  type CommitmentContext,
  type IssueContext,
  type NewCommitmentContext,
  type WorkDrawerApi,
} from "./context";
import styles from "./work-drawer.module.css";

// THE WORK DRAWER. See context.ts for how rows feed it.
//
// ONE DRAWER, NEVER TWO. It shows one of four things: an issue, a
// new issue, a commitment, or a new commitment (the add-panel switch). Opening a commitment from inside an
// issue swaps the content and leaves a back arrow to the issue;
// previous and next swap it again. Nothing ever opens a second drawer
// over this one, which is also why a commitment row inside it keeps
// its clarity dot but does not open the clarity editor (`inDrawer`).
//
// SAVE IS A BUTTON. Edits wait for it (Jason, 2026-10-16). Leaving
// with unsaved edits, by closing, stepping, going back or opening a
// commitment, asks first: Save, Discard, or Escape to keep editing.
//
// Mounted once, in the app layout, so it outlives a page change. That
// is what lets an issue's delete wait out its undo chip after the
// person has moved on.

type View =
  | { kind: "issue"; id: string }
  | { kind: "newIssue"; ctx: IssueContext }
  | { kind: "newCommitment"; ctx: NewCommitmentContext }
  | { kind: "commitment"; id: string; order: string[]; fromIssue: string | null };

type Guard = { dirty: () => boolean; save: () => Promise<boolean> };

const UNDO_MS = 30000;

export function WorkDrawerProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const commitments = useRef(new Map<string, { c: CommitmentWithMeta; ctx: CommitmentContext }>());
  const issues = useRef(new Map<string, { issue: IssueWithCommitments; ctx: IssueContext }>());
  const [view, setView] = useState<View | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;
  const [, setVersion] = useState(0);
  const guard = useRef<Guard | null>(null);
  const [asking, setAsking] = useState<View | "close" | null>(null);
  const [savingOnLeave, setSavingOnLeave] = useState(false);

  // ---- The registry ----
  const isShown = (id: string) => {
    const v = viewRef.current;
    if (!v) return false;
    if (v.kind === "commitment") return v.id === id || v.fromIssue === id;
    return v.kind === "issue" && v.id === id;
  };

  const registerCommitment = useCallback((c: CommitmentWithMeta, ctx: CommitmentContext) => {
    const prev = commitments.current.get(c.id);
    commitments.current.set(c.id, { c, ctx });
    if (prev?.c !== c && isShown(c.id)) setVersion((n) => n + 1);
  }, []);

  const registerIssue = useCallback((issue: IssueWithCommitments, ctx: IssueContext) => {
    const prev = issues.current.get(issue.id);
    issues.current.set(issue.id, { issue, ctx });
    // Its commitments come with it. On /issues they are not on the page
    // until the drawer lists them, so this is where they are fresh.
    for (const c of issue.commitments) {
      commitments.current.set(c.id, { c, ctx: commitmentCtxFromIssue(c, ctx) });
    }
    if (prev?.issue !== issue && (isShown(issue.id) || issue.commitments.some((c) => isShown(c.id)))) {
      setVersion((n) => n + 1);
    }
  }, []);

  // ---- Moving between views, through the unsaved-changes question ----
  const go = useCallback((next: View | "close") => {
    if (guard.current?.dirty()) {
      setAsking(next);
      return;
    }
    guard.current = null;
    setView(next === "close" ? null : next);
  }, []);

  const openCommitment = useCallback(
    (id: string, from: HTMLElement | null) => {
      const scope =
        (from?.closest("[data-drawer]") as HTMLElement | null) ??
        document.getElementById("content") ??
        document.body;
      const order: string[] = [];
      scope.querySelectorAll<HTMLElement>("[data-commitment-id]").forEach((el) => {
        const cid = el.dataset.commitmentId;
        // Only rows on screen: a collapsed prior week is not "the list".
        if (cid && !order.includes(cid) && el.offsetParent !== null) order.push(cid);
      });
      if (!order.includes(id)) order.push(id);
      const v = viewRef.current;
      const fromIssue =
        from?.closest("[data-drawer]") && v?.kind === "issue" ? v.id : null;
      go({ kind: "commitment", id, order, fromIssue });
    },
    [go]
  );

  const openIssue = useCallback((id: string) => go({ kind: "issue", id }), [go]);
  const openNewIssue = useCallback((ctx: IssueContext) => go({ kind: "newIssue", ctx }), [go]);
  const openNewCommitment = useCallback((ctx: NewCommitmentContext) => go({ kind: "newCommitment", ctx }), [go]);

  // ---- Undo chips ----
  //
  // One chip at a time. An issue's delete is a real delete (its
  // commitments lose their link, 0143), so it WAITS for its chip:
  // hidden now, deleted when the chip goes, cancelled by Undo. Closing
  // the tab inside the 30 seconds leaves the issue where it was.
  //
  // A NEW CHIP SENDS ANY DELETE STILL WAITING, at once. Its own chip
  // has just been replaced, so its Undo is gone; leaving the delete to
  // fire later would be a delete with no way back that nobody can see
  // coming (Vercel review on #470).
  const [undo, setUndo] = useState<{ key: number; label: string; run: () => void } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeletes = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; send: () => void }>());
  const [hiddenIssues, setHiddenIssues] = useState<Set<string>>(new Set());

  const showUndo = useCallback((label: string, run: () => void) => {
    for (const [, pending] of pendingDeletes.current) {
      clearTimeout(pending.timer);
      pending.send();
    }
    pendingDeletes.current.clear();
    if (undoTimer.current) clearTimeout(undoTimer.current);
    const key = Date.now();
    setUndo({ key, label, run });
    undoTimer.current = setTimeout(() => setUndo((u) => (u?.key === key ? null : u)), UNDO_MS);
  }, []);

  const deleteIssueWithUndo = useCallback(
    (id: string) => {
      setHiddenIssues((s) => new Set(s).add(id));
      const unhide = () =>
        setHiddenIssues((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      const send = async () => {
        const result = await deleteIssueAction(id);
        if (!result.ok) {
          unhide();
          showUndo(result.message, () => {});
        } else {
          router.refresh();
        }
      };
      // The chip first, so it sends whatever was waiting before this
      // delete starts waiting itself.
      showUndo("Issue deleted", () => {
        const pending = pendingDeletes.current.get(id);
        if (pending) clearTimeout(pending.timer);
        pendingDeletes.current.delete(id);
        unhide();
      });
      const timer = setTimeout(() => {
        pendingDeletes.current.delete(id);
        void send();
      }, UNDO_MS);
      pendingDeletes.current.set(id, { timer, send: () => void send() });
    },
    [router, showUndo]
  );

  const api = useMemo<WorkDrawerApi>(
    () => ({
      registerCommitment,
      registerIssue,
      hasIssue: (id) => issues.current.has(id),
      openCommitment,
      openIssue,
      openNewIssue,
      openNewCommitment,
      isIssueHidden: (id) => hiddenIssues.has(id),
      deleteIssueWithUndo,
      showUndo,
    }),
    [registerCommitment, registerIssue, openCommitment, openIssue, openNewIssue, openNewCommitment, hiddenIssues, deleteIssueWithUndo, showUndo]
  );

  // ---- What the drawer shows ----
  let title = "";
  let body: ReactNode = null;
  if (view?.kind === "issue") {
    const entry = issues.current.get(view.id);
    title = "Issue";
    body = entry ? (
      <IssuePanel key={view.id} issue={entry.issue} ctx={entry.ctx} guard={guard} />
    ) : (
      <p className={styles.muted}>Loading…</p>
    );
  } else if (view?.kind === "newIssue") {
    title = "New issue";
    body = (
      <NewIssuePanel
        guard={guard}
        onCreated={(issue) => {
          issues.current.set(issue.id, { issue: { ...issue, commitments: [] }, ctx: view.ctx });
          guard.current = null;
          setView({ kind: "issue", id: issue.id });
          router.refresh();
        }}
      />
    );
  } else if (view?.kind === "newCommitment") {
    title = "New commitment";
    body = (
      <NewCommitmentPanel
        key={JSON.stringify(view.ctx.fixedPriorityId ?? "")}
        ctx={view.ctx}
        guard={guard}
        onAdded={() => router.refresh()}
      />
    );
  } else if (view?.kind === "commitment") {
    const entry = commitments.current.get(view.id);
    const at = view.order.indexOf(view.id);
    const prevId = at > 0 ? view.order[at - 1] : null;
    const nextId = at >= 0 && at < view.order.length - 1 ? view.order[at + 1] : null;
    const step = (id: string | null) => {
      if (id) go({ ...view, id });
    };
    title = "Commitment";
    body = (
      <>
        <nav className={styles.stepper} aria-label="Move between commitments">
          {view.fromIssue ? (
            <button
              type="button"
              className={styles.back}
              onClick={() => go({ kind: "issue", id: view.fromIssue! })}
            >
              <span aria-hidden>←</span> Back to the issue
            </button>
          ) : (
            <span />
          )}
          {view.order.length > 1 ? (
            <span className={styles.steps}>
              <button
                type="button"
                className={styles.arrow}
                onClick={() => step(prevId)}
                disabled={!prevId}
                aria-label="Previous commitment"
                title="Previous commitment"
              >
                ‹
              </button>
              <span className={styles.position}>
                {at + 1} of {view.order.length}
              </span>
              <button
                type="button"
                className={styles.arrow}
                onClick={() => step(nextId)}
                disabled={!nextId}
                aria-label="Next commitment"
                title="Next commitment"
              >
                ›
              </button>
            </span>
          ) : null}
        </nav>
        {entry ? (
          <CommitmentPanel
            key={view.id}
            c={entry.c}
            ctx={entry.ctx}
            guard={guard}
            onOpenIssue={(id) => go({ kind: "issue", id })}
            canOpenIssue={(id) => issues.current.has(id)}
          />
        ) : (
          <p className={styles.muted}>This commitment is no longer on the list.</p>
        )}
      </>
    );
  }

  // Previous and next from the keyboard too, outside a text field: the
  // weekly meeting runs through the list with the drawer open.
  useEffect(() => {
    if (view?.kind !== "commitment") return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const v = viewRef.current;
      if (v?.kind !== "commitment") return;
      const at = v.order.indexOf(v.id);
      const id = e.key === "ArrowLeft" ? v.order[at - 1] : v.order[at + 1];
      if (id) {
        e.preventDefault();
        go({ ...v, id });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view?.kind, go]);

  return (
    <WorkDrawerContext.Provider value={api}>
      {children}
      <Drawer
        open={view !== null}
        onClose={() => go("close")}
        title={title}
        name="work"
      >
        <div className={styles.drawerBody}>{body}</div>
      </Drawer>
      <ConfirmDialog
        open={asking !== null}
        title="Save your changes?"
        message="You've changed this and not saved it yet."
        confirmLabel="Save"
        cancelLabel="Discard"
        tone="primary"
        pending={savingOnLeave}
        onConfirm={async () => {
          const next = asking;
          setSavingOnLeave(true);
          const ok = (await guard.current?.save()) ?? true;
          setSavingOnLeave(false);
          setAsking(null);
          if (!ok || next === null) return;
          guard.current = null;
          setView(next === "close" ? null : next);
        }}
        onCancel={() => {
          const next = asking;
          setAsking(null);
          guard.current = null;
          if (next !== null) setView(next === "close" ? null : next);
        }}
        onDismiss={() => setAsking(null)}
      />
      {undo ? (
        <div className={styles.undoChip} role="status" aria-live="polite" key={undo.key}>
          {undo.label}
          <button
            type="button"
            className={styles.undoButton}
            onClick={() => {
              undo.run();
              setUndo(null);
            }}
          >
            Undo
          </button>
        </div>
      ) : null}
    </WorkDrawerContext.Provider>
  );
}

function commitmentCtxFromIssue(c: CommitmentWithMeta, ctx: IssueContext): CommitmentContext {
  const mine = ctx.isAdmin || (c.owner_id !== null && c.owner_id === ctx.currentUserId);
  return {
    roster: ctx.roster,
    priorityOptions: ctx.priorityOptions,
    functionalAreaOptions: ctx.functionalAreaOptions,
    todayIso: ctx.todayIso,
    canResolve: mine,
    // The owner or an admin, as on /commitments (canWriteOwnedRow).
    canLink: mine,
    canReassign: mine,
    currentUserId: ctx.currentUserId,
    isAdmin: ctx.isAdmin,
  };
}

// ---- A Save button and its "Saved" ---------------------------------

function SaveBar({
  dirty,
  pending,
  saved,
  error,
  onSave,
  label = "Save",
}: {
  dirty: boolean;
  pending: boolean;
  saved: boolean;
  error: string | null;
  onSave: () => void;
  label?: string;
}) {
  return (
    <div className={styles.saveBar}>
      <button type="button" className={styles.save} onClick={onSave} disabled={!dirty || pending}>
        {pending ? "Saving…" : label}
      </button>
      {saved && !dirty ? (
        <span className={styles.saved} role="status">
          <span aria-hidden>✓</span> Saved
        </span>
      ) : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function sameNotes(a: NotesDoc | null | undefined, b: NotesDoc | null | undefined): boolean {
  return JSON.stringify(cleanNotes(a ?? null)) === JSON.stringify(cleanNotes(b ?? null));
}

// ---- An issue ------------------------------------------------------

function IssueFields({
  title,
  setTitle,
  want,
  setWant,
  notes,
  setNotes,
  notesKey,
  canEdit,
  autoFocus,
}: {
  title: string;
  setTitle: (v: string) => void;
  want: string;
  setWant: (v: string) => void;
  notes: NotesDoc | null | undefined;
  setNotes: (v: NotesDoc | null) => void;
  notesKey: string;
  canEdit: boolean;
  autoFocus?: boolean;
}) {
  // Focus after the drawer's own effect, which puts focus on the panel
  // when it opens: a plain autoFocus would land and then be moved.
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => titleRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [autoFocus]);

  if (!canEdit) {
    return (
      <div className={styles.fields}>
        <Field label="Description">
          <p className={styles.readText}>{title}</p>
        </Field>
        <Field label="What do we want">
          <p className={want ? styles.readText : styles.muted}>{want || "Not yet defined."}</p>
        </Field>
        <Field label="Notes">
          <NotesView notes={notes} />
        </Field>
      </div>
    );
  }
  return (
    <div className={styles.fields}>
      <Field label="Description" htmlFor="work-issue-title">
        <textarea
          id="work-issue-title"
          className={styles.textarea}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          rows={2}
          maxLength={200}
          placeholder="A problem, tension or unresolved question"
          ref={titleRef}
        />
      </Field>
      <Field label="What do we want" htmlFor="work-issue-want">
        <textarea
          id="work-issue-want"
          className={styles.textarea}
          value={want}
          onChange={(e) => setWant(e.target.value)}
          rows={2}
          placeholder="The outcome you want here"
        />
      </Field>
      <Field label="Notes">
        <NotesEditor key={notesKey} initial={notes} onChange={setNotes} label="Issue notes" />
      </Field>
    </div>
  );
}

function IssuePanel({
  issue,
  ctx,
  guard,
}: {
  issue: IssueWithCommitments;
  ctx: IssueContext;
  guard: React.MutableRefObject<Guard | null>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(issue.title);
  const [want, setWant] = useState(issue.desired_outcome ?? "");
  const [notes, setNotes] = useState<NotesDoc | null>(issue.notes ?? null);
  const [base, setBase] = useState({ title: issue.title, want: issue.desired_outcome ?? "", notes: issue.notes ?? null });
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    ctx.canEdit &&
    (title.trim() !== base.title.trim() || want.trim() !== base.want.trim() || !sameNotes(notes, base.notes));

  async function save(): Promise<boolean> {
    if (!title.trim()) {
      setError("Describe the issue first.");
      return false;
    }
    setPending(true);
    setError(null);
    const result = await saveIssueAction(issue.id, { title, desiredOutcome: want, notes });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    setBase({ title: result.issue.title, want: result.issue.desired_outcome ?? "", notes: result.issue.notes ?? null });
    setTitle(result.issue.title);
    setWant(result.issue.desired_outcome ?? "");
    setSaved(true);
    router.refresh();
    return true;
  }

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    guard.current = { dirty: () => dirtyRef.current, save: () => saveRef.current() };
  }, [guard]);

  // Finished first, so the list reads as history then live work, as
  // the issues page has always shown it.
  const thread = splitThread(issue.commitments);
  const open = thread.active ? [thread.active, ...thread.otherOpen] : thread.otherOpen;
  const lines = [...thread.completed, ...open];

  return (
    <>
      <IssueFields
        title={title}
        setTitle={setTitle}
        want={want}
        setWant={setWant}
        notes={notes}
        setNotes={setNotes}
        notesKey={issue.id}
        canEdit={ctx.canEdit}
      />
      {ctx.canEdit ? <SaveBar dirty={dirty} pending={pending} saved={saved} error={error} onSave={() => void save()} /> : null}

      <section className={styles.section} aria-labelledby="work-issue-commitments">
        <h3 id="work-issue-commitments" className={styles.sectionTitle}>
          Commitments
        </h3>
        {lines.length > 0 ? (
          <ul className={styles.commitmentList}>
            {lines.map((c) => {
              const cctx = commitmentCtxFromIssue(c, ctx);
              return (
                <CommitmentRow
                  key={c.id}
                  commitment={c}
                  priorityOptions={ctx.priorityOptions}
                  functionalAreaOptions={ctx.functionalAreaOptions}
                  roster={ctx.roster}
                  todayIso={ctx.todayIso}
                  canResolve={cctx.canResolve}
                  canReassign={cctx.canReassign}
                  // The row hides its link chip here (hidePriority);
                  // this is what the commitment drawer reads.
                  canLink={cctx.canLink}
                  hidePriority
                  inDrawer
                  currentUserId={ctx.currentUserId}
                  isAdmin={ctx.isAdmin}
                />
              );
            })}
          </ul>
        ) : (
          <p className={styles.muted}>No commitments yet.</p>
        )}
        {ctx.canAdd ? <AddCommitment issueId={issue.id} ctx={ctx} /> : null}
      </section>
    </>
  );
}

function NewIssuePanel({
  guard,
  onCreated,
}: {
  guard: React.MutableRefObject<Guard | null>;
  onCreated: (issue: IssueWithCommitments) => void;
}) {
  const [title, setTitle] = useState("");
  const [want, setWant] = useState("");
  const [notes, setNotes] = useState<NotesDoc | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = Boolean(title.trim() || want.trim() || cleanNotes(notes));

  async function save(): Promise<boolean> {
    if (!title.trim()) {
      setError("Describe the issue first.");
      return false;
    }
    setPending(true);
    setError(null);
    const result = await createIssueFromDrawerAction({ title, desiredOutcome: want, notes });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    onCreated({ ...result.issue, commitments: [] });
    return true;
  }

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    guard.current = { dirty: () => dirtyRef.current, save: () => saveRef.current() };
  }, [guard]);

  return (
    <>
      <IssueFields
        title={title}
        setTitle={setTitle}
        want={want}
        setWant={setWant}
        notes={notes}
        setNotes={setNotes}
        notesKey="new"
        canEdit
        autoFocus
      />
      <SaveBar
        dirty={Boolean(title.trim())}
        pending={pending}
        saved={false}
        error={error}
        onSave={() => void save()}
        label="Add issue"
      />
      <p className={styles.muted}>Once it is added you can add its commitments here.</p>
    </>
  );
}

// Adding a commitment on the issue, in place. The same action as the
// row it replaces on the issues page (createCommitmentAction): a
// description, an owner (an admin picks anyone, everyone else adds
// their own) and a due date.
function AddCommitment({ issueId, ctx }: { issueId: string; ctx: IssueContext }) {
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState(ctx.currentUserId);
  const [due, setDue] = useState(ctx.todayIso);
  // Notes can go on with it (Jason, 2026-10-17). Saved straight after
  // the commitment is made, by the same action the commitment panel
  // uses. The key empties the editor after each add.
  const [notes, setNotes] = useState<NotesDoc | null>(null);
  const [notesKey, setNotesKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function add() {
    if (!description.trim()) return;
    const fd = new FormData();
    fd.set("issue_id", issueId);
    fd.set("description", description);
    fd.set("owner_id", ownerId);
    fd.set("due_date", due);
    setError(null);
    startTransition(async () => {
      const result = await createCommitmentAction({ ok: false, message: "" }, fd);
      if (result && "ok" in result && !result.ok) {
        setError(result.message);
        return;
      }
      if (notes && result.ok) {
        const saved = await saveCommitmentNotesAction(result.commitment.id, notes);
        if (!saved.ok) {
          setError(`The commitment was added, but its notes did not save: ${saved.message}`);
          return;
        }
      }
      setDescription("");
      setNotes(null);
      setNotesKey((k) => k + 1);
      setDue(ctx.todayIso);
      setOwnerId(ctx.currentUserId);
      inputRef.current?.focus();
    });
  }

  return (
    <div className={styles.addCommitment}>
      <label htmlFor={`work-add-${issueId}`} className={styles.label}>
        New commitment
      </label>
      <textarea
        id={`work-add-${issueId}`}
        ref={inputRef}
        className={styles.textarea}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            add();
          }
        }}
        rows={2}
        placeholder="What will we do this week?"
        disabled={pending}
      />
      <span className={styles.label} aria-hidden>
        Notes
      </span>
      <NotesEditor key={notesKey} initial={null} onChange={setNotes} label="New commitment notes" />
      <div className={styles.addRow}>
        {ctx.isAdmin ? (
          <select
            className={styles.select}
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            aria-label="Owner"
            disabled={pending}
          >
            {ctx.roster.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        ) : (
          <span className={styles.readText}>
            {ctx.roster.find((p) => p.id === ctx.currentUserId)?.full_name ?? "You"}
          </span>
        )}
        <input
          type="date"
          className={styles.date}
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="Due date"
          disabled={pending}
        />
        <button type="button" className={styles.save} onClick={add} disabled={pending || !description.trim()}>
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ---- A new commitment (the add-panel switch) -------------------------
//
// "Add a commitment" opens this, as "Add an issue" opens a new issue
// (Jason, 2026-10-19). The same fields the always-open add row had,
// and the same action (createCommitmentAction): what, linked to, an
// owner (an admin picks anyone, everyone else adds their own), a due
// date or every week, and notes. After it is added the form empties
// and stays open, so a meeting can add the next one straight away;
// the new row shows in the list behind it.
function NewCommitmentPanel({
  ctx,
  guard,
  onAdded,
}: {
  ctx: NewCommitmentContext;
  guard: React.MutableRefObject<Guard | null>;
  onAdded: () => void;
}) {
  const pinned = ctx.fixedPriorityId ?? null;
  const blankLink = pinned ? `priority:${pinned}` : "none";
  const [description, setDescription] = useState("");
  const [link, setLink] = useState(blankLink);
  const [ownerId, setOwnerId] = useState(ctx.currentUserId);
  const [due, setDue] = useState(ctx.thisFriday);
  const [ongoing, setOngoing] = useState(false);
  const [notes, setNotes] = useState<NotesDoc | null>(null);
  const [notesKey, setNotesKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dirty = Boolean(description.trim() || cleanNotes(notes));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function save(): Promise<boolean> {
    if (!description.trim()) {
      setError("Say what the commitment is.");
      return false;
    }
    const target = linkTarget(link);
    const fd = new FormData();
    fd.set("description", description);
    fd.set("week_ending", ctx.thisFriday);
    fd.set("due_date", due);
    fd.set("owner_id", ownerId);
    fd.set("is_ongoing", ongoing ? "true" : "false");
    fd.set("priority_id", target.type === "priority" ? target.id : "");
    fd.set("functional_area_id", target.type === "functional_area" ? target.id : "");
    setPending(true);
    setError(null);
    setAdded(null);
    const result = await createCommitmentAction({ ok: false, message: "" }, fd);
    if (!result.ok) {
      setPending(false);
      setError(result.message);
      return false;
    }
    if (notes) {
      const saved = await saveCommitmentNotesAction(result.commitment.id, notes);
      if (!saved.ok) {
        setPending(false);
        setError(`The commitment was added, but its notes did not save: ${saved.message}`);
        return false;
      }
    }
    setPending(false);
    setAdded(description.trim());
    setDescription("");
    setLink(blankLink);
    setOwnerId(ctx.currentUserId);
    setDue(ctx.thisFriday);
    setOngoing(false);
    setNotes(null);
    setNotesKey((k) => k + 1);
    onAdded();
    inputRef.current?.focus();
    return true;
  }

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    guard.current = { dirty: () => dirtyRef.current, save: () => saveRef.current() };
  }, [guard]);

  return (
    <>
      <Field label="What" htmlFor="work-new-commitment-what">
        <textarea
          id="work-new-commitment-what"
          ref={inputRef}
          className={styles.textarea}
          value={description}
          onChange={(e) => {
            setAdded(null);
            setDescription(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void save();
            }
          }}
          rows={2}
          placeholder="A specific step you can check off."
          aria-label="New commitment"
          disabled={pending}
        />
      </Field>
      {pinned ? null : (
        <Field label="Linked to" htmlFor="work-new-commitment-link">
          <select
            id="work-new-commitment-link"
            className={styles.select}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            disabled={pending}
          >
            <option value="none">Nothing (operational)</option>
            {ctx.priorityOptions.length > 0 ? (
              <optgroup label="Priorities">
                {ctx.priorityOptions.map((p) => (
                  <option key={p.id} value={`priority:${p.id}`}>
                    {p.title}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {ctx.functionalAreaOptions.length > 0 ? (
              <optgroup label="Functional areas">
                {ctx.functionalAreaOptions.map((f) => (
                  <option key={f.id} value={`functional_area:${f.id}`}>
                    {f.title}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </Field>
      )}
      <Field label="Owner" htmlFor={ctx.isAdmin ? "work-new-commitment-owner" : undefined}>
        {ctx.isAdmin ? (
          <select
            id="work-new-commitment-owner"
            className={styles.select}
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            disabled={pending}
          >
            {ctx.roster.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        ) : (
          <span className={styles.readText}>
            {ctx.roster.find((p) => p.id === ctx.currentUserId)?.full_name ?? "You"}
          </span>
        )}
      </Field>
      <Field label="Due date" htmlFor="work-new-commitment-due">
        <input
          id="work-new-commitment-due"
          type="date"
          className={styles.date}
          value={due}
          onChange={(e) => setDue(e.target.value)}
          disabled={pending || ongoing}
        />
      </Field>
      <label className={styles.checkLine}>
        <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} disabled={pending} />
        Repeats every week
      </label>
      <Field label="Notes">
        <NotesEditor key={notesKey} initial={null} onChange={setNotes} label="New commitment notes" />
      </Field>
      <div className={styles.saveBar}>
        <button
          type="button"
          className={styles.save}
          data-testid="commitment-add-submit"
          onClick={() => void save()}
          disabled={pending || !description.trim()}
        >
          {pending ? "Adding…" : "Add commitment"}
        </button>
        {added && !dirty ? (
          <span className={styles.saved} role="status">
            <span aria-hidden>✓</span> Added. Add another, or close.
          </span>
        ) : null}
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}

// ---- A commitment --------------------------------------------------

function CommitmentPanel({
  c,
  ctx,
  guard,
  onOpenIssue,
  canOpenIssue,
}: {
  c: CommitmentWithMeta;
  ctx: CommitmentContext;
  guard: React.MutableRefObject<Guard | null>;
  onOpenIssue: (id: string) => void;
  canOpenIssue: (id: string) => boolean;
}) {
  const router = useRouter();
  // The same rights the row uses (CommitmentRow): the description and
  // notes are the owner's or an admin's; reassigning and rescheduling
  // follow canReassign and canResolve.
  const canEdit = ctx.isAdmin || c.owner_id === ctx.currentUserId;
  const isOpen = c.status === "open";
  const isParked = c.parked_at !== null;
  const canMove = ctx.canResolve && isOpen && !isParked;

  // Linked to, as one select value: the issue it came from (kept, never
  // chosen), a priority, a functional area, or nothing. The same
  // choices and rule as the row's link chip: the owner or an admin,
  // while it is open (changeCommitmentLinkAction).
  const canLink = ctx.canLink && isOpen;
  const initial = {
    description: c.description,
    ownerId: c.owner_id ?? "",
    due: c.due_date,
    notes: c.notes ?? null,
    link: linkValue(c),
  };
  const [base, setBase] = useState(initial);
  const [description, setDescription] = useState(initial.description);
  const [ownerId, setOwnerId] = useState(initial.ownerId);
  const [due, setDue] = useState(initial.due);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState<NotesDoc | null>(initial.notes);
  const [link, setLink] = useState(initial.link);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A refresh while the drawer is open (a quick action on the row
  // behind it) moves the baseline for the fields nobody has touched.
  useEffect(() => {
    setBase((b) => {
      if (description === b.description) setDescription(c.description);
      if (ownerId === b.ownerId) setOwnerId(c.owner_id ?? "");
      if (due === b.due) setDue(c.due_date);
      if (link === b.link) setLink(linkValue(c));
      return { description: c.description, ownerId: c.owner_id ?? "", due: c.due_date, notes: c.notes ?? null, link: linkValue(c) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c]);

  const descChanged = canEdit && description.trim() !== base.description.trim();
  const ownerChanged = ctx.canReassign && ownerId !== base.ownerId && ownerId !== "";
  const dueChanged = canMove && due !== base.due && due !== "";
  const notesChanged = canEdit && !sameNotes(notes, base.notes);
  const linkChanged = canLink && link !== base.link;
  const dirty = descChanged || ownerChanged || dueChanged || notesChanged || linkChanged;
  const needsReason = dueChanged && !ctx.isAdmin;

  async function save(): Promise<boolean> {
    setError(null);
    if (descChanged && !description.trim()) {
      setError("Describe the commitment first.");
      return false;
    }
    if (needsReason && !reason.trim()) {
      setError("Add a short reason for moving the date.");
      return false;
    }
    setPending(true);
    const steps: Array<() => Promise<{ ok: boolean; message?: string }>> = [];
    if (descChanged) steps.push(() => updateCommitmentDescriptionAction(c.id, description));
    if (ownerChanged) steps.push(() => reassignCommitmentAction(c.id, ownerId));
    if (dueChanged) steps.push(() => rescheduleCommitmentAction(c.id, due, reason.trim() || null));
    if (notesChanged) steps.push(() => saveCommitmentNotesAction(c.id, notes));
    if (linkChanged) steps.push(() => changeCommitmentLinkAction(c.id, linkTarget(link)));
    for (const step of steps) {
      const result = await step();
      if (!result.ok) {
        setPending(false);
        setError(result.message ?? "Couldn't save that change.");
        router.refresh();
        return false;
      }
    }
    setPending(false);
    setBase({ description: description.trim(), ownerId, due, notes: cleanNotes(notes), link });
    setReason("");
    setSaved(true);
    router.refresh();
    return true;
  }

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    guard.current = { dirty: () => dirtyRef.current, save: () => saveRef.current() };
  }, [guard]);

  const ownerName = c.owner?.full_name ?? "Unassigned";
  const anyEdit = canEdit || ctx.canReassign || canMove || canLink;

  return (
    <>
      <div className={styles.fields}>
        <Field label="What" htmlFor="work-commitment-what">
          {canEdit ? (
            <textarea
              id="work-commitment-what"
              className={styles.textarea}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          ) : (
            <p className={styles.readText}>{c.description}</p>
          )}
        </Field>

        <div className={styles.pair}>
          <Field label="Owner" htmlFor="work-commitment-owner">
            {ctx.canReassign ? (
              <select
                id="work-commitment-owner"
                className={styles.select}
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
              >
                {ownerId === "" ? <option value="">Unassigned</option> : null}
                {ctx.roster.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            ) : (
              <p className={styles.readText}>{ownerName}</p>
            )}
          </Field>
          <Field label="Due date" htmlFor="work-commitment-due">
            {isParked ? (
              <p className={styles.muted}>Parked, no date</p>
            ) : canMove ? (
              <input
                id="work-commitment-due"
                type="date"
                className={styles.date}
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            ) : (
              <p className={styles.readText}>{dueLabel(c)}</p>
            )}
          </Field>
        </div>

        {needsReason ? (
          <Field label="Reason for moving the date" htmlFor="work-commitment-reason">
            <textarea
              id="work-commitment-reason"
              className={styles.textarea}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Enter a reason for moving the due date"
            />
          </Field>
        ) : null}

        <div className={styles.pair}>
          <Field label="Status">
            <span>
              <CommitmentResolutionChip commitment={c} />
            </span>
          </Field>
          <Field label="Linked to" htmlFor={canLink ? "work-commitment-link" : undefined}>
            {canLink ? (
              <>
                <select
                  id="work-commitment-link"
                  className={styles.select}
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                >
                  {c.issue ? <option value="issue">Issue: {c.issue.title}</option> : null}
                  <option value="none">Nothing (operational)</option>
                  {ctx.priorityOptions.length > 0 ? (
                    <optgroup label="Priorities (open quarter)">
                      {ctx.priorityOptions.map((p) => (
                        <option key={p.id} value={`priority:${p.id}`}>
                          {p.title}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {/* A priority from an earlier quarter stays listed
                      while it is the one linked, so the select can
                      show it. */}
                  {c.priority && !ctx.priorityOptions.some((p) => p.id === c.priority!.id) ? (
                    <option value={`priority:${c.priority.id}`}>{c.priority.title}</option>
                  ) : null}
                  {ctx.functionalAreaOptions.length > 0 ? (
                    <optgroup label="Functional areas">
                      {ctx.functionalAreaOptions.map((f) => (
                        <option key={f.id} value={`functional_area:${f.id}`}>
                          {f.title}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {c.functionalArea && !ctx.functionalAreaOptions.some((f) => f.id === c.functionalArea!.id) ? (
                    <option value={`functional_area:${c.functionalArea.id}`}>{c.functionalArea.title}</option>
                  ) : null}
                </select>
                {c.issue && link === "issue" ? (
                  canOpenIssue(c.issue.id) ? (
                    <button type="button" className={styles.linkButton} onClick={() => onOpenIssue(c.issue!.id)}>
                      Open the issue
                    </button>
                  ) : (
                    <Link href={`/issues?issue=${c.issue.id}`} className={styles.linkButton}>
                      Open the issue
                    </Link>
                  )
                ) : c.priority && link === `priority:${c.priority.id}` ? (
                  <Link href={`/plan/priority/${c.priority.id}`} className={styles.linkButton}>
                    Open the priority
                  </Link>
                ) : null}
              </>
            ) : c.issue ? (
              canOpenIssue(c.issue.id) ? (
                <button type="button" className={styles.linkButton} onClick={() => onOpenIssue(c.issue!.id)}>
                  Issue: {c.issue.title}
                </button>
              ) : (
                <Link href={`/issues?issue=${c.issue.id}`} className={styles.linkButton}>
                  Issue: {c.issue.title}
                </Link>
              )
            ) : c.priority ? (
              <Link href={`/plan/priority/${c.priority.id}`} className={styles.linkButton}>
                Priority: {c.priority.title}
              </Link>
            ) : c.functionalArea ? (
              <p className={styles.readText}>Function: {c.functionalArea.title}</p>
            ) : (
              <p className={styles.muted}>Nothing</p>
            )}
          </Field>
        </div>

        <Field label="Notes">
          {canEdit ? (
            <NotesEditor key={c.id} initial={c.notes ?? null} onChange={setNotes} label="Commitment notes" />
          ) : (
            <NotesView notes={c.notes} />
          )}
        </Field>
      </div>
      {anyEdit ? <SaveBar dirty={dirty} pending={pending} saved={saved} error={error} onSave={() => void save()} /> : null}
    </>
  );
}

function linkValue(c: CommitmentWithMeta): string {
  if (c.issue) return "issue";
  if (c.priority) return `priority:${c.priority.id}`;
  if (c.functionalArea) return `functional_area:${c.functionalArea.id}`;
  return "none";
}

// Only called once the value has changed, so never "issue": an issue
// is kept, never chosen.
function linkTarget(v: string): LinkTarget {
  const [type, id] = v.split(":");
  if (type === "priority" && id) return { type: "priority", id };
  if (type === "functional_area" && id) return { type: "functional_area", id };
  return { type: "none" };
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className={styles.label}>
          {label}
        </label>
      ) : (
        <span className={styles.label}>{label}</span>
      )}
      {children}
    </div>
  );
}
