import type { AttentionTrigger } from "./attention";

// COACH HQ'S DERIVATIONS, PURE. Every number and sentence on the two
// tabs that is worked out rather than read is worked out here, so each
// one is a unit test (derive.test.ts) and the loaders only fetch.

export const DAY_MS = 24 * 60 * 60 * 1000;
// "Compared with four weeks ago" on the companies table.
export const COMPARE_DAYS = 28;
// The same 30-day window the attention queue and the rollup use.
export const FTR_WINDOW_DAYS = 30;
// A coaching call older than this reads amber on the companies table.
export const CALL_STALE_DAYS = 14;

// ---- Follow-Through Rate over a window ------------------------------

export type FtrRow = {
  status: string;
  completed_at: string | null;
  deleted_at: string | null;
  parked_at: string | null;
};

// Coach HQ's Follow-Through Rate: of the commitments resolved inside
// the window, the share kept on time. The same rule the rollup and the
// attention queue have always used, so the table, the queue and the
// "four weeks ago" figure agree with each other. Null when nothing was
// resolved in the window.
export function ftrInWindow(rows: readonly FtrRow[], startMs: number, endMs: number): number | null {
  let onTime = 0;
  let total = 0;
  for (const r of rows) {
    if (r.deleted_at || r.parked_at || !r.completed_at || r.status === "open") continue;
    const at = Date.parse(r.completed_at);
    if (!(at >= startMs && at < endMs)) continue;
    if (r.status === "kept_on_time") onTime += 1;
    else if (r.status !== "kept_late" && r.status !== "missed") continue;
    total += 1;
  }
  return total === 0 ? null : Math.round((onTime / total) * 100);
}

// The rate now, and the rate as it stood `daysBack` days ago, each over
// a 30-day window.
export function ftrNowAndThen(
  rows: readonly FtrRow[],
  nowMs: number,
  daysBack = COMPARE_DAYS
): { now: number | null; then: number | null } {
  const thenEnd = nowMs - daysBack * DAY_MS;
  return {
    now: ftrInWindow(rows, nowMs - FTR_WINDOW_DAYS * DAY_MS, nowMs + 1),
    then: ftrInWindow(rows, thenEnd - FTR_WINDOW_DAYS * DAY_MS, thenEnd),
  };
}

// ---- Change since then ----------------------------------------------

export type Change = { direction: "up" | "down" | "same"; amount: number };

// Null when either side is missing: the table shows no arrow at all
// rather than an arrow from nothing. Equal reads "no change".
export function changeBetween(then: number | null, now: number | null, decimals = 0): Change | null {
  if (then === null || now === null) return null;
  const f = 10 ** decimals;
  const amount = Math.round(Math.abs(now - then) * f) / f;
  if (amount === 0) return { direction: "same", amount: 0 };
  return { direction: now > then ? "up" : "down", amount };
}

// ---- Priorities in the open quarter ---------------------------------

export type PriorityLite = {
  status: string;
  due_date: string | null;
  archived: boolean;
};

// "N on track · N overdue". Overdue: not complete and its due date has
// passed. On track: marked on track (or ongoing) and not overdue.
// Complete, behind and not started are in neither count.
export function priorityCounts(rows: readonly PriorityLite[], todayIso: string): { onTrack: number; overdue: number } {
  let onTrack = 0;
  let overdue = 0;
  for (const p of rows) {
    if (p.archived || p.status === "complete") continue;
    if (p.due_date && p.due_date < todayIso) overdue += 1;
    else if (p.status === "on_track" || p.status === "ongoing") onTrack += 1;
  }
  return { onTrack, overdue };
}

// ---- Days ago --------------------------------------------------------

export function daysSince(iso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(iso)) / DAY_MS));
}

