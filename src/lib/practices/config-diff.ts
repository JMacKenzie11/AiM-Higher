// What changed between two agent configs.
//
// Field-by-field, plus a line-level diff for the prompt, which is
// the field an admin actually needs to read before publishing. The
// rest are short enough that "was X, now Y" says everything.
//
// No diff library. The prompt is a few hundred lines at most and
// this runs once when somebody opens the publish panel, so the
// simplest correct algorithm is the right one: common prefix, common
// suffix, everything between marked changed. It will occasionally
// show a larger changed block than a proper LCS would, and that errs
// toward showing MORE of what moved, which is the safe direction for
// a screen whose job is "read this before it goes to every company".

export type ConfigShape = {
  prompt: string;
  chips: string[];
  basePromptMode: string;
  skipSetup: boolean;
  firstTurn: string | null;
  scriptedOpener: string | null;
  tools: string[];
  maxTokens: number | null;
  model: string | null;
};

export type FieldChange = {
  label: string;
  before: string;
  after: string;
};

export type PromptLine = {
  kind: "same" | "added" | "removed";
  text: string;
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "not set";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, string>);
    return entries.length
      ? entries.map(([k, v]) => `${k} → ${v}`).join(", ")
      : "none";
  }
  return String(value);
}

export function fieldChanges(
  before: ConfigShape,
  after: ConfigShape
): FieldChange[] {
  const fields: Array<[string, keyof ConfigShape]> = [
    ["Chips", "chips"],
    ["Base prompt", "basePromptMode"],
    ["Skip setup", "skipSetup"],
    ["First turn", "firstTurn"],
    ["Scripted opener", "scriptedOpener"],
    ["Tools", "tools"],
    ["Token ceiling", "maxTokens"],
    ["Model", "model"],
  ];
  const out: FieldChange[] = [];
  for (const [label, key] of fields) {
    const b = show(before[key]);
    const a = show(after[key]);
    if (b !== a) out.push({ label, before: b, after: a });
  }
  return out;
}

export function promptDiff(before: string, after: string): PromptLine[] {
  const b = before.split("\n");
  const a = after.split("\n");

  let head = 0;
  while (head < b.length && head < a.length && b[head] === a[head]) head += 1;

  let tail = 0;
  while (
    tail < b.length - head &&
    tail < a.length - head &&
    b[b.length - 1 - tail] === a[a.length - 1 - tail]
  ) {
    tail += 1;
  }

  const lines: PromptLine[] = [];
  for (let i = 0; i < head; i += 1) lines.push({ kind: "same", text: b[i] });
  for (let i = head; i < b.length - tail; i += 1) {
    lines.push({ kind: "removed", text: b[i] });
  }
  for (let i = head; i < a.length - tail; i += 1) {
    lines.push({ kind: "added", text: a[i] });
  }
  for (let i = a.length - tail; i < a.length; i += 1) {
    lines.push({ kind: "same", text: a[i] });
  }
  return lines;
}

// Unchanged runs are collapsed to a marker, because a publish panel
// showing 400 identical lines buries the six that moved.
export function collapseUnchanged(
  lines: PromptLine[],
  context = 3
): Array<PromptLine | { kind: "gap"; text: string }> {
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (l.kind === "same") return;
    for (let j = i - context; j <= i + context; j += 1) keep.add(j);
  });
  const out: Array<PromptLine | { kind: "gap"; text: string }> = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep.has(i)) {
      if (skipped > 0) {
        out.push({ kind: "gap", text: `${skipped} unchanged lines` });
        skipped = 0;
      }
      out.push(l);
    } else {
      skipped += 1;
    }
  });
  if (skipped > 0) out.push({ kind: "gap", text: `${skipped} unchanged lines` });
  return out;
}

export function hasAnyChange(
  before: ConfigShape,
  after: ConfigShape
): boolean {
  return before.prompt !== after.prompt || fieldChanges(before, after).length > 0;
}
