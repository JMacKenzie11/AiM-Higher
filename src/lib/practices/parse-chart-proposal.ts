// Chart-proposal parser + validator. The Functional Chart Builder
// practice emits a fenced code block tagged `chart_proposal`
// containing JSON of the shape below; the client's ChartProposalCard
// (and the Apply server action) both parse through here so validity
// is defined in exactly one place.
//
// Shape (spec, exact):
//   {
//     "top_seats": [{ "name": string, "note": string }],
//     "functions": [
//       {
//         "name": string,
//         "responsibilities": [string],
//         "sub_functions": [{ "name": string, "responsibilities": [string] }]
//       }
//     ]
//   }
//
// The parser rejects anything that doesn't structurally match: an
// upstream generation that omits fields, adds objects where strings
// belong, or ships an empty proposal falls back to the malformed
// path on the card (the leader gets a 'Fix the proposal' action).

export type ChartTopSeat = { name: string; note: string };

export type ChartSubFunction = {
  name: string;
  responsibilities: string[];
};

export type ChartFunction = {
  name: string;
  responsibilities: string[];
  sub_functions?: ChartSubFunction[];
};

export type ChartProposal = {
  top_seats: ChartTopSeat[];
  functions: ChartFunction[];
};

export function parseChartProposal(raw: string): ChartProposal | null {
  if (!raw || raw.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;

  const topSeats = parseTopSeats((parsed as Record<string, unknown>).top_seats);
  if (!topSeats) return null;

  const functions = parseFunctions((parsed as Record<string, unknown>).functions);
  if (!functions) return null;

  return { top_seats: topSeats, functions };
}

function parseTopSeats(raw: unknown): ChartTopSeat[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ChartTopSeat[] = [];
  for (const item of raw) {
    if (!isObject(item)) return null;
    const name = (item as Record<string, unknown>).name;
    const note = (item as Record<string, unknown>).note;
    if (typeof name !== "string" || name.trim().length === 0) return null;
    if (typeof note !== "string") return null;
    out.push({ name: name.trim(), note: note.trim() });
  }
  return out;
}

function parseFunctions(raw: unknown): ChartFunction[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ChartFunction[] = [];
  for (const item of raw) {
    if (!isObject(item)) return null;
    const rec = item as Record<string, unknown>;
    const name = rec.name;
    if (typeof name !== "string" || name.trim().length === 0) return null;
    const responsibilities = parseStringArray(rec.responsibilities);
    if (!responsibilities) return null;

    const subRaw = rec.sub_functions;
    let subs: ChartSubFunction[] | undefined;
    if (subRaw !== undefined) {
      if (!Array.isArray(subRaw)) return null;
      subs = [];
      for (const s of subRaw) {
        if (!isObject(s)) return null;
        const srec = s as Record<string, unknown>;
        const sname = srec.name;
        if (typeof sname !== "string" || sname.trim().length === 0) return null;
        const sresp = parseStringArray(srec.responsibilities);
        if (!sresp) return null;
        subs.push({ name: sname.trim(), responsibilities: sresp });
      }
    }

    out.push({
      name: name.trim(),
      responsibilities,
      ...(subs ? { sub_functions: subs } : {}),
    });
  }
  return out;
}

function parseStringArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const s of raw) {
    if (typeof s !== "string") return null;
    const trimmed = s.trim();
    if (trimmed.length === 0) return null;
    out.push(trimmed);
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Serialize a valid ChartProposal to a plain-text version suitable
// for the Copy action on the card. Reader-friendly, LMA marked as
// the first line, sub-functions indented.
export function chartProposalToPlainText(proposal: ChartProposal): string {
  const lines: string[] = [];
  if (proposal.top_seats.length > 0) {
    lines.push("Top seats");
    for (const seat of proposal.top_seats) {
      lines.push(`  ${seat.name} — ${seat.note}`);
    }
    lines.push("");
  }
  for (const fn of proposal.functions) {
    lines.push(fn.name);
    fn.responsibilities.forEach((r) => {
      lines.push(`  - ${r}`);
    });
    if (fn.sub_functions && fn.sub_functions.length > 0) {
      for (const sub of fn.sub_functions) {
        lines.push(`  ${sub.name}`);
        sub.responsibilities.forEach((r) => {
          lines.push(`    - ${r}`);
        });
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
