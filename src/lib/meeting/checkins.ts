// The weekly meeting's check-in notes (meeting_checkins, 0299): one
// rich text page per company per week, stored as the editor's TipTap
// JSON. Its own file because a "use server" file may export only
// functions.

// The most the stored document may be, in bytes of its JSON text. The
// database allows 80,000 of jsonb's wider text form, so a document the
// app accepts is never refused there.
export const CHECKIN_MAX_BYTES = 60_000;

export type CheckinDoc = { type: "doc"; content?: unknown[] };

export const EMPTY_CHECKIN: CheckinDoc = { type: "doc", content: [] };

// What a save may store: a document, as the editor writes one, inside
// the size the table allows. Anything else is refused rather than
// trimmed, since a cut document is not a document.
export function checkCheckinDoc(v: unknown): { ok: true; doc: CheckinDoc } | { ok: false; message: string } {
  if (!v || typeof v !== "object" || Array.isArray(v) || (v as { type?: unknown }).type !== "doc") {
    return { ok: false, message: "Those notes could not be read." };
  }
  const content = (v as { content?: unknown }).content;
  if (content !== undefined && !Array.isArray(content)) {
    return { ok: false, message: "Those notes could not be read." };
  }
  if (new TextEncoder().encode(JSON.stringify(v)).length > CHECKIN_MAX_BYTES) {
    return { ok: false, message: "The notes are too long to save. Move some of them somewhere else first." };
  }
  return { ok: true, doc: v as CheckinDoc };
}
