// Is anybody using Aimee's panel, and does the help answer them?
//
//   npm run aimee:uptake              every active instance
//   npm run aimee:uptake -- --weeks 8
//
// One line per company per week (weeks start Monday, UTC). Writes
// nothing. Shaped like guide:uptake.
//
// Columns:
//   opens        panel opened (aimee_panel_events, 0240)
//   convos       conversations started in the panel (origin = 'panel')
//   messages     what people sent in those conversations, COUNTED:
//                the rows are counted, their text is never selected
//   help         help searches, from any plain Aimee conversation
//   no result    of those, how many found nothing
//   to page      clicks on "Continue on the Aimee page", a link the
//                panel offered until 2026-10-01 (#377); 0 since
//
// A second table, voice rules (0244): replies SHOWN with a banned
// phrase still in them, per week. Checked turns (a debrief reply, a
// generated opener) are sent back once and counted when the shown one
// still breaks a rule; ordinary replies, page and panel, are never
// retried and counted whenever one does. Against every Aimee reply
// that week, and the rules most often broken. Rule names only.
//
// ---- THE NUMBERS TO WATCH ---------------------------------------
//
// `no result` against `help`: a high share is help that is missing,
// and the fix is a help page, not a smarter search. And `messages`
// against `opens`: a panel opened a lot and talked to rarely is being
// used as the old "?", which is fine, and worth knowing.

import { readFileSync } from "node:fs";
import { forEachActiveInstance } from "@/lib/instances/for-each";
import { isEntryPoint } from "./lib/entry-point.ts";

