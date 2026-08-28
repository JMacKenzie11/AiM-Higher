"use client";

import { useEditor, EditorContent, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { useEffect, useRef, useState } from "react";
import { VideoEmbed } from "./nodes/VideoEmbed";
import { ImageEmbed } from "./nodes/ImageEmbed";
import { TextAlign } from "./extensions/TextAlign";

// Link is included by StarterKit v3 — we configure it via the
// starter kit's `link` option below rather than importing
// @tiptap/extension-link separately. Registering both creates a
// duplicate-name conflict ("[tiptap warn] Duplicate extension
// names found: ['link']") which quietly broke setLink so the
// mark landed with no href attribute.
import { parseVideoUrl } from "@/lib/classroom/video-url";
import { uploadClassroomImageAction } from "@/lib/classroom/actions";
import styles from "./Editor.module.css";

// TipTap-based rich text editor. Client-side only — the editor bundle
// never ships to consumer pages, which render via the Renderer using
// a JSON walker.
//
// Body is stored as TipTap JSON in classroom_trainings.body_json.
// StarterKit gives headings, bold/italic/strike/code, bullet + ordered
// lists, blockquote, hr, hard break. VideoEmbed is a custom node for
// inline YouTube / Vimeo videos (see nodes/VideoEmbed.ts).
//
// immediatelyRender:false is required under Next.js SSR to avoid a
// hydration mismatch — TipTap v3 documents this explicitly.

export type EditorJSON = JSONContent;

export function TipTapEditor({
  initial,
  onChange,
  placeholder,
}: {
  initial: EditorJSON | null;
  onChange: (json: EditorJSON) => void;
  placeholder?: string;
}) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: {
            target: "_blank",
            rel: "noopener noreferrer",
          },
          protocols: ["http", "https", "mailto"],
        },
      }),
      VideoEmbed,
      ImageEmbed,
      TextAlign,
    ],
    content: initial ?? emptyDoc(),
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON());
    },
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: styles.editorSurface,
        "aria-label": placeholder ?? "Section body",
      },
      // Two paste shapes we handle:
      //   1. Clipboard contains an image file — upload and insert.
      //   2. Clipboard contains a YouTube/Vimeo URL on a blank line —
      //      swap for a videoEmbed node.
      handlePaste: (view, event) => {
        const imageFile = pickImageFromClipboard(event.clipboardData);
        if (imageFile) {
          event.preventDefault();
          void uploadAndInsertImage(imageFile, editor as Editor | null, setUploadError);
          return true;
        }
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;
        const parsed = parseVideoUrl(text);
        if (!parsed) return false;
        // If we don't own the selection start, let the default
        // handler put the text where the user is typing.
        const { $from } = view.state.selection;
        if (!$from.parent.isTextblock || $from.parent.textContent.length > 0) {
          return false;
        }
        event.preventDefault();
        // insertVideoEmbed lives on our custom node's commands
        (editor as Editor | null)
          ?.chain()
          .focus()
          .insertVideoEmbed({
            provider: parsed.provider,
            videoId: parsed.id,
            caption: null,
          })
          .run();
        return true;
      },
      // Also intercept drops of image files from the OS finder.
      handleDrop: (_view, event) => {
        const file = event.dataTransfer?.files?.[0];
        if (!file || !file.type.startsWith("image/")) return false;
        event.preventDefault();
        void uploadAndInsertImage(file, editor as Editor | null, setUploadError);
        return true;
      },
    },
  });

  // Reset the editor when the initial content changes from outside
  // (e.g., navigating between sections without a full remount).
  useEffect(() => {
    if (!editor) return;
    if (initial && editor.isEmpty) {
      editor.commands.setContent(initial);
    }
  }, [editor, initial]);

  if (!editor) {
    return <div className={styles.loading}>Loading editor…</div>;
  }

  return (
    <div className={styles.wrap}>
      <Toolbar editor={editor} onUploadError={setUploadError} />
      {uploadError ? (
        <p role="alert" className={styles.uploadError}>
          {uploadError}
        </p>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}

function pickImageFromClipboard(
  data: DataTransfer | null
): File | null {
  if (!data) return null;
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i]!;
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

async function uploadAndInsertImage(
  file: File,
  editor: Editor | null,
  onError: (msg: string | null) => void
): Promise<void> {
  if (!editor) return;
  onError(null);
  const fd = new FormData();
  fd.append("file", file);
  const result = await uploadClassroomImageAction(fd);
  if (!result.ok) {
    onError(result.message);
    return;
  }
  editor
    .chain()
    .focus()
    .insertImageEmbed({ src: result.url, alt: null, width: null })
    .run();
}

function emptyDoc(): EditorJSON {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

// ------- Toolbar -------

function Toolbar({
  editor,
  onUploadError,
}: {
  editor: Editor;
  onUploadError: (msg: string | null) => void;
}) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Inline link editor state. Opening the input captures the current
  // ProseMirror selection so we can restore it on Apply — the input
  // element steals focus (moves ProseMirror's selection off the
  // text), so without an explicit restore setMark would apply to
  // zero characters. See earlier bug where window.prompt did the
  // same thing.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const savedRange = useRef<{ from: number; to: number } | null>(null);

  function openLinkEditor() {
    const { from, to } = editor.state.selection;
    const isActive = editor.isActive("link");
    if (!isActive && from === to) {
      onUploadError(
        "Select the text you want to link first."
      );
      return;
    }
    onUploadError(null);
    savedRange.current = { from, to };
    setLinkValue(
      isActive
        ? ((editor.getAttributes("link").href as string | undefined) ?? "")
        : ""
    );
    setLinkOpen(true);
  }

  function applyLink() {
    const range = savedRange.current;
    if (!range) {
      setLinkOpen(false);
      return;
    }
    const trimmed = linkValue.trim();

    // Directly dispatch a ProseMirror TextSelection so the state
    // is unambiguously set to the captured range before setLink
    // runs. Every chain-based approach so far has left the mark
    // applied to an empty caret (mark stored with no href attr,
    // then stripped by sanitize on save).
    const doc = editor.state.doc;
    const from = Math.max(0, Math.min(range.from, doc.content.size));
    const to = Math.max(from, Math.min(range.to, doc.content.size));
    const tr = editor.state.tr.setSelection(
      TextSelection.create(doc, from, to)
    );
    editor.view.dispatch(tr);
    editor.view.focus();

    // Raw ProseMirror mark op — skip Tiptap's setMark/unsetMark
    // command abstractions entirely. The link mark type comes from
    // the schema; we .create() an instance with our attrs and
    // addMark/removeMark it on the range. This is what setMark
    // eventually calls under the hood, but by doing it ourselves
    // we know exactly what's on the mark.
    const markType = editor.schema.marks.link;
    let ok = true;
    if (!markType) {
      ok = false;
    } else {
      const tr2 = editor.state.tr;
      if (!trimmed) {
        tr2.removeMark(from, to, markType);
      } else {
        const mark = markType.create({ href: trimmed });
        tr2.removeMark(from, to, markType); // clear any existing first
        tr2.addMark(from, to, mark);
      }
      editor.view.dispatch(tr2);
    }
    // eslint-disable-next-line no-console
    console.log(
      "[link] post-addMark client JSON\n" +
        JSON.stringify(editor.getJSON(), null, 2)
    );
    // eslint-disable-next-line no-console
    console.log(
      "[link] post-addMark client HTML\n" + editor.getHTML()
    );
    // eslint-disable-next-line no-console
    console.log(
      "[link] mark type attrs schema:",
      Object.keys(editor.schema.marks.link?.spec.attrs ?? {})
    );
    if (!ok) {
      onUploadError(
        "That URL doesn't look right. Use https://, http://, or a mailto: address."
      );
      return;
    }
    savedRange.current = null;
    setLinkOpen(false);
    setLinkValue("");
  }

  function cancelLink() {
    // Restore the selection so the user can retry easily.
    if (savedRange.current) {
      editor.chain().focus().setTextSelection(savedRange.current).run();
    }
    savedRange.current = null;
    setLinkOpen(false);
    setLinkValue("");
  }

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
      <ToolbarButton
        label="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <s>S</s>
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        label="Heading 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        label="Heading 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        label="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        •
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.
      </ToolbarButton>
      <ToolbarButton
        label="Blockquote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        ❝
      </ToolbarButton>
      <ToolbarButton
        label={editor.isActive("link") ? "Edit or remove link" : "Insert link"}
        active={editor.isActive("link") || linkOpen}
        onClick={() => (linkOpen ? cancelLink() : openLinkEditor())}
      >
        🔗
      </ToolbarButton>
      {linkOpen ? (
        <span className={styles.linkPopover} role="group" aria-label="Link URL">
          <input
            type="url"
            autoFocus
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelLink();
              }
            }}
            placeholder="https:// or mailto:"
            className={styles.linkInput}
            aria-label="URL"
          />
          <button
            type="button"
            className={styles.linkApply}
            onClick={applyLink}
          >
            Apply
          </button>
          <button
            type="button"
            className={styles.linkCancel}
            onClick={cancelLink}
            aria-label="Cancel"
          >
            ×
          </button>
        </span>
      ) : null}
      <ToolbarSeparator />
      <AlignButton editor={editor} value="left" label="Align left" glyph="⇤" />
      <AlignButton editor={editor} value="center" label="Align center" glyph="⇔" />
      <AlignButton editor={editor} value="right" label="Align right" glyph="⇥" />
      <ToolbarSeparator />
      <ToolbarButton
        label="Insert YouTube or Vimeo video"
        onClick={() => insertVideoPrompt(editor)}
      >
        ▶
      </ToolbarButton>
      <ToolbarButton
        label="Insert image"
        onClick={() => imageInputRef.current?.click()}
      >
        🖼
      </ToolbarButton>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            void uploadAndInsertImage(file, editor, onUploadError);
          }
          if (imageInputRef.current) imageInputRef.current.value = "";
        }}
      />
      <ToolbarSeparator />
      <ToolbarButton
        label="Undo"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      >
        ⟲
      </ToolbarButton>
      <ToolbarButton
        label="Redo"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      >
        ⟳
      </ToolbarButton>
    </div>
  );
}

