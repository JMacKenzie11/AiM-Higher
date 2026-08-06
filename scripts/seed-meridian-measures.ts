/**
 * scripts/seed-meridian-measures.ts
 *
 * Backfills 13 weeks of realistic weekly entries for every non-
 * archived success measure under Meridian Construction Group. Idempotent
 * — upserts on (measure_id, week_ending) so re-runs update in place
 * rather than duplicating rows. Skips measures with no target (nothing
 * to shape the values around).
 *
 * Value patterns are shaped so the operational board renders a real
 * mix: mostly on-target with a few clusters of misses so a story
 * emerges when you scan the timeline view. Occasional missing weeks
 * simulate a leader who forgot to log.
 *
 * Usage:
 *   npm run seed:meridian-measures
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL.
 */

import { createClient } from "@supabase/supabase-js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: ${name} is required.`);
    process.exit(1);
  }
  return value;
}

const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const WEEKS = 13;

// Deterministic PRNG so re-runs produce the same visual — the demo
// stays stable between resets. mulberry32.
function makeRandom(seed: number) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

// Nearest Friday on or after today. Mirrors lib/dates.thisFriday but
// runs in plain Node without a timezone dep — the demo doesn't
// need to be strict about DST edges.
function thisFriday(): string {
  const now = new Date();
  const iso = toISODate(now);
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0=Sun
  const daysUntilFri = (5 - weekday + 7) % 7;
  return addDays(iso, daysUntilFri);
}

