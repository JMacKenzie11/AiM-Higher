// What has the Guide raised? One row per nudge.
//
//   npm run guide:nudges -- --company "Benson Seafood"
//   npm run guide:nudges -- --company <name or id> --since 2026-09-01
//   npm run guide:nudges                      per-company totals only
//   npm run guide:nudges -- --instance promiseone
//   npm run guide:nudges -- --instance dev    the dev clone
//
// Signs in as a system admin (AIMS_SYSADMIN_EMAIL, AIMS_SYSADMIN_PASSWORD)
// and reads through that account's own access, never the service key.
// Read-only: no writes, no model calls.
//
// ---- WHAT IT WILL NEVER READ -----------------------------------
//
// The headline is the only Guide text a system admin may see. The
// debrief that follows it is the champion's private conversation, and
// this command must not be the first crack in that wall. So it never
// reads, joins or counts the coaching conversation or message tables,
// and it does not even select the nudge's link to a conversation.
// guide-nudges.test.ts fails if this file ever names either table or
// that link column, or reads any table outside a short allowlist.
//
// ---- WITH NO --company -----------------------------------------
//
// Per-company totals only, no headlines, so a fleet-wide glance does
// not scroll through every client's meetings.

import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { lookupInstance } from "@/lib/instances/registry";
import { isEntryPoint } from "./lib/entry-point.ts";

for (const f of [".env.provisioning", ".env.local"]) {
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

// The ONLY columns read from guide_nudges. Named here, once, so the
// test can see exactly what the command reads.
export const NUDGE_COLUMNS =
  "id, company_id, meeting_id, headline, state, raised_at, opened_at, dismissed_at";

export type NudgeRow = {
  id: string;
  company_id: string;
  meeting_id: string | null;
  headline: string;
  state: "pending" | "opened" | "dismissed" | "superseded";
  raised_at: string;
  opened_at: string | null;
  dismissed_at: string | null;
};

const DAY = 24 * 60 * 60 * 1000;

function fail(msg: string): never {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

export function parseArgs(argv: string[]): { company: string | null; since: string; instance: string } {
  const args = argv.filter((a) => a !== "--");
  const value = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] ?? null : null;
  };
  const sinceArg = value("--since");
  const since = sinceArg ?? new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error(`--since wants a date like 2026-09-01, not "${since}"`);
  return { company: value("--company"), since, instance: value("--instance") ?? "@" };
}

// When the state last changed. Superseding records no time (0235 has
// no superseded_at), so that is said rather than guessed.
export function changedAt(n: NudgeRow): string {
  if (n.state === "opened") return n.opened_at?.slice(0, 16).replace("T", " ") ?? "not recorded";
  if (n.state === "dismissed") return n.dismissed_at?.slice(0, 16).replace("T", " ") ?? "not recorded";
  if (n.state === "superseded") return "not recorded";
  return "";
}

export function totalsByCompany(rows: NudgeRow[]): Map<string, Record<NudgeRow["state"] | "raised", number>> {
  const out = new Map<string, Record<NudgeRow["state"] | "raised", number>>();
  for (const r of rows) {
    const t = out.get(r.company_id) ?? { raised: 0, pending: 0, opened: 0, dismissed: 0, superseded: 0 };
    t.raised++;
    t[r.state]++;
    out.set(r.company_id, t);
  }
  return out;
}

async function signIn(url: string, anonKey: string): Promise<SupabaseClient> {
  const email = process.env.AIMS_SYSADMIN_EMAIL;
  const password = process.env.AIMS_SYSADMIN_PASSWORD;
  if (!email || !password) {
    fail("Set AIMS_SYSADMIN_EMAIL and AIMS_SYSADMIN_PASSWORD: this reads as a system admin, never with the service key.");
  }
  const db = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error || !data.user) fail(`Sign-in failed: ${error?.message ?? "no user"}`);
  const { data: me } = await db.from("profiles").select("role").eq("id", data.user.id).maybeSingle<{ role: string }>();
  if (me?.role !== "system_admin") {
    fail(`${email} is not a system admin (${me?.role ?? "no profile"}). This command reads only what a system admin may.`);
  }
  return db;
}

