"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import type { Mark as PMMark, Node as PMNode } from "@tiptap/pm/model";
import { useEffect, useRef, useState } from "react";
import { cleanNotes, safeHref, type NotesDoc } from "@/lib/notes/clean";
import editorStyles from "@/components/tiptap/Editor.module.css";
import styles from "./notes.module.css";

// THE NOTES EDITOR, for an issue and a commitment (0287). One
// component for both.
//
// TipTap, as Classroom's lesson editor is, with everything switched
// off but the five kinds of formatting notes may hold: bold, italic,
// bullet and numbered lists, links. ProseMirror's schema drops
// anything else on paste, and the server cleans again before it saves
// (lib/notes/clean.ts), so the editor is a convenience, never the
// boundary.
//
// Remount it (a new `key`) to load a different note. It reports every
// change; the drawer's Save button decides when to write.

export function NotesEditor({
  initial,
  onChange,
  label = "Notes",
  disabled = false,
}: {
  initial: NotesDoc | null | undefined;
  onChange: (doc: NotesDoc | null) => void;
  label?: string;
  disabled?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        strike: false,
        underline: false,
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
          protocols: ["http", "https", "mailto"],
        },
      }),
    ],
    content: initial ?? { type: "doc", content: [{ type: "paragraph" }] },
    editable: !disabled,
    immediatelyRender: false,
    // Read the document with our own walker, as the lesson editor does:
    // getJSON() has dropped a link's href on some TipTap 3 versions.
    onUpdate: ({ editor }) => onChange(cleanNotes(pmToJson(editor.state.doc))),
    editorProps: {
      attributes: {
        class: `${editorStyles.editorSurface} ${styles.surface}`,
        "aria-label": label,
        "aria-multiline": "true",
        role: "textbox",
      },
    },
  });

  if (!editor) return <div className={styles.loading} aria-hidden />;

  return (
    <div className={`${editorStyles.wrap} ${styles.wrap}`}>
      {disabled ? null : <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const savedRange = useRef<{ from: number; to: number } | null>(null);
  // Re-render on selection changes so the buttons show what is on.
  const [, force] = useState(0);
  useEffect(() => {
    const bump = () => force((n) => n + 1);
    editor.on("transaction", bump);
    return () => {
      editor.off("transaction", bump);
    };
  }, [editor]);

  const button = (opts: { label: string; text: React.ReactNode; active: boolean; run: () => void }) => (
    <button
      type="button"
      className={editorStyles.toolbarButton}
      data-active={opts.active ? "true" : "false"}
      aria-pressed={opts.active}
      aria-label={opts.label}
      title={opts.label}
      // Keep the editor's selection: a mousedown on a button would
      // otherwise move focus and lose it before the click lands.
      onMouseDown={(e) => e.preventDefault()}
      onClick={opts.run}
    >
      {opts.text}
    </button>
  );

  function openLink() {
    const { from, to } = editor.state.selection;
    const active = editor.isActive("link");
    if (!active && from === to) {
      setLinkError("Select the words you want to link first.");
      return;
    }
    setLinkError(null);
    savedRange.current = { from, to };
    setLinkValue(active ? ((editor.getAttributes("link").href as string | undefined) ?? "") : "");
    setLinkOpen(true);
  }

  // A raw mark on the saved range, as the lesson editor does: the
  // input took focus, so the editor's own selection is gone.
  function applyLink() {
    const range = savedRange.current;
    const markType = editor.schema.marks.link;
    if (!range || !markType) {
      setLinkOpen(false);
      return;
    }
    const raw = linkValue.trim();
    const withScheme = raw && !/^[a-z]+:/i.test(raw) ? (raw.includes("@") ? `mailto:${raw}` : `https://${raw}`) : raw;
    const href = withScheme ? safeHref(withScheme) : null;
    if (raw && !href) {
      setLinkError("Use a web address or an email address.");
      return;
    }
    const doc = editor.state.doc;
    const from = Math.max(0, Math.min(range.from, doc.content.size));
    const to = Math.max(from, Math.min(range.to, doc.content.size));
    const tr = editor.state.tr.setSelection(TextSelection.create(doc, from, to));
    tr.removeMark(from, to, markType);
    if (href) tr.addMark(from, to, markType.create({ href }));
    editor.view.dispatch(tr);
    editor.view.focus();
    savedRange.current = null;
    setLinkOpen(false);
    setLinkValue("");
    setLinkError(null);
  }

  return (
    <>
      <div className={editorStyles.toolbar} role="toolbar" aria-label="Formatting">
        {button({ label: "Bold", text: <b>B</b>, active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() })}
        {button({ label: "Italic", text: <i>I</i>, active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() })}
        <span className={editorStyles.toolbarSep} aria-hidden />
        {button({ label: "Bulleted list", text: "•", active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() })}
        {button({ label: "Numbered list", text: "1.", active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() })}
        <span className={editorStyles.toolbarSep} aria-hidden />
        {button({ label: "Link", text: "Link", active: editor.isActive("link"), run: openLink })}
      </div>
      {linkOpen ? (
        <div className={styles.linkRow}>
          <input
            type="text"
            inputMode="url"
            className={styles.linkInput}
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setLinkOpen(false);
                editor.commands.focus();
              }
            }}
            placeholder="Paste a web or email address"
            aria-label="Link address"
            autoFocus
          />
          <button type="button" className={styles.linkApply} onClick={applyLink}>
            {linkValue.trim() ? "Apply" : "Remove link"}
          </button>
        </div>
      ) : null}
      {linkError ? (
        <p role="alert" className={styles.linkError}>
          {linkError}
        </p>
      ) : null}
    </>
  );
}

type Json = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: Json[]; content?: Json[] };

function pmToJson(node: PMNode): Json {
  const json: Json = { type: node.type.name };
  if (Object.keys(node.attrs ?? {}).length > 0) json.attrs = { ...node.attrs };
  if (node.marks.length > 0) json.marks = node.marks.map(markToJson);
  if (node.isText) json.text = node.text ?? "";
  else if (node.content.size > 0) {
    const content: Json[] = [];
    node.content.forEach((child) => content.push(pmToJson(child)));
    json.content = content;
  }
  return json;
}

function markToJson(mark: PMMark): Json {
  const out: Json = { type: mark.type.name };
  if (Object.keys(mark.attrs ?? {}).length > 0) out.attrs = { ...mark.attrs };
  return out;
}
