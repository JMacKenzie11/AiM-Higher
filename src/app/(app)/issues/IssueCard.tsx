"use client";

import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type HTMLAttributes,
} from "react";
import {
  createCommitmentAction,
  type CommitmentResult,
} from "@/lib/commitments/actions";
import {
  deleteIssueAction,
  renameIssueAction,
  resolveIssueAction,
  updateIssueDesiredOutcomeAction,
} from "@/lib/issues/actions";
import type { IssueWithCommitments } from "@/lib/issues/service";
import type { Priority, Profile } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { splitThread, needsReview } from "@/lib/issues/thread";
import { CommitmentRow } from "../commitments/CommitmentRow";
import type { CommitmentWithMeta } from "@/lib/commitments/service";
import styles from "./issues.module.css";

// One issue = one row. Five columns match the /commitments visual
// vocabulary: Issue | What we want | Commitment | Assigned To |
// Due Date. Drag handle on the far left, Resolve on the far right.
//
// The commitment column shows the newest open issue-linked
// commitment (there's typically one at a time for a Solution
// Seeking flow). If there's none, the last three columns collapse
// into a compact inline "add commitment" form so the meeting
// leader can capture what will move the issue forward this week
// without leaving the row.
//
// Owner-facing commitment mechanics (mark kept / reschedule /
// reassign) live on Guide HQ "My commitments" per the presentation
// rule — issue-linked commitments stay off the company /commitments
// page but are always present on personal surfaces where the owner
// interacts with them.

// `priorityOptions` is threaded straight through to CommitmentRow.
// It renders no priority here (hidePriority), but the component
// takes the list unconditionally, and the page loader already has it.

const CREATE_INITIAL: CommitmentResult = { ok: false, message: "" };

