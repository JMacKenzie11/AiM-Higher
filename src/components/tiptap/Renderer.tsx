import { generateHTML } from "@tiptap/html";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/react";
import styles from "./Renderer.module.css";

// Server-side renderer for TipTap JSON. Uses @tiptap/html's
// generateHTML so consumer pages never load the editor bundle.
//
// StarterKit is the source of truth for what elements the editor
// produces — keep this list in lockstep with Editor.tsx or content
// authored with a richer set will lose formatting on render.

export function TipTapRenderer({ json }: { json: JSONContent | null }) {
  if (!json) return null;
  const html = generateHTML(json, [StarterKit]);
  return (
    <div
      className={styles.prose}
      // Safe because the input is TipTap's schema-constrained JSON;
      // there's no path for user-provided <script> or raw HTML to
      // reach here.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
