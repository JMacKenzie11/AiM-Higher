"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { requireWorkers } from "./access";
import { browserbaseConfigured } from "./browserbase";
import { runWorker, type RunContext } from "./runner";
import { teachSkill } from "./teach";
import { settleStalled } from "./stalled";
import { INSTRUCTIONS_MAX, NAME_MAX, questionExpired, TASK_MAX, type Pending } from "./types";

// Workers (0303). Every action is the signed-in system admin's own, on
// the primary instance; RLS holds each row to its owner whatever is
// sent here.

export type WorkerFormState = { ok: false; message: string } | { ok: true; message?: string } | null;

const field = (form: FormData, k: string) => {
  const v = form.get(k);
  return typeof v === "string" ? v : "";
};

async function ownerDb() {
  return createSupabaseServerClient(getCurrentInstanceConfig());
}

// Runs (or carries on) a task after the response, inside this request's
// function, as the person who pressed the button (runner.ts). The
// clients are made here, before the response, so the run keeps their
// session. A saved password is read with the service role, and only for
// a worker the owner's own client can read.
async function launch(runId: string) {
  const db = await ownerDb();
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const ctx: RunContext = {
    db,
    readPassword: async (workerId, name) => {
      const { data: mine } = await db.from("workers").select("id").eq("id", workerId).maybeSingle();
      if (!mine) return null;
      const { data } = await admin.rpc("worker_secret_value", { p_worker_id: workerId, p_label: name });
      return typeof data === "string" && data ? data : null;
    },
  };
  const go = async () => {
    try {
      await runWorker(ctx, runId);
    } catch (err) {
      console.error(`[workers] run ${runId} crashed:`, err);
    }
  };
  try {
    after(go);
  } catch {
    void go();
  }
}

function ready(): string | null {
  return browserbaseConfigured() && process.env.ANTHROPIC_API_KEY ? null : "Workers aren't set up on this server yet.";
}

// ---- Workers --------------------------------------------------------

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
  const db = await ownerDb();
  const { data, error } = await db.from("workers").insert({ name: name.trim(), instructions }).select("id").single<{ id: string }>();
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
  const db = await ownerDb();
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
  const db = await ownerDb();
  await db.from("workers").update({ archived_at: new Date().toISOString() }).eq("id", workerId);
  revalidatePath("/workers");
  redirect("/workers");
}

// ---- Tasks ----------------------------------------------------------

// Allowed roles: system_admin.
export async function startRunAction(workerId: string, _prev: WorkerFormState, form: FormData): Promise<WorkerFormState> {
  await requireWorkers();
  const task = field(form, "task").trim();
  if (!task) return { ok: false, message: "Say what you want the worker to do." };
  if (task.length > TASK_MAX) return { ok: false, message: `Keep the task under ${TASK_MAX.toLocaleString("en-US")} characters.` };
  const notReady = ready();
  if (notReady) return { ok: false, message: notReady };
  const db = await ownerDb();
  await settleStalled(db, workerId);
  const { data: busy } = await db
    .from("worker_runs")
    .select("id")
    .eq("worker_id", workerId)
    .in("status", ["queued", "running", "needs_you"])
    .limit(1);
  if (busy?.length) return { ok: false, message: "This worker is still on a task. Finish or stop that one first." };
  const { data, error } = await db.from("worker_runs").insert({ worker_id: workerId, task }).select("id").single<{ id: string }>();
  if (error || !data) return { ok: false, message: "The task couldn't be started. Try again." };
  await launch(data.id);
  redirect(`/workers/${workerId}/runs/${data.id}`);
}

// Allowed roles: system_admin.
export async function stopRunAction(workerId: string, runId: string): Promise<void> {
  await requireWorkers();
  const db = await ownerDb();
  await db
    .from("worker_runs")
    .update({ status: "stopped", finished_at: new Date().toISOString(), conversation: null })
    .eq("id", runId)
    .in("status", ["queued", "running", "needs_you"]);
  revalidatePath(`/workers/${workerId}/runs/${runId}`);
  revalidatePath("/workers");
}

