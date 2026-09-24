// Core Values in Action is written last and shown first.
//
// ---- WHY THE TWO DIFFER ----------------------------------------
//
// Which values showed up is a judgement about the whole meeting, so
// the model writes it once every discussion is worked through. A
// values section generated first would be the most generic thing on
// the page — the same verdict-before-evidence failure that put "the
// 4Ws weren't applied to any of the issues" above an audit showing
// three issues with all four steps.
//
// The reader has the opposite need: values are what the leader wants
// at the top. Generation order serves accuracy, display order serves
// the reader, and this function is the seam between them.
//
// ---- WHY A TEXT TRANSFORM AND NOT A SECOND CALL -----------------
//
// The analysis is one markdown document. Splitting it into fields to
// reorder it would mean a structured call, a migration, and a
// renderer per section, to move one heading. Hoisting the section is
// a pure function over the text with no model, no storage and no
// round trip.
//
// ---- WHAT IT DOES WHEN IT CANNOT FIND THE SECTION ---------------
//
// Returns the document untouched. A missing Core Values section is
// ORDINARY: the prompt says to omit it entirely rather than write a
// manufactured one, so most meetings have none. Older analyses also
// carry numbered headings ("## 7. Values in Practice") from before
// the rename, which is why the match tolerates both a numeric prefix
// and the old title.

const HEADING = /^##\s+(?:\d+\.\s+)?(?:Core Values in Action|Values in Practice)\s*$/im;
const ANY_H2 = /^##\s+/m;

// The Core Values section on its own, and everything else.
//
// It gets its own card above the analysis rather than a heading
// inside it: values are what the leader is asked to look at first,
// and a heading inside a long document is not "first" in any sense
// a reader experiences.
//
// `values` is null when the section is absent, which is ORDINARY —
// the prompt says to omit it rather than manufacture one — and the
// caller then renders no card at all rather than an empty one.
export function splitCoreValues(markdown: string): {
  values: string | null;
  rest: string;
} {
  const match = HEADING.exec(markdown);
  if (!match) return { values: null, rest: markdown };

  const start = match.index;
  const after = start + match[0].length;
  const tail = markdown.slice(after);
  const nextRel = tail.search(ANY_H2);
  const end = nextRel === -1 ? markdown.length : after + nextRel;

  // The heading itself goes with the card's own title, so the body
  // is what sits between this heading and the next one.
  const body = markdown.slice(after, end).trim();
  const rest = (markdown.slice(0, start) + markdown.slice(end)).trim();
  return { values: body.length > 0 ? body : null, rest };
}

export function coreValuesFirst(markdown: string): string {
  const match = HEADING.exec(markdown);
  if (!match) return markdown;

  const start = match.index;
  // Already at the top, give or take leading whitespace.
  if (markdown.slice(0, start).trim() === "") return markdown;

  const rest = markdown.slice(start + match[0].length);
  const nextRel = rest.search(ANY_H2);
  const section = nextRel === -1
    ? markdown.slice(start)
    : markdown.slice(start, start + match[0].length + nextRel);
  const remainder =
    markdown.slice(0, start) +
    (nextRel === -1 ? "" : markdown.slice(start + match[0].length + nextRel));

  return `${section.trimEnd()}\n\n${remainder.trim()}\n`;
}