for (const f of [".env.provisioning", ".env.local"]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

export type PanelEvent = {
  company_id: string;
  kind: "opened" | "help_search" | "continue_on_page";
  found: boolean | null;
  created_at: string;
};
export type PanelConversation = { id: string; company_id: string; created_at: string };
export type PanelMessage = { conversation_id: string; created_at: string };

export type RuleBreak = {
  surface: "debrief_reply" | "opener" | "conversation";
  origin: "page" | "panel" | null;
  rules: string[];
  created_at: string;
};

export type RuleWeek = {
  week: string;
  replies: number;
  debrief: number;
  opener: number;
  page: number;
  panel: number;
};

export function ruleWeeks(breaks: readonly RuleBreak[], repliesByWeek: ReadonlyMap<string, number>): RuleWeek[] {
  const weeks = new Map<string, RuleWeek>();
  const week = (w: string) => {
    let r = weeks.get(w);
    if (!r) {
      r = { week: w, replies: repliesByWeek.get(w) ?? 0, debrief: 0, opener: 0, page: 0, panel: 0 };
      weeks.set(w, r);
    }
    return r;
  };
  for (const w of repliesByWeek.keys()) week(w);
  for (const b of breaks) {
    const r = week(weekOf(b.created_at));
    if (b.surface === "debrief_reply") r.debrief += 1;
    else if (b.surface === "opener") r.opener += 1;
    else if (b.origin === "panel") r.panel += 1;
    else r.page += 1;
  }
  return [...weeks.values()].sort((a, b) => b.week.localeCompare(a.week));
}

export function topRules(breaks: readonly RuleBreak[], n = 5): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const b of breaks) for (const rule of b.rules) counts.set(rule, (counts.get(rule) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

export function ruleLines(weeks: readonly RuleWeek[], breaks: readonly RuleBreak[]): string[] {
  const lines = ["", "  Voice rules still broken when shown (0244)"];
  if (weeks.length === 0) return [...lines, "  No Aimee replies in this window on this instance."];
  const cols: Array<[string, keyof RuleWeek, number]> = [
    ["replies", "replies", 9],
    ["debrief", "debrief", 9],
    ["opener", "opener", 8],
    ["page", "page", 6],
    ["panel", "panel", 7],
  ];
  lines.push(`  ${"week".padEnd(12)}${cols.map(([h, , w]) => h.padStart(w)).join("")}`);
  for (const r of weeks) lines.push(`  ${r.week.padEnd(12)}${cols.map(([, k, w]) => String(r[k]).padStart(w)).join("")}`);
  const top = topRules(breaks);
  lines.push(top.length > 0 ? `  Most often: ${top.map(([rule, k]) => `${rule} (${k})`).join(", ")}` : "  None broken.");
  return lines;
}

export type WeekRow = {
  week: string;
  company_id: string;
  opens: number;
  convos: number;
  messages: number;
  help: number;
  noResult: number;
  toPage: number;
};

// The Monday (UTC) of the week a timestamp falls in, as YYYY-MM-DD.
export function weekOf(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function weeklyRows(
  events: readonly PanelEvent[],
  conversations: readonly PanelConversation[],
  messages: readonly PanelMessage[]
): WeekRow[] {
  const rows = new Map<string, WeekRow>();
  const row = (week: string, company: string) => {
    const key = `${week}|${company}`;
    let r = rows.get(key);
    if (!r) {
      r = { week, company_id: company, opens: 0, convos: 0, messages: 0, help: 0, noResult: 0, toPage: 0 };
      rows.set(key, r);
    }
    return r;
  };
  for (const e of events) {
    const r = row(weekOf(e.created_at), e.company_id);
    if (e.kind === "opened") r.opens += 1;
    else if (e.kind === "continue_on_page") r.toPage += 1;
    else {
      r.help += 1;
      if (e.found === false) r.noResult += 1;
    }
  }
  const companyOf = new Map(conversations.map((c) => [c.id, c.company_id]));
  for (const c of conversations) row(weekOf(c.created_at), c.company_id).convos += 1;
  for (const m of messages) {
    const company = companyOf.get(m.conversation_id);
    if (company) row(weekOf(m.created_at), company).messages += 1;
  }
  return [...rows.values()].sort((a, b) => (a.week === b.week ? a.company_id.localeCompare(b.company_id) : b.week.localeCompare(a.week)));
}

export function reportLines(rows: readonly WeekRow[], names: ReadonlyMap<string, string>): string[] {
  if (rows.length === 0) return ["  No panel use or help searches in this window on this instance."];
  const cols: Array<[string, keyof WeekRow, number]> = [
    ["opens", "opens", 7],
    ["convos", "convos", 8],
    ["messages", "messages", 10],
    ["help", "help", 6],
    ["no result", "noResult", 11],
    ["to page", "toPage", 9],
  ];
  const lines = [`  ${"week".padEnd(12)}${"company".padEnd(28)}${cols.map(([h, , w]) => h.padStart(w)).join("")}`];
  for (const r of rows) {
    lines.push(
      `  ${r.week.padEnd(12)}${(names.get(r.company_id) ?? r.company_id).slice(0, 26).padEnd(28)}` +
        cols.map(([, k, w]) => String(r[k]).padStart(w)).join("")
    );
  }
  const help = rows.reduce((n, r) => n + r.help, 0);
  const none = rows.reduce((n, r) => n + r.noResult, 0);
  lines.push(
    `  ${help} help searches, ${none} with no result` +
      `${help > 0 ? ` (${Math.round((none / help) * 100)}%)` : ""}`
  );
  return lines;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const weeksArg = args.indexOf("--weeks");
  const weeks = weeksArg === -1 ? 6 : Number(args[weeksArg + 1] ?? 6);
  const since = new Date(Date.now() - weeks * 7 * 86400_000).toISOString();

  const summary = await forEachActiveInstance<string[]>({
    job: "aimee-uptake",
    run: async ({ admin }) => {
      const { data: events, error: eventError } = await admin
        .from("aimee_panel_events")
        .select("company_id, kind, found, created_at")
        .gte("created_at", since);
      // Loud rather than an empty table: a table missing on one
      // instance is the fleet out of step (0240 not applied there).
      if (eventError) throw new Error(eventError.message);
      const { data: convos, error: convoError } = await admin
        .from("coaching_conversations")
        .select("id, company_id, created_at")
        .eq("origin", "panel")
        .gte("created_at", since);
      if (convoError) throw new Error(convoError.message);
      const ids = (convos ?? []).map((c) => c.id as string);
      // Who sent what is never read: only the conversation and when.
      const { data: msgs, error: msgError } = ids.length
        ? await admin
            .from("coaching_messages")
            .select("conversation_id, created_at")
            .in("conversation_id", ids)
            .eq("role", "user")
            .gte("created_at", since)
        : { data: [] as PanelMessage[], error: null };
      if (msgError) throw new Error(msgError.message);

      const rows = weeklyRows(
        (events ?? []) as PanelEvent[],
        (convos ?? []) as PanelConversation[],
        (msgs ?? []) as PanelMessage[]
      );
      const companyIds = [...new Set(rows.map((r) => r.company_id))];
      const { data: companies } = companyIds.length
        ? await admin.from("companies").select("id, name").in("id", companyIds)
        : { data: [] as Array<{ id: string; name: string }> };
      const names = new Map(((companies ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));

      const { data: breaks, error: breakError } = await admin
        .from("voice_rule_breaks")
        .select("surface, origin, rules, created_at")
        .gte("created_at", since);
      // Loud, like the panel table: 0244 not applied on this instance.
      if (breakError) throw new Error(breakError.message);
      // Every Aimee reply per week, counted, never read.
      const repliesByWeek = new Map<string, number>();
      for (let w = 0; w < weeks; w += 1) {
        const start = new Date(weekOf(new Date(Date.now() - w * 7 * 86400_000).toISOString()));
        const end = new Date(start.getTime() + 7 * 86400_000);
        const { count, error } = await admin
          .from("coaching_messages")
          .select("id", { count: "exact", head: true })
          .eq("role", "assistant")
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString());
        if (error) throw new Error(error.message);
        if ((count ?? 0) > 0) repliesByWeek.set(weekOf(start.toISOString()), count ?? 0);
      }
      return [
        ...reportLines(rows, names),
        ...ruleLines(ruleWeeks((breaks ?? []) as RuleBreak[], repliesByWeek), (breaks ?? []) as RuleBreak[]),
      ];
    },
    line: (lines) => `\n${lines.join("\n")}`,
  });

  process.exit(summary.ok ? 0 : 1);
}

if (isEntryPoint(import.meta.url)) {
  void main();
}