async function resolveInstance(name: string): Promise<{ label: string; url: string; anonKey: string }> {
  if (name === "dev") {
    const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
    const anonKey = process.env.LOCAL_INSTANCE_SUPABASE_ANON_KEY;
    if (!url || !anonKey) fail("LOCAL_INSTANCE_SUPABASE_URL / _ANON_KEY are not set.");
    return { label: "dev clone", url, anonKey };
  }
  const instance = await lookupInstance(name);
  if (!instance) fail(`No instance "${name}" in the registry.`);
  return { label: name, url: instance.supabaseUrl, anonKey: instance.supabaseAnonKey };
}

async function main() {
  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
  const target = await resolveInstance(opts.instance);
  const db = await signIn(target.url, target.anonKey);

  const { data: companies, error: cErr } = await db.from("companies").select("id, name, timezone");
  if (cErr) fail(cErr.message);
  const byId = new Map((companies ?? []).map((c) => [c.id as string, c as { id: string; name: string; timezone: string | null }]));

  let companyId: string | null = null;
  if (opts.company) {
    const needle = opts.company.toLowerCase();
    const matches = (companies ?? []).filter(
      (c) => c.id === opts.company || (c.name as string).toLowerCase() === needle
    );
    const loose = matches.length > 0 ? matches : (companies ?? []).filter((c) => (c.name as string).toLowerCase().includes(needle));
    if (loose.length !== 1) {
      fail(
        loose.length === 0
          ? `No company matches "${opts.company}".`
          : `"${opts.company}" matches ${loose.length}: ${loose.map((c) => c.name).join(", ")}. Be more specific.`
      );
    }
    companyId = loose[0].id as string;
  }

  let query = db
    .from("guide_nudges")
    .select(NUDGE_COLUMNS)
    .gte("raised_at", `${opts.since}T00:00:00Z`)
    .order("raised_at", { ascending: false });
  if (companyId) query = query.eq("company_id", companyId);
  const { data, error } = await query;
  if (error) fail(error.message);
  const rows = (data ?? []) as NudgeRow[];

  console.log(`\n  ${target.label} · since ${opts.since} · ${rows.length} nudge${rows.length === 1 ? "" : "s"}\n`);

  if (!companyId) {
    // Totals only: no headlines on a fleet-wide glance.
    const totals = totalsByCompany(rows);
    if (totals.size === 0) console.log("  No nudges raised in this window.");
    for (const [id, t] of [...totals].sort((a, b) => b[1].raised - a[1].raised)) {
      console.log(
        `  ${(byId.get(id)?.name ?? id).padEnd(32)} raised ${t.raised}  opened ${t.opened}  dismissed ${t.dismissed}  superseded ${t.superseded}  pending ${t.pending}`
      );
    }
    console.log("");
    return;
  }

  // The meeting date: the meeting's own created_at in the company's
  // timezone, as everywhere else. Only the meetings table is read.
  const meetingIds = [...new Set(rows.map((r) => r.meeting_id).filter((x): x is string => !!x))];
  const { data: meetings } = meetingIds.length
    ? await db.from("meetings").select("id, created_at").in("id", meetingIds)
    : { data: [] as Array<{ id: string; created_at: string }> };
  const tz = byId.get(companyId)?.timezone ?? "UTC";
  const meetingDate = new Map(
    (meetings ?? []).map((m) => [
      m.id as string,
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(m.created_at as string)),
    ])
  );

  console.log(`  ${byId.get(companyId)?.name}\n`);
  if (rows.length === 0) console.log("  No nudges raised in this window.");
  for (const r of rows) {
    const changed = changedAt(r);
    console.log(
      `  raised ${r.raised_at.slice(0, 16).replace("T", " ")}  meeting ${r.meeting_id ? meetingDate.get(r.meeting_id) ?? "?" : "none"}  ${r.state}${changed ? ` (${changed})` : ""}`
    );
    console.log(`    ${r.headline}\n`);
  }
}

if (isEntryPoint(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
