"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { requireWorkers } from "./access";
import { browserbaseConfigured } from "./browserbase";
import { runWorker } from "./runner";
import { INSTRUCTIONS_MAX, NAME_MAX, TASK_MAX } from "./types";

// Workers (0303). Every action is the signed-in system admin's own, on
// the primary instance; RLS holds each row to its owner whatever is
// sent here.

export type WorkerFormState = { ok: false; message: string } | { ok: true; message?: string } | null;

const field = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === "string" ? v : "";
};

function checkWorker(name: string, instructions: string): string | null {
  if (!name.trim()) return "Give the worker a name.";
  if (name.trim().length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
  if (instructions.length > INSTRUCTIONS_MAX) return `Keep the instructions under ${INSTRUCTIONS_MAX.toLocaleString("en-US")} characters.`;
  return null;
}

// Allowed roles: system_admin.
export async function createWorkerAction(_prev: WorkerFormState, form: FormData): Promise<WorkerFormState> {
  await requireWorkers();
  const name = field(form, "name");
  const instructions = field(form, "instructions");
  const problem = checkWorker(name, instructions);
  if (problem) return { ok: false, message: problem };
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await db
    .from("workers")
    .insert({ name: name.trim(), instructions })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return { ok: false, message: "The worker couldn't be saved. Try again." };
  redirect(`/workers/${data.id}`);
}

// Allowed roles: system_admin.
export async function updateWorkerAction(workerId: string, _prev: WorkerFormState, form: FormData): Promise<WorkerFormState> {
  await requireWorkers();
  const name = field(form, "name");
  const instructions = field(form, "instructions");
  const problem = checkWorker(name, instructions);
  if (problem) return { ok: false, message: problem };
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await db
    .from("workers")
    .update({ name: name.trim(), instructions, updated_at: new Date().toISOString() })
    .eq("id", workerId)
    .select("id");
  if (error || !data?.length) return { ok: false, message: "The changes couldn't be saved. Try again." };
  revalidatePath(`/workers/${workerId}`);
  return { ok: true, message: "Saved." };
}

// Allowed roles: system_admin.
export async function archiveWorkerAction(workerId: string): Promise<void> {
  await requireWorkers();
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  await db.from("workers").update({ archived_at: new Date().toISOString() }).eq("id", workerId);
  revalidatePath("/workers");
  redirect("/workers");
}

// Allowed roles: system_admin.
//
// Saves the task, answers at once with the run's page, and does the task
// after the response, inside this request's function, as the person who
// pressed Start (runner.ts). The client is made here, before the
// response, so the run keeps their session.
export async function startRunAction(workerId: string, _prev: WorkerFormState, form: FormData): Promise<WorkerFormState> {
  await requireWorkers();
  const task = field(form, "task").trim();
  if (!task) return { ok: false, message: "Say what you want the worker to do." };
  if (task.length > TASK_MAX) return { ok: false, message: `Keep the task under ${TASK_MAX.toLocaleString("en-US")} characters.` };
  if (!browserbaseConfigured() || !process.env.ANTHROPIC_API_KEY) {
    return { ok: false, message: "Workers aren't set up on this server yet." };
  }
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: busy } = await db
    .from("worker_runs")
    .select("id")
    .eq("worker_id", workerId)
    .in("status", ["queued", "running"])
    .limit(1);
  if (busy?.length) return { ok: false, message: "This worker is still on a task. Wait for it to finish, or stop it." };
  const { data, error } = await db
    .from("worker_runs")
    .insert({ worker_id: workerId, task })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return { ok: false, message: "The task couldn't be started. Try again." };

  const runId = data.id;
  const go = async () => {
    try {
      await runWorker(db, runId);
    } catch (err) {
      console.error(`[workers] run ${runId} crashed:`, err);
    }
  };
  try {
    after(go);
  } catch {
    void go();
  }
  redirect(`/workers/${workerId}/runs/${runId}`);
}

// Allowed roles: system_admin.
export async function stopRunAction(workerId: string, runId: string): Promise<void> {
  await requireWorkers();
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  await db
    .from("worker_runs")
    .update({ status: "stopped", finished_at: new Date().toISOString() })
    .eq("id", runId)
    .in("status", ["queued", "running"]);
  revalidatePath(`/workers/${workerId}/runs/${runId}`);
}
