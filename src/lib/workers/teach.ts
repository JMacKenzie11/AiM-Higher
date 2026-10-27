import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { usageLogger } from "@/lib/coach/usage";
import { requestJson } from "@/lib/transcripts/model";
import { RUN_COLUMNS, STEP_COLUMNS, type WorkerRun, type WorkerStep } from "./types";

// TEACH A TASK (0303, step 3). A finished task's steps, written up as a
// skill: the route that worked, in numbered steps the worker follows the
// next time a task like it comes. The owner reads and edits it; the
// worker reads every skill on every task (runner.ts).
//
// Sonnet 5 with thinking off, as the other short write-ups are (Sonnet
// 5.5 refuses thinking disabled). Logs under worker_teach.

const DEFAULT_MODEL = "claude-sonnet-5";

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "A short name for the task, such as \"Find running shoe prices on Holabird Sports\"." },
    steps: {
      type: "array",
      description: "The steps, in order, each one sentence.",
      items: { type: "string" },
    },
    watch_out: {
      type: "array",
      description: "Things that got in the way and how to get past them, such as a sign-up pop-up. Empty when nothing did.",
      items: { type: "string" },
    },
  },
  required: ["title", "steps", "watch_out"],
};

const SYSTEM = `You turn a record of a task a worker did in a web browser into a skill: written steps the worker can follow next time a task like it comes, so it goes straight there.

Rules:
- Use only what the record shows worked. Leave out wrong turns and steps that failed.
- Name the website, the address to open, what to type and what to press, by the words on the page. Never use element refs like ref_6: they change every time.
- Where the task had specifics that will change next time (a product, a date, a name), write them as the thing to fill in, such as "search for the product asked for".
- Keep each step to one plain sentence. Five to twelve steps.
- Never include a password, even if one appears.`;

export type TeachResult = { ok: true; skillId: string } | { ok: false; message: string };

export function skillBody(steps: string[], watchOut: string[]): string {
  const lines = steps.map((s, i) => `${i + 1}. ${s.trim()}`);
  if (watchOut.length > 0) lines.push("", "Watch out:", ...watchOut.map((w) => `- ${w.trim()}`));
  return lines.join("\n").slice(0, 16000);
}

export async function teachSkill(db: SupabaseClient, runId: string): Promise<TeachResult> {
  const { data: run } = await db.from("worker_runs").select(RUN_COLUMNS).eq("id", runId).maybeSingle<WorkerRun>();
  if (!run) return { ok: false, message: "That task couldn't be found." };
  if (run.status !== "done") return { ok: false, message: "Only a finished task can be taught." };
  const { data: stepRows } = await db.from("worker_steps").select(STEP_COLUMNS).eq("run_id", runId).order("seq").limit(500);
  const steps = (stepRows ?? []) as WorkerStep[];
  if (steps.length === 0) return { ok: false, message: "That task has no steps to learn from." };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, message: "The model is not set up on this server." };
  const model = process.env.ANTHROPIC_WORKER_TEACH_MODEL || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey });
  const log = usageLogger({ companyId: null, purpose: "worker_teach", model });

  const record = [
    `The task: ${run.task}`,
    "",
    "What the worker did, in order (notes are what it said, the rest what it did; ✗ marks a step that failed):",
    ...steps.map((s) => `${s.seq}. ${s.kind === "note" ? "[note] " : ""}${s.is_error ? "✗ " : ""}${s.summary}`),
    "",
    `Its reply: ${(run.result ?? "").slice(0, 4000)}`,
  ].join("\n");

  try {
    const { data, message } = await requestJson(client, {
      model,
      max_tokens: 3000,
      thinking: "off",
      system: SYSTEM,
      schema: SCHEMA,
      messages: [{ role: "user", content: record }],
    });
    log(message);
    const d = data as { title?: unknown; steps?: unknown; watch_out?: unknown };
    const title = typeof d.title === "string" ? d.title.trim().slice(0, 200) : "";
    const list = Array.isArray(d.steps) ? d.steps.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
    const watch = Array.isArray(d.watch_out) ? d.watch_out.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
    if (!title || list.length === 0) return { ok: false, message: "The task couldn't be written up. Try again." };
    const { data: saved, error } = await db
      .from("worker_skills")
      .insert({ worker_id: run.worker_id, title, body: skillBody(list, watch), source_run_id: run.id })
      .select("id")
      .single<{ id: string }>();
    if (error || !saved) return { ok: false, message: "The skill couldn't be saved. Try again." };
    return { ok: true, skillId: saved.id };
  } catch (err) {
    console.error(`[workers] teaching ${runId} failed:`, err);
    return { ok: false, message: "The task couldn't be written up. Try again." };
  }
}
