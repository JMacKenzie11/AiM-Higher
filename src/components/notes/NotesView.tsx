import type { ReactNode } from "react";
import { cleanNotes, safeHref, type NotesMark, type NotesNode } from "@/lib/notes/clean";
import styles from "./notes.module.css";

// Notes, read-only, for someone who cannot edit them.
//
// Drawn as React elements from the cleaned tree, never as HTML, and
// cleaned again on the way in so a row written before the cleaner, or
// by hand, still shows only the five kinds of formatting.

export function NotesView({ notes }: { notes: unknown }) {
  const doc = cleanNotes(notes);
  if (!doc) return <p className={styles.empty}>No notes yet.</p>;
  return <div className={styles.view}>{(doc.content ?? []).map((n, i) => block(n, `b${i}`))}</div>;
}

function block(n: NotesNode, key: string): ReactNode {
  const kids = (n.content ?? []).map((c, i) => (c.type === "text" || c.type === "hardBreak" ? inline(c, `${key}.${i}`) : block(c, `${key}.${i}`)));
  switch (n.type) {
    case "paragraph":
      return <p key={key}>{kids}</p>;
    case "bulletList":
      return <ul key={key}>{kids}</ul>;
    case "orderedList":
      return (
        <ol key={key} start={n.attrs?.start ?? 1}>
          {kids}
        </ol>
      );
    case "listItem":
      return <li key={key}>{kids}</li>;
    default:
      return null;
  }
}

function inline(n: NotesNode, key: string): ReactNode {
  if (n.type === "hardBreak") return <br key={key} />;
  let out: ReactNode = n.text ?? "";
  for (const m of n.marks ?? []) out = mark(m, out, key);
  return <span key={key}>{out}</span>;
}

function mark(m: NotesMark, child: ReactNode, key: string): ReactNode {
  if (m.type === "bold") return <strong key={`${key}b`}>{child}</strong>;
  if (m.type === "italic") return <em key={`${key}i`}>{child}</em>;
  const href = safeHref(m.attrs.href);
  return href ? (
    <a key={`${key}l`} href={href} target="_blank" rel="noopener noreferrer">
      {child}
    </a>
  ) : (
    child
  );
}
