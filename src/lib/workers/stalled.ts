import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { STALLED_ERROR, stalled, type Pending, type RunStatus } from "./types";

// Marks a worker's stalled tasks (types.ts, stalled) as failed, as their
// owner, so the pages say what happened and the worker can take another
// task. Called when a worker's page or its home page is read, and before
// a new task starts. Returns the ids it marked.
export async function settleStalled(db: SupabaseClient, workerId?: string): Promise<string[]> {
  let q = db.from("worker_runs").select("id, status, created_at, started_at, pending").in("status", ["queued", "running"]);
  if (workerId) q = q.eq("worker_id", workerId);
  const { data: active } = await q;
  const runs = (active ?? []) as Array<{ id: string; status: RunStatus; created_at: string; started_at: string | null; pending: Pending | null }>;
  if (runs.length === 0) return [];
  const { data: steps } = await db
    .from("worker_steps")
    .select("run_id, created_at")
    .in("run_id", runs.map((r) => r.id))
    .order("created_at", { ascending: false })
    .limit(500);
  const last = new Map<string, string>();
  for (const s of (steps ?? []) as Array<{ run_id: string; created_at: string }>) if (!last.has(s.run_id)) last.set(s.run_id, s.created_at);
  const dead = runs.filter((r) => stalled(r, last.get(r.id) ?? null)).map((r) => r.id);
  if (dead.length === 0) return [];
  await db
    .from("worker_runs")
    .update({ status: "failed", error: STALLED_ERROR, conversation: null, finished_at: new Date().toISOString() })
    .in("id", dead)
    .in("status", ["queued", "running"]);
  return dead;
}