export function daysAgoLabel(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

// ---- Your commitments due this week ----------------------------------

// Open commitments due on or before the week's Friday, overdue ones
// included: they are still due.
export function dueThisWeekCount(
  rows: ReadonlyArray<{ status: string; due_date: string | null; deleted_at?: string | null; parked_at?: string | null }>,
  fridayIso: string
): number {
  return rows.filter(
    (r) => r.status === "open" && !r.deleted_at && !r.parked_at && r.due_date !== null && r.due_date <= fridayIso
  ).length;
}

// ---- A question worth asking, per signal ------------------------------

// One hand-written question per kind of signal, asked from strength:
// what worked, what the team wants, what they already know. Fixed text,
// never generated, so the same signal always asks the same thing.
export function questionFor(trigger: AttentionTrigger): string {
  switch (trigger.kind) {
    case "scorecard_dropped":
      return `What was working when the scorecard read ${trigger.from}, and what would bring it back?`;
    case "ftr_low":
      return "Which commitments did the team keep last week, and what made those ones land?";
    case "ftr_declining":
      return `What made the weeks at ${trigger.from}% work, and what changed?`;
    case "facilitation_low":
      return "What part of the last meeting worked best, and how could the whole meeting run like that?";
    case "facilitation_insufficient":
      return "What would make the next meeting easy to record from start to finish?";
    case "priority_overdue":
      return trigger.count === 1
        ? "What would it take to finish the overdue priority, and who is best placed to lead it?"
        : "Which of the overdue priorities still matters most this quarter?";
    case "unrouted_transcript":
      return "Which meetings would the team most like to see summarised?";
  }
}

// ---- What a coaching call's analysis says ------------------------------

// The body of one "## Heading" section of an analysis, or null. Matches
// a numbered heading too ("## 6. Decisions Made"), as older analyses
// carry them.
export function sectionBody(markdown: string, heading: RegExp): string | null {
  const lines = markdown.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(?:\d+\.\s+)?(.*?)\s*$/.exec(lines[i]);
    if (m && heading.test(m[1])) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start, end).join("\n").trim();
  return body === "" ? null : body;
}

function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

const SENTENCE_MAX = 220;