// The task waiting on its owner, or why it can't take an answer.
async function waiting(runId: string): Promise<{ ok: true; pending: Pending; workerId: string } | { ok: false; message: string }> {
  const db = await ownerDb();
  const { data } = await db
    .from("worker_runs")
    .select("worker_id, status, pending, asked_at")
    .eq("id", runId)
    .maybeSingle<{ worker_id: string; status: string; pending: Pending | null; asked_at: string | null }>();
  if (!data || data.status !== "needs_you" || !data.pending) return { ok: false, message: "That task isn't waiting on you any more." };
  if (questionExpired(data.asked_at)) {
    await db
      .from("worker_runs")
      .update({ status: "expired", conversation: null, finished_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("status", "needs_you");
    revalidatePath("/workers");
    return { ok: false, message: "That question waited more than a day, so the task has stopped. Give the worker the task again." };
  }
  return { ok: true, pending: data.pending, workerId: data.worker_id };
}

// Hand the answer over and start the task again. Only from needs_you,
// so two presses cannot start it twice.
async function resume(runId: string, workerId: string, pending: Pending): Promise<WorkerFormState> {
  const notReady = ready();
  if (notReady) return { ok: false, message: notReady };
  const db = await ownerDb();
  const { data } = await db
    .from("worker_runs")
    .update({ status: "queued", pending: { ...pending, answered_at: new Date().toISOString() } })
    .eq("id", runId)
    .eq("status", "needs_you")
    .select("id");
  if (!data?.length) return { ok: false, message: "That task isn't waiting on you any more." };
  await launch(runId);
  revalidatePath("/workers");
  revalidatePath(`/workers/${workerId}/runs/${runId}`);
  return { ok: true };
}

// Allowed roles: system_admin.
export async function answerQuestionAction(runId: string, _prev: WorkerFormState, form: FormData): Promise<WorkerFormState> {
  await requireWorkers();
  const w = await waiting(runId);
  if (!w.ok) return w;
  if (w.pending.kind !== "question") return { ok: false, message: "That task is waiting for an approval, not an answer." };
  const answer = field(form, "answer");
  if (!answer.trim()) return { ok: false, message: "Type your answer first." };
  if (w.pending.password_for) {
    const db = await ownerDb();
    const { error } = await db.rpc("worker_secret_save", { p_worker_id: w.workerId, p_label: w.pending.password_for, p_value: answer });
    if (error) return { ok: false, message: "The password couldn't be saved. Try again." };
    return resume(runId, w.workerId, { ...w.pending, answer: { saved_password: w.pending.password_for } });
  }
  return resume(runId, w.workerId, { ...w.pending, answer: { text: answer.trim().slice(0, 4000) } });
}

// Allowed roles: system_admin.
export async function decideApprovalAction(runId: string, decision: "once" | "always" | "deny"): Promise<WorkerFormState> {
  await requireWorkers();
  const w = await waiting(runId);
  if (!w.ok) return w;
  if (w.pending.kind !== "approval") return { ok: false, message: "That task is waiting for an answer, not an approval." };
  if (decision === "always") {
    if (w.pending.always_asks) return { ok: false, message: "This kind of action always asks. Choose Allow once or Deny." };
    if (w.pending.domain) {
      const db = await ownerDb();
      await db.from("worker_rules").upsert(
        { worker_id: w.workerId, kind: "press", domain: w.pending.domain, decision: "allow" },
        { onConflict: "worker_id,kind,domain" }
      );
    }
  }
  return resume(runId, w.workerId, { ...w.pending, decision });
}

// ---- Permissions ----------------------------------------------------

// Allowed roles: system_admin.
export async function setAllowPressesAction(workerId: string, on: boolean): Promise<void> {
  await requireWorkers();
  const db = await ownerDb();
  await db.from("workers").update({ allow_presses: on, updated_at: new Date().toISOString() }).eq("id", workerId);
  revalidatePath(`/workers/${workerId}`);
}

// Allowed roles: system_admin.
export async function deleteRuleAction(workerId: string, ruleId: string): Promise<void> {
  await requireWorkers();
  const db = await ownerDb();
  await db.from("worker_rules").delete().eq("id", ruleId).eq("worker_id", workerId);
  revalidatePath(`/workers/${workerId}`);
}

// Allowed roles: system_admin.
export async function savePasswordAction(workerId: string, _prev: WorkerFormState, form: FormData): Promise<WorkerFormState> {
  await requireWorkers();
  const label = field(form, "label").trim();
  const value = field(form, "value");
  if (!label) return { ok: false, message: "Name the password, for example the website it's for." };
  if (label.length > 120) return { ok: false, message: "Keep the name under 120 characters." };
  if (!value) return { ok: false, message: "Type the password." };
  const db = await ownerDb();
  const { error } = await db.rpc("worker_secret_save", { p_worker_id: workerId, p_label: label, p_value: value });
  if (error) return { ok: false, message: "The password couldn't be saved. Try again." };
  revalidatePath(`/workers/${workerId}`);
  return { ok: true, message: "Saved." };
}

// Allowed roles: system_admin.
export async function deletePasswordAction(workerId: string, secretId: string): Promise<void> {
  await requireWorkers();
  const db = await ownerDb();
  await db.from("worker_secrets").delete().eq("id", secretId).eq("worker_id", workerId);
  revalidatePath(`/workers/${workerId}`);
}

// ---- Memory ---------------------------------------------------------

// Allowed roles: system_admin.
export async function saveMemoryAction(workerId: string, memoryId: string | null, _prev: WorkerFormState, form: FormData): Promise<WorkerFormState> {
  await requireWorkers();
  const title = field(form, "title").trim();
  const body = field(form, "body").trim();
  if (!title) return { ok: false, message: "Give the memory a title." };
  if (!body) return { ok: false, message: "Say what to remember." };
  if (title.length > 200 || body.length > 8000) return { ok: false, message: "Keep the title under 200 characters and the note under 8,000." };
  const db = await ownerDb();
  const { error } = memoryId
    ? await db.from("worker_memories").update({ title, body, updated_at: new Date().toISOString() }).eq("id", memoryId).eq("worker_id", workerId)
    : await db.from("worker_memories").insert({ worker_id: workerId, title, body });
  if (error) return { ok: false, message: "The memory couldn't be saved. Try again." };
  revalidatePath(`/workers/${workerId}`);
  return { ok: true, message: "Saved." };
}

// Allowed roles: system_admin.
export async function deleteMemoryAction(workerId: string, memoryId: string): Promise<void> {
  await requireWorkers();
  const db = await ownerDb();
  await db.from("worker_memories").delete().eq("id", memoryId).eq("worker_id", workerId);
  revalidatePath(`/workers/${workerId}`);
}

// ---- Teaching -------------------------------------------------------

// Allowed roles: system_admin.
//
// Writes a finished task up as a skill: the steps that worked, which
// the worker follows next time (teach.ts). Waits for the write-up, then
// opens the worker's skills.
export async function teachSkillAction(workerId: string, runId: string): Promise<WorkerFormState> {
  await requireWorkers();
  const db = await ownerDb();
  const result = await teachSkill(db, runId);
  if (!result.ok) return result;
  revalidatePath(`/workers/${workerId}`);
  redirect(`/workers/${workerId}#skills`);
}

// Allowed roles: system_admin.
export async function saveSkillAction(workerId: string, skillId: string, _prev: WorkerFormState, form: FormData): Promise<WorkerFormState> {
  await requireWorkers();
  const title = field(form, "title").trim();
  const body = field(form, "body").trim();
  if (!title || !body) return { ok: false, message: "A skill needs a title and its steps." };
  if (title.length > 200 || body.length > 16000) return { ok: false, message: "Keep the title under 200 characters and the steps under 16,000." };
  const db = await ownerDb();
  const { error } = await db.from("worker_skills").update({ title, body, updated_at: new Date().toISOString() }).eq("id", skillId).eq("worker_id", workerId);
  if (error) return { ok: false, message: "The skill couldn't be saved. Try again." };
  revalidatePath(`/workers/${workerId}`);
  return { ok: true, message: "Saved." };
}

// Allowed roles: system_admin.
export async function deleteSkillAction(workerId: string, skillId: string): Promise<void> {
  await requireWorkers();
  const db = await ownerDb();
  await db.from("worker_skills").delete().eq("id", skillId).eq("worker_id", workerId);
  revalidatePath(`/workers/${workerId}`);
}