function parseTargetNum(target: string | null): number | null {
  if (!target) return null;
  const cleaned = target.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Supabase's PostgREST returns nested one-to-many relations as
// arrays even when we know a !inner join yields exactly one parent.
// We normalise at the access site rather than fighting the types.
type FunctionRow = {
  id: string;
  title: string;
  lead_id: string | null;
  track_id: string | null;
};

type OutcomeRow = {
  function: FunctionRow | FunctionRow[];
};

type MeasureRow = {
  id: string;
  description: string;
  target: string | null;
  value_type: "number" | "percent" | "text";
  target_direction: "higher_is_better" | "lower_is_better";
  outcome: OutcomeRow | OutcomeRow[];
};

function unwrapFn(outcome: OutcomeRow | OutcomeRow[]): FunctionRow | null {
  const o = Array.isArray(outcome) ? outcome[0] : outcome;
  if (!o) return null;
  const f = Array.isArray(o.function) ? o.function[0] : o.function;
  return f ?? null;
}

async function main() {
  const { data: company, error: companyErr } = await admin
    .from("companies")
    .select("id, name")
    .eq("name", "Meridian Construction Group")
    .maybeSingle<{ id: string; name: string }>();
  if (companyErr) throw companyErr;
  if (!company) {
    console.error(
      "Meridian Construction Group not found. Run `npm run seed:construction` first."
    );
    process.exit(1);
  }
  console.log(`· company: ${company.name} (${company.id})`);

  // Pull every non-archived measure under Meridian, walking the
  // outcome → function chain so we can attribute entered_by to the
  // function's Lead (fallback: Track, fallback: any admin).
  const { data: measuresRaw, error: measuresErr } = await admin
    .from("success_measures")
    .select(
      "id, description, target, value_type, target_direction, outcome:function_outcomes!inner(function:functions!inner(id, title, lead_id, track_id, company_id, archived))"
    )
    .eq("archived", false)
    .eq("outcome.function.company_id", company.id)
    .eq("outcome.function.archived", false);
  if (measuresErr) throw measuresErr;
  const measures = (measuresRaw ?? []) as unknown as MeasureRow[];
  console.log(`· measures found: ${measures.length}`);

  // Fallback "entered_by" for measures whose function seat is empty.
  const { data: fallbackProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("company_id", company.id)
    .in("role", ["company_admin", "system_admin"])
    .limit(1)
    .maybeSingle<{ id: string }>();
  const fallbackEnteredBy = fallbackProfile?.id ?? null;

  const currentWeek = thisFriday();
  const weeks: string[] = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    weeks.push(addDays(currentWeek, -7 * i));
  }

  const rand = makeRandom(0xa1ec0011);
  const upserts: Array<{
    measure_id: string;
    week_ending: string;
    value_number: number | null;
    value_text: string | null;
    entered_by: string | null;
  }> = [];
  let skippedNoTarget = 0;
  let skippedNoEnteredBy = 0;

  for (const m of measures) {
    const fn = unwrapFn(m.outcome);
    const enteredBy = fn
      ? fn.lead_id ?? fn.track_id ?? fallbackEnteredBy
      : fallbackEnteredBy;
    if (!enteredBy) {
      skippedNoEnteredBy += 1;
      continue;
    }
    if (!m.target) {
      // Skip metrics without a target — with no reference point the
      // values would look random on the board's colour scale.
      skippedNoTarget += 1;
      continue;
    }

    // Weekly variance profile:
    //   * A slump window (three consecutive weeks in the middle third)
    //     where the metric misses target more often. Makes the timeline
    //     view show a "story".
    //   * ~10% forgotten-week rate outside the slump; ~20% inside it.
    //   * Occasional early-quarter strong week.
    const slumpStart = 4 + Math.floor(rand() * 3);
    const slumpEnd = slumpStart + 2;

    for (let i = 0; i < weeks.length; i++) {
      const week = weeks[i];
      const inSlump = i >= slumpStart && i <= slumpEnd;
      const skipRoll = rand();
      if (skipRoll < (inSlump ? 0.2 : 0.1)) continue; // forgot to log

      const missRoll = rand();
      const missChance = inSlump ? 0.55 : 0.15;
      const missing = missRoll < missChance;

      let value_number: number | null = null;
      let value_text: string | null = null;

      if (m.value_type === "text") {
        // Target usually "Yes"; miss = "No".
        const target = (m.target ?? "yes").trim().toLowerCase();
        const good = target === "yes" ? "Yes" : target;
        const bad = target === "yes" ? "No" : "Yes";
        value_text = missing ? bad : good;
      } else {
        const target = parseTargetNum(m.target) ?? 100;
        if (m.value_type === "percent") {
          const jitter = (rand() - 0.5) * 12; // ±6
          const shortfall = missing ? -8 - rand() * 6 : 0;
          const overshoot = !missing ? rand() * 4 : 0;
          const raw =
            m.target_direction === "lower_is_better"
              ? target + (missing ? 6 + rand() * 8 : -jitter * 0.5)
              : target + shortfall + overshoot + jitter * 0.4;
          value_number = Math.max(0, Math.min(100, Math.round(raw)));
        } else {
          // Number metric. Move ±20% around target.
          const jitter = (rand() - 0.5) * 0.12 * target;
          const shortfall = missing ? -Math.abs(target) * (0.1 + rand() * 0.15) : 0;
          const overshoot = !missing ? Math.abs(target) * rand() * 0.06 : 0;
          const raw =
            m.target_direction === "lower_is_better"
              ? target + (missing ? Math.abs(target) * (0.12 + rand() * 0.15) : -Math.abs(jitter) * 0.3)
              : target + shortfall + overshoot + jitter * 0.4;
          // Round to a sensible resolution based on magnitude.
          const rounded =
            Math.abs(target) >= 100
              ? Math.round(raw)
              : Math.abs(target) >= 10
                ? Math.round(raw * 10) / 10
                : Math.round(raw * 100) / 100;
          value_number = rounded;
        }
      }

      upserts.push({
        measure_id: m.id,
        week_ending: week,
        value_number,
        value_text,
        entered_by: enteredBy,
      });
    }
  }

  if (upserts.length === 0) {
    console.log("· nothing to upsert.");
    console.log(
      `· skipped: ${skippedNoTarget} without target, ${skippedNoEnteredBy} without an entered_by fallback.`
    );
    return;
  }

  // Chunk the upsert to keep the request payload polite. Supabase
  // handles bulk fine but split feels safer on cold connections.
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < upserts.length; i += CHUNK) {
    const slice = upserts.slice(i, i + CHUNK);
    const { error } = await admin
      .from("success_measure_entries")
      .upsert(slice, { onConflict: "measure_id,week_ending" });
    if (error) throw error;
    written += slice.length;
  }

  console.log(
    `· wrote ${written} weekly entries across ${measures.length - skippedNoTarget - skippedNoEnteredBy} measures.`
  );
  if (skippedNoTarget > 0) {
    console.log(`  (skipped ${skippedNoTarget} measures with no target)`);
  }
  if (skippedNoEnteredBy > 0) {
    console.log(
      `  (skipped ${skippedNoEnteredBy} measures with no seat holder + no admin fallback)`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