// "In a sentence": the first sentence of the call's Purpose of the
// Call, or of its first paragraph when it has no such section. Taken
// from what the analysis already stored; nothing is generated.
export function oneSentenceSummary(markdown: string | null): string | null {
  if (!markdown) return null;
  const source =
    sectionBody(markdown, /^(?:Purpose of the Call|Summary|Purpose)\b/i) ??
    markdown.split(/\n\s*\n/).find((p) => plain(p) !== "" && !/^#/.test(p.trim())) ??
    null;
  if (!source) return null;
  const text = plain(source);
  if (!text) return null;
  const m = /^(.+?[.!?])(?:\s|$)/.exec(text);
  let sentence = (m ? m[1] : text).trim();
  if (sentence.length > SENTENCE_MAX) sentence = `${sentence.slice(0, SENTENCE_MAX - 3).trimEnd()}...`;
  return sentence;
}

// "Where you left off": the decisions the last call made, from its
// Decisions Made section, one line each. When the analysis has none,
// the first few lines of what it does say.
export function leftOffLines(markdown: string | null, max = 5): { kind: "decisions" | "summary"; lines: string[] } | null {
  if (!markdown) return null;
  const decisions = sectionBody(markdown, /^Decisions Made\b/i);
  if (decisions) {
    const lines = bulletLines(decisions).slice(0, max);
    if (lines.length > 0) return { kind: "decisions", lines };
  }
  const summary = sectionBody(markdown, /^(?:Purpose of the Call|Summary|Purpose)\b/i);
  if (summary) {
    const lines = bulletLines(summary).slice(0, 3);
    if (lines.length > 0) return { kind: "summary", lines };
  }
  return null;
}

function bulletLines(body: string): string[] {
  const out: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    if (/^\s*#{3,}\s/.test(raw)) continue;
    const line = plain(raw);
    if (!line) continue;
    // A bold lead-in on its own ("**Confirmed directions:**") is a
    // label, not a decision.
    if (/:$/.test(line) && line.length < 60) continue;
    out.push(line);
  }
  return out;
}

// ---- How long a call ran, when the transcript says ---------------------

// The last timestamp in the transcript ("00:47:12", "47:12", or a VTT
// cue "00:47:12.000 --> ..."), in whole minutes. Null when there are
// none, or the result is not a believable call length.
export function durationMinutes(text: string): number | null {
  let max = 0;
  for (const m of text.matchAll(/(?<![\d:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.\d+)?(?![\d:])/g)) {
    const h = m[1] ? Number(m[1]) : 0;
    const min = Number(m[2]);
    const s = Number(m[3]);
    if (min > 59 || s > 59) continue;
    max = Math.max(max, h * 3600 + min * 60 + s);
  }
  const minutes = Math.round(max / 60);
  return minutes >= 1 && minutes <= 6 * 60 ? minutes : null;
}

// ---- Since your last call ------------------------------------------------

// The date "since" counts from: the last coaching call, or four weeks
// ago when there has been none (and the card says so).
export function sinceDate(lastCallIso: string | null, nowMs: number): { iso: string; fromCall: boolean } {
  if (lastCallIso) return { iso: lastCallIso, fromCall: true };
  return { iso: new Date(nowMs - COMPARE_DAYS * DAY_MS).toISOString(), fromCall: false };
}

// Priorities whose due date fell between then and today and are not
// complete: the ones that became overdue since.
export function overdueSince<T extends PriorityLite>(rows: readonly T[], sinceIso: string, todayIso: string): T[] {
  const sinceDay = sinceIso.slice(0, 10);
  return rows.filter(
    (p) => !p.archived && p.status !== "complete" && p.due_date !== null && p.due_date >= sinceDay && p.due_date < todayIso
  );
}

export function followThroughLine(then: number | null, now: number | null): { tone: "up" | "down" | "same"; text: string } | null {
  if (now === null) return null;
  if (then === null) return { tone: "same", text: `Follow-through is ${now}%.` };
  if (now > then) return { tone: "up", text: `Follow-through up from ${then}% to ${now}%.` };
  if (now < then) return { tone: "down", text: `Follow-through down from ${then}% to ${now}%.` };
  return { tone: "same", text: `Follow-through held at ${now}%.` };
}

// "Tue 10 Nov", in UTC so the server and the browser agree.
export function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

// Where Prepare goes: the Coaching calls tab, on that company.
export function prepareHref(companyId: string): string {
  return `/hq?company=${encodeURIComponent(companyId)}#coaching-calls`;
}

// ---- Your companies: order and the reason under "Needs you" ---------

// The short reason a company is marked "Needs you", one per trigger.
// Shorter than attention.ts's reasonPhrase: it sits under the company's
// name in a table whose other columns already carry the numbers.
export function needsYouReason(trigger: AttentionTrigger): string {
  switch (trigger.kind) {
    case "scorecard_dropped":
      return `Scorecard down from ${trigger.from} to ${trigger.to}`;
    case "ftr_low":
      return `Follow-through below ${trigger.threshold}%`;
    case "ftr_declining":
      return "Follow-through falling";
    case "facilitation_low":
      return "Low facilitation score";
    case "facilitation_insufficient":
      return "Last meeting couldn't be scored";
    case "priority_overdue":
      return `${trigger.count} ${trigger.count === 1 ? "priority" : "priorities"} over two weeks late`;
    case "unrouted_transcript":
      return `${trigger.count} ${trigger.count === 1 ? "recording" : "recordings"} waiting to be filed`;
  }
}

// At most two reasons on a row, in the order the queue lists a
// company's triggers: scorecard, follow-through, facilitation,
// priorities, recordings.
export const NEEDS_YOU_REASONS_SHOWN = 2;

export function needsYouLine(triggers: readonly AttentionTrigger[]): string {
  return triggers.slice(0, NEEDS_YOU_REASONS_SHOWN).map(needsYouReason).join(" · ");
}

// Companies that need the coach first, the heaviest first, then the
// rest; name breaks every tie. Severity is the attention queue's.
export function orderByAttention<T extends { id: string; name: string }>(
  rows: readonly T[],
  attention: readonly { companyId: string; severity: number }[]
): T[] {
  const severity = new Map(attention.map((a) => [a.companyId, a.severity] as const));
  return [...rows].sort(
    (a, b) => (severity.get(b.id) ?? 0) - (severity.get(a.id) ?? 0) || a.name.localeCompare(b.name)
  );
}