export function IssueCard({
  issue,
  roster,
  priorityOptions,
  todayIso,
  currentUserId,
  isAdmin,
  dragHandleProps,
}: {
  issue: IssueWithCommitments;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  functionalAreaOptions: Array<{ id: string; title: string }>;
  todayIso: string;
  currentUserId: string;
  currentUserCompanyId: string | null;
  isAdmin: boolean;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
}) {
  const canEdit = isAdmin || issue.created_by === currentUserId;
  // An issue is worked through a SEQUENCE of commitments. See
  // lib/issues/thread.ts for the derivation, and for why each clause
  // of the review condition is load-bearing.
  //
  // `thread.active` is deliberately not read here. It still exists
  // because the derivation has to order the open commitments somehow,
  // but this card no longer treats one of them differently from the
  // others — that distinction was the bug, not the feature.
  const thread = splitThread(issue.commitments);
  const doneCount = thread.completed.length;
  const awaitingReview = needsReview(issue, thread);
  const [expanded, setExpanded] = useState(false);

  // EVERY COMMITMENT ON AN ISSUE IS THE SAME KIND OF THING.
  //
  // The first version gave one of them the row's three commitment
  // columns and rendered the rest as second-class lines underneath.
  // That hierarchy was never in the domain — it came from the grid
  // having exactly three commitment-shaped cells — and it produced
  // three separate defects in a day: an unreachable add affordance,
  // a second commitment displacing the first, and a review prompt
  // wedged into a cell too narrow for it.
  //
  // So there is no "active" commitment any more. Every commitment is
  // a `CommitmentRow` — the same component /commitments renders — in
  // a list UNDER the issue, with the add form as the last line.
  //
  // Finished ones stay collapsed behind "N done" — the one place the
  // uniform rule bends, deliberately, because an issue with eight
  // finished commitments would otherwise bury the live ones.
  const canEditCommitment = (c: CommitmentWithMeta): boolean =>
    isAdmin || (c.owner_id !== null && c.owner_id === currentUserId);

  const openCommitments = thread.active
    ? [thread.active, ...thread.otherOpen]
    : thread.otherOpen;
  // Finished first (history above), then live. Collapsed unless the
  // "N done" toggle is open, which is the one place the uniform rule
  // still bends: eight finished commitments would bury the live ones.
  const commitmentLines =
    doneCount > 0 && expanded
      ? [...thread.completed, ...openCommitments]
      : openCommitments;

  return (
    // Anchored so /commitments can link straight to this row. There
    // is no issue detail page to link to — unlike a meeting, which
    // has one — so the row itself is the destination.
    <article className={styles.issueRow} id={`issue-${issue.id}`}>
      {/* Resolve, then delete, then drag — the same order and the
          same two columns a commitment line uses, so the controls
          for "act on this row" sit in one place on the card whether
          the row is an issue or a commitment. */}
      {canEdit ? (
        <ResolveIssueButton issueId={issue.id} />
      ) : (
        <span aria-hidden className={styles.resolvePlaceholder} />
      )}

      {isAdmin ? (
        <DeleteIssueButton issueId={issue.id} issueTitle={issue.title} />
      ) : (
        <span aria-hidden className={styles.deletePlaceholder} />
      )}

      {canEdit ? (
        <button
          type="button"
          className={styles.dragHandle}
          aria-label="Reorder this issue"
          title="Drag to reorder"
          {...dragHandleProps}
        >
          <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
            <circle cx="5" cy="4" r="1.2" fill="currentColor" />
            <circle cx="11" cy="4" r="1.2" fill="currentColor" />
            <circle cx="5" cy="8" r="1.2" fill="currentColor" />
            <circle cx="11" cy="8" r="1.2" fill="currentColor" />
            <circle cx="5" cy="12" r="1.2" fill="currentColor" />
            <circle cx="11" cy="12" r="1.2" fill="currentColor" />
          </svg>
        </button>
      ) : (
        <span aria-hidden className={styles.dragHandlePlaceholder} />
      )}

      <div className={styles.cellIssue}>
        <IssueTitleEditor issue={issue} canEdit={canEdit} />
        {/* Derived state, not a status value: unresolved, nothing
            open, at least one thing finished. */}
        {awaitingReview ? (
          <span className={styles.needsReviewBadge}>needs review</span>
        ) : null}
      </div>

      <div className={styles.cellWant}>
        <DesiredOutcomeEditor issue={issue} canEdit={canEdit} />
      </div>

      {/* The commitments region spans the FULL row and therefore
          auto-places on its own grid line, underneath the issue. It
          used to sit at `grid-column: 4 / 7`, level with the issue
          title, which put a commitment-level control inches from the
          issue-level Resolve button and made it genuinely unclear
          which one you were about to press.

          Every line here is a real `CommitmentRow` — the same
          component /commitments, Guide HQ and the priority pages
          render. Acting on a commitment is therefore identical
          wherever you meet it: the circle opens a menu and never
          resolves on click, reschedule and reason open as full-width
          strips, and the undo chip is the same 30-second chip. */}
      <div className={styles.commitments}>
        {commitmentLines.length > 0 ? <CommitmentSubHeader /> : null}

        <ul className={styles.commitmentList}>
          {commitmentLines.map((c) => (
            <CommitmentRow
              key={c.id}
              commitment={c}
              priorityOptions={priorityOptions}
              roster={roster}
              todayIso={todayIso}
              canResolve={canEditCommitment(c)}
              canReassign={canEditCommitment(c)}
              // No link picker: an issue-linked commitment has no
              // priority, and moving it off its issue belongs in the
              // issue's own context, not in a chip menu.
              canLink={false}
              hidePriority
              currentUserId={currentUserId}
              isAdmin={isAdmin}
            />
          ))}
        </ul>

        {/* The review moment, as one quiet line at the end of the
            thread rather than a block inside a narrow cell. */}
        {awaitingReview && canEdit ? (
          <ReviewPromptLine issueId={issue.id} />
        ) : null}

        {canEdit ? (
          <IssueCommitmentAddInline
            issueId={issue.id}
            roster={roster}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            todayIso={todayIso}
          />
        ) : openCommitments.length === 0 ? (
          <p className={styles.commitmentEmpty}>No commitment yet.</p>
        ) : null}

        {doneCount > 0 ? (
          <button
            type="button"
            className={styles.threadToggle}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} ${doneCount} finished commitment${doneCount === 1 ? "" : "s"}`}
          >
            {expanded ? "hide finished" : `${doneCount} done`}
          </button>
        ) : null}
      </div>

    </article>
  );
}

// Labels the commitment columns inside one issue.
//
// EIGHT cells for SEVEN columns, deliberately: these rows are
// `hidePriority`, which means `.rowNoPriority` — a seven-column
// template that hides the sixth CHILD rather than renumbering
// anything. So the priority spacer has to be present to be hidden,
// exactly as CommitmentRow renders it. Drop it and every cell after
// it shifts one column left, which is precisely what was wrong:
// this composed the eight-column header while the rows beneath
// composed the seven-column one, so ASSIGNED TO sat two columns
// away from the owners it named.
export function CommitmentSubHeader() {
  return (
    <div className={styles.commitmentSubHeader} role="row" aria-hidden="true">
      <span aria-hidden />
      <span aria-hidden />
      <span aria-hidden />
      <span>Commitment</span>
      <span>Assigned to</span>
      <span aria-hidden />
      <span>Due date</span>
      <span>Status</span>
    </div>
  );
}

// Auto-size a textarea to fit its content. Fixed `rows` clips long
// text on open ("shrinks" the cell); this resets height to auto +
// scrollHeight on every keystroke so the box grows and shrinks with
// the value. Runs in useLayoutEffect so the sizing lands before
// paint — no visible jump on mount.
function useAutoResize(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  active: boolean,
  value: string
) {
  useLayoutEffect(() => {
    if (!active || !ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [ref, active, value]);
}

// ---- Inline editors -------------------------------------------

function IssueTitleEditor({
  issue,
  canEdit,
}: {
  issue: IssueWithCommitments;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(issue.title);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(inputRef, editing, draft);

  useEffect(() => {
    setDraft(issue.title);
  }, [issue.title]);

  function commit() {
    if (pending) return;
    const next = draft.trim();
    if (!next || next === issue.title) {
      setDraft(issue.title);
      setEditing(false);
      setError(null);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await renameIssueAction(issue.id, next);
      if (!result.ok) setError(result.message);
      else setEditing(false);
    });
  }

  if (!canEdit) {
    return <span className={styles.issueTitle}>{issue.title}</span>;
  }
  if (editing) {
    return (
      <>
        <textarea
          ref={inputRef}
          className={styles.issueTitleInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          rows={1}
          onKeyDown={(e) => {
            // Enter commits (titles are single-thought lines, not
            // paragraphs) — matches the click-and-type UX of the
            // original single-line input. Escape reverts.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(issue.title);
              setEditing(false);
              setError(null);
            }
          }}
          autoFocus
          disabled={pending}
          aria-label="Edit issue title"
        />
        {error ? (
          <p role="alert" className={styles.rowError}>
            {error}
          </p>
        ) : null}
      </>
    );
  }
  return (
    <button
      type="button"
      className={styles.issueTitleEditable}
      onClick={() => setEditing(true)}
      title="Click to rename"
      // Safari skips <button> from the default tab order (only inputs/
      // textareas are included unless the user turned on Full Keyboard
      // Access system-wide). tabIndex={0} forces Safari to tab into
      // this button so the click-to-edit row is keyboard-navigable
      // across every browser.
      tabIndex={0}
    >
      {issue.title}
    </button>
  );
}

function DesiredOutcomeEditor({
  issue,
  canEdit,
}: {
  issue: IssueWithCommitments;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(issue.desired_outcome ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const emptyRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(editRef, editing, draft);
  useAutoResize(emptyRef, !issue.desired_outcome && !editing, draft);

  useEffect(() => {
    setDraft(issue.desired_outcome ?? "");
  }, [issue.desired_outcome]);

  function commit() {
    if (pending) return;
    if (draft.trim() === (issue.desired_outcome ?? "").trim()) {
      setEditing(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateIssueDesiredOutcomeAction(issue.id, draft);
      if (!result.ok) setError(result.message);
      else setEditing(false);
    });
  }

  if (!canEdit) {
    return issue.desired_outcome ? (
      <span className={styles.wantText}>{issue.desired_outcome}</span>
    ) : (
      <span className={styles.wantMuted}>Not yet defined.</span>
    );
  }
  // Empty state renders the same dashed-textarea shape as the
  // Commitment add cell, so the two "please fill me in" surfaces
  // look identical instead of one being a muted italic prompt.
  // Focus is left to the user; onBlur saves what they typed.
  if (!issue.desired_outcome && !editing) {
    return (
      <>
        <textarea
          ref={emptyRef}
          className={styles.commitmentAddInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft("");
              setError(null);
            }
          }}
          placeholder="What's the outcome you want here?"
          disabled={pending}
          aria-label="What we want"
        />
        {error ? (
          <p role="alert" className={styles.rowError}>
            {error}
          </p>
        ) : null}
      </>
    );
  }
  if (editing) {
    return (
      <>
        <textarea
          ref={editRef}
          className={styles.wantInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(issue.desired_outcome ?? "");
              setEditing(false);
              setError(null);
            }
          }}
          autoFocus
          disabled={pending}
          aria-label="What we want"
        />
        {error ? (
          <p role="alert" className={styles.rowError}>
            {error}
          </p>
        ) : null}
      </>
    );
  }
  return (
    <button
      type="button"
      className={styles.wantEditable}
      onClick={() => setEditing(true)}
      title="Click to edit"
      tabIndex={0}
    >
      {issue.desired_outcome}
    </button>
  );
}

function ResolveIssueButton({ issueId }: { issueId: string }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setConfirming(false);
    setError(null);
    startTransition(async () => {
      const result = await resolveIssueAction(issueId);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <>
      {/* The same circle a commitment carries, in the same column,
          so "resolve this thing" is one gesture with one look
          wherever you meet it. No menu: an issue cannot be parked or
          rescheduled, so a menu of one item is a click in the way.
          It still never resolves on the click — the confirm dialog
          below is the second gesture, which is what the commitment
          circle's menu is doing too. */}
      <button
        type="button"
        className={styles.issueResolveCircle}
        onClick={() => setConfirming(true)}
        disabled={pending}
        title="Resolve this issue"
        aria-label="Resolve this issue"
      >
        <span aria-hidden className={styles.issueResolveCheck}>
          ✓
        </span>
      </button>
      <ConfirmDialog
        open={confirming}
        title="Resolve this issue?"
        message="It moves off the open list. Any open commitments on it stay live and remain yours to resolve as normal."
        confirmLabel="Resolve"
        tone="primary"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
      {error ? (
        <p role="alert" className={styles.rowError}>
          {error}
        </p>
      ) : null}
    </>
  );
}

/// Admin/guide-only hard delete. Uses the same trash-icon +
// confirm-dialog pattern as the /commitments row so the two
// surfaces read as siblings. Delete cascades issue_id → null on
// any linked commitments (FK behavior from migration 0143), so
// the commitments stay live and just lose their link.
function DeleteIssueButton({
  issueId,
  issueTitle,
}: {
  issueId: string;
  issueTitle: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setConfirming(false);
    setError(null);
    startTransition(async () => {
      const result = await deleteIssueAction(issueId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // revalidatePath() marks /issues stale server-side, but the
      // client route cache still shows the deleted row until the
      // router picks up the new tree. router.refresh() forces the
      // re-render immediately so the row disappears without a
      // page reload.
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        className={styles.deleteButton}
        onClick={() => setConfirming(true)}
        disabled={pending}
        aria-label="Delete this issue"
        title="Delete this issue"
      >
        <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
          <path
            d="M4 5 h8 v8 a1 1 0 0 1 -1 1 h-6 a1 1 0 0 1 -1 -1 z M6.5 5 V3.5 a1 1 0 0 1 1 -1 h1 a1 1 0 0 1 1 1 V5 M3 5 h10"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <ConfirmDialog
        open={confirming}
        title="Delete this issue?"
        message={`This can't be undone. "${issueTitle}" will be removed from the list. Any linked commitments stay live but lose their issue linkage.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={run}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
      {error ? (
        <p role="alert" className={styles.rowError}>
          {error}
        </p>
      ) : null}
    </>
  );
}

// Inline commitment-add: fills the three commitment/owner/due
// cells in place when the issue has no open commitment. The form
// action fires createCommitmentAction (which also autoscores the
// commitment's clarity), and revalidates /issues so the row
// rerenders in the "show active" branch on the next paint.
//
// Submit triggers: the "Add" pill under the textarea, or Cmd/Ctrl+
// Enter from inside the textarea. A bare Enter inserts a newline
// (matches the click-to-edit description behavior used elsewhere)
// so multi-sentence commitments can be typed inline.
function IssueCommitmentAddInline({
  issueId,
  roster,
  currentUserId,
  isAdmin,
  todayIso,
}: {
  issueId: string;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  currentUserId: string;
  isAdmin: boolean;
  todayIso: string;
}) {
  const [state, formAction, pending] = useActionState<
    CommitmentResult,
    FormData
  >(createCommitmentAction, CREATE_INITIAL);
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState<string>(currentUserId);
  const [dueDate, setDueDate] = useState(todayIso);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useAutoResize(inputRef, true, description);
  const errorMessage =
    state && "ok" in state && !state.ok && state.message ? state.message : null;

  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      setDescription("");
      setDueDate(todayIso);
      setOwnerId(currentUserId);
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Blur-save: only submit when focus leaves the form entirely
  // (not when the user tabs between description → owner → date).
  // setTimeout defers the check by a tick so document.activeElement
  // has settled on the NEW focus target — if it's still inside this
  // form, we're just tabbing between fields and shouldn't submit.
  const formId = `add-cmt-${issueId}`;
  const inputId = `${formId}-description`;

  function maybeAutoSubmit() {
    setTimeout(() => {
      const active = document.activeElement;
      const stillInForm =
        active instanceof HTMLElement &&
        (active.getAttribute("form") === formId ||
          active.closest(`form[id="${formId}"]`) !== null);
      if (stillInForm) return;
      if (!description.trim() || pending) return;
      formRef.current?.requestSubmit();
    }, 0);
  }

  return (
    <>
      {/* ONE grid row on the same eight columns a CommitmentRow
          uses, so the plus sits in the resolve-circle column and the
          field, owner and date land under the headers above them.
          The owner and date controls live inside the form now; they
          used to be siblings placed by subgrid, which the region no
          longer is. */}
      <form
        id={formId}
        ref={formRef}
        action={formAction}
        className={styles.addLine}
      >
        <input type="hidden" name="issue_id" value={issueId} />
        <input type="hidden" name="owner_id" value={ownerId} />
        <input type="hidden" name="due_date" value={dueDate} />

        {/* Every cell below is placed by an EXPLICIT grid-column.
            This line used to lean on `.rowNoPriority > :nth-child(6)`
            to hide the priority slot, the way CommitmentRow does —
            but :nth-child counts every element child, and this form
            carries three `<input type="hidden">` before its first
            cell. That shifted the count by three, so the rule hid
            the wrong element, the date landed in the STATUS column
            and the Add button wrapped onto a row of its own.

            Columns 1-3 (resolve, delete, clarity) are simply empty:
            there is no commitment on this line yet, so there is
            nothing to resolve, delete or score. */}
        <textarea
          id={inputId}
          ref={inputRef}
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={maybeAutoSubmit}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setDescription("");
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (description.trim()) formRef.current?.requestSubmit();
            }
          }}
          className={`${styles.commitmentAddInput} ${styles.addDescription}`}
          placeholder="What will move this forward this week?"
          required
          disabled={pending}
          aria-label="New commitment"
        />

        {isAdmin ? (
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            onBlur={maybeAutoSubmit}
            className={`${styles.commitmentAddSelect} ${styles.addOwner}`}
            disabled={pending}
            aria-label="Owner"
          >
            {roster.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        ) : (
          <span className={styles.addOwner}>
            {roster.find((p) => p.id === currentUserId)?.full_name ?? "You"}
          </span>
        )}

        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          onBlur={maybeAutoSubmit}
          className={`${styles.commitmentAddDate} ${styles.addDue}`}
          disabled={pending}
          aria-label="Due date"
        />

        {/* Says what it does. Same control /commitments has had all
            along: filled, labelled, and disabled until there is
            something to add. Blur-save still works; this is for
            people who want a button to press. */}
        <button
          type="submit"
          className={styles.addSubmit}
          disabled={pending || !description.trim()}
        >
          {pending ? "Saving…" : "Add"}
        </button>

        {errorMessage ? (
          <p role="alert" className={styles.addLineError}>
            {errorMessage}
          </p>
        ) : null}
      </form>
    </>
  );
}

// ---- The thread ------------------------------------------------





// The review moment. One line spanning the region, because it is a
// question about the ISSUE rather than about a commitment — and
// because wedging a question and two buttons into the commitment
// column is what made the first version look cluttered.
function ReviewPromptLine({ issueId }: { issueId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resolve() {
    setError(null);
    startTransition(async () => {
      const result = await resolveIssueAction(issueId);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className={styles.reviewLine}>
      <span className={styles.reviewAsk}>Did this solve it?</span>
      <button
        type="button"
        className={styles.reviewResolve}
        onClick={resolve}
        disabled={pending}
      >
        {pending ? "Resolving…" : "Resolve issue"}
      </button>
      <span className={styles.reviewOr}>or add another commitment below</span>
      {error ? (
        <span role="alert" className={styles.commitmentError}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

// ---- Inline editors for a commitment ----------------------------
// Click-to-edit description / owner / due date so an issue-linked
// commitment can be tuned without leaving the /issues row. These
// three fields stay editable for as long as the issue is on the
// open list; Resolve moves the issue off this page and the row
// stops rendering entirely.