// Explicit "Insert video" toolbar action. Prompts for the URL,
// parses it, and inserts a videoEmbed node. window.prompt is a
// spare UI on purpose — we can promote it to a proper dialog if
// authors ask for a caption field up-front.
function insertVideoPrompt(editor: Editor): void {
  const input = window.prompt(
    "Paste a YouTube or Vimeo video URL:",
    ""
  );
  if (!input) return;
  const parsed = parseVideoUrl(input);
  if (!parsed) {
    window.alert(
      "That URL doesn't look like a YouTube or Vimeo link. Try a share URL instead."
    );
    return;
  }
  editor
    .chain()
    .focus()
    .insertVideoEmbed({
      provider: parsed.provider,
      videoId: parsed.id,
      caption: null,
    })
    .run();
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.toolbarButton}
      aria-label={label}
      title={label}
      data-active={active ? "true" : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ToolbarSeparator() {
  return <span className={styles.toolbarSep} aria-hidden="true" />;
}

// Single alignment button that dispatches to whichever node the
// selection is on. For text (paragraph/heading) it uses the
// TextAlign extension's setTextAlign; when an image is selected
// it targets the image node's align attr instead. That way the
// buttons "just work" whether the caret is in text or on an
// image without a separate image-alignment control.
function AlignButton({
  editor,
  value,
  label,
  glyph,
}: {
  editor: Editor;
  value: "left" | "center" | "right";
  label: string;
  glyph: string;
}) {
  const imageSelected = editor.isActive("image");
  const active = imageSelected
    ? editor.isActive("image", { align: value })
    : editor.isActive({ textAlign: value });
  return (
    <ToolbarButton
      label={label}
      active={active}
      onClick={() => {
        if (imageSelected) {
          editor.chain().focus().setImageAlign(value).run();
        } else {
          editor.chain().focus().setTextAlign(value).run();
        }
      }}
    >
      {glyph}
    </ToolbarButton>
  );
}
