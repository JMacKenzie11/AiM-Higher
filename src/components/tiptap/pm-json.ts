import type { JSONContent } from "@tiptap/react";
import type { Mark as PMMark, Node as PMNode } from "@tiptap/pm/model";

// Shared by the classroom editor (Editor.tsx) and NotesEditor.
// Custom ProseMirror doc → JSONContent walker. Mirrors the shape
// ProseMirror's built-in toJSON produces, but reads attrs via
// Object.keys/spread so nothing gets silently dropped between the
// in-memory mark and the emitted JSON.
export function pmDocToJson(node: PMNode): JSONContent {
  const json: JSONContent = { type: node.type.name };
  const nodeAttrKeys = Object.keys(node.attrs ?? {});
  if (nodeAttrKeys.length > 0) {
    json.attrs = { ...node.attrs };
  }
  if (node.marks && node.marks.length > 0) {
    json.marks = node.marks.map(pmMarkToJson);
  }
  if (node.isText) {
    json.text = node.text ?? "";
  } else if (node.content.size > 0) {
    const content: JSONContent[] = [];
    node.content.forEach((child) => content.push(pmDocToJson(child)));
    if (content.length > 0) json.content = content;
  }
  return json;
}

function pmMarkToJson(mark: PMMark): { type: string; attrs?: Record<string, unknown> } {
  const out: { type: string; attrs?: Record<string, unknown> } = {
    type: mark.type.name,
  };
  const keys = Object.keys(mark.attrs ?? {});
  if (keys.length > 0) {
    out.attrs = { ...mark.attrs };
  }
  return out;
}
