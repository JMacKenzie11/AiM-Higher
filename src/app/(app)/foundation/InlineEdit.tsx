"use client";

import {
  useActionState,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  deleteFoundationItemAction,
  deleteSnippetAction,
  updateFoundationItemAction,
  updateSnippetAction,
  type Result,
} from "@/lib/foundation/actions";
import type { FoundationItem, MarketingSnippet } from "@/lib/types";
import { DeleteButton } from "./DeleteButton";
import styles from "./foundation.module.css";

// The text of a numbered card on the One-Page Plan, edited in place.
// Edit turns the text itself into fields of the same size, in the same
// spot, with Save and Cancel where Edit and Delete were. Nothing opens
// below the card, and the card closes only once the save went through,
// so a failed save keeps what was typed.

const INITIAL_ITEM: Result<FoundationItem> = { ok: false, message: "" };
const INITIAL_SNIPPET: Result<MarketingSnippet> = { ok: false, message: "" };

export function EditableFoundationItem({
  item,
  canEdit,
  confirmMessage,
  titleLabel,
  bodyLabel,
}: {
  item: FoundationItem;
  canEdit: boolean;
  confirmMessage: string;
  titleLabel: string;
  bodyLabel: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateFoundationItemAction,
    INITIAL_ITEM
  );
  const [editing, setEditing] = useState(false);
  useCloseOnSave(state, setEditing);

  if (!editing) {
    return (
      <>
        <h3 className={styles.h3}>{item.title}</h3>
        {item.body ? <p className={styles.bodyText}>{item.body}</p> : null}
        {canEdit ? (
          <div className={styles.subcardActions}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <DeleteButton
              action={deleteFoundationItemAction}
              itemId={item.id}
              confirmMessage={confirmMessage}
            />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <form action={formAction} className={styles.inlineForm}>
      <input type="hidden" name="id" value={item.id} />
      <input
        name="title"
        required
        aria-label={titleLabel}
        defaultValue={item.title}
        className={styles.inlineTitle}
        disabled={pending}
        autoFocus
      />
      <AutoSizeTextarea
        name="body"
        label={bodyLabel}
        defaultValue={item.body ?? ""}
        disabled={pending}
      />
      <InlineActions
        pending={pending}
        error={errorOf(state)}
        onCancel={() => setEditing(false)}
      />
    </form>
  );
}

export function EditableSnippet({
  snippet,
  canEdit,
  label,
}: {
  snippet: MarketingSnippet;
  canEdit: boolean;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateSnippetAction,
    INITIAL_SNIPPET
  );
  const [editing, setEditing] = useState(false);
  useCloseOnSave(state, setEditing);

  if (!editing) {
    return (
      <>
        {/* ICP snippets have no separate title, so the text is body
            copy rather than an h3 headline. */}
        <p className={styles.bodyText}>{snippet.content}</p>
        {canEdit ? (
          <div className={styles.subcardActions}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <DeleteButton
              action={deleteSnippetAction}
              itemId={snippet.id}
              confirmMessage="Remove this entry?"
            />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <form action={formAction} className={styles.inlineForm}>
      <input type="hidden" name="id" value={snippet.id} />
      <AutoSizeTextarea
        name="content"
        label={label}
        defaultValue={snippet.content}
        disabled={pending}
        required
        autoFocus
      />
      <InlineActions
        pending={pending}
        error={errorOf(state)}
        onCancel={() => setEditing(false)}
      />
    </form>
  );
}

function errorOf<T>(state: Result<T>): string | null {
  return !state.ok && state.message ? state.message : null;
}

// A successful save returns a new { ok: true } state; that is the
// moment to go back to reading.
function useCloseOnSave<T>(
  state: Result<T>,
  setEditing: (editing: boolean) => void
) {
  useEffect(() => {
    if (state.ok) setEditing(false);
  }, [state, setEditing]);
}

// Grows with its text, so the field is the size of what it replaced
// and the whole entry is visible without scrolling inside the box.
function AutoSizeTextarea({
  name,
  label,
  defaultValue,
  disabled,
  required,
  autoFocus,
}: {
  name: string;
  label: string;
  defaultValue: string;
  disabled: boolean;
  required?: boolean;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  useLayoutEffect(fit, []);

  return (
    <textarea
      ref={ref}
      name={name}
      aria-label={label}
      defaultValue={defaultValue}
      className={styles.inlineBody}
      onInput={fit}
      rows={1}
      disabled={disabled}
      required={required}
      autoFocus={autoFocus}
    />
  );
}

function InlineActions({
  pending,
  error,
  onCancel,
}: {
  pending: boolean;
  error: string | null;
  onCancel: () => void;
}) {
  return (
    <>
      {error ? (
        <p role="alert" className={styles.errorMessage}>
          {error}
        </p>
      ) : null}
      <div className={styles.subcardActions}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className={styles.ghostButton}
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </button>
      </div>
    </>
  );
}
