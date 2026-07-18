"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AnnualGoal, Priority } from "@/lib/types";

// Cascade completion. Completing a priority also closes its open
// commitments as kept (the "priority hit its goal, credit the work"
// default). If some commitments were actually abandoned, the operator
// cancels the confirm modal and resolves them individually as Closed
// first. Goal-level Complete cascades through priorities to
// commitments.

export type CascadeResult =
  | { ok: true; commitmentsClosedCount: number; prioritiesCompletedCount?: number }
  | { ok: false; message: string };

export async function completePriorityAction(
  priorityId: string
): Promise<CascadeResult> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();

  const { data: priority } = await supabase
    .from("priorities")
    .select("id, company_id, annual_goal_id")
    .eq("id", priorityId)
    .maybeSingle<Pick<Priority, "id" | "company_id" | "annual_goal_id">>();
  if (!priority) return { ok: false, message: "Priority not found." };

  // Cascade first so we know how many rows changed before the priority
  // update triggers a re-render.
  const closed = await cascadeClosePriorityCommitments(
    supabase,
    priorityId
  );
  if (closed === null) {
    return {
      ok: false,
      message: "Couldn't close the open commitments — priority left unchanged.",
    };
  }

  const { error } = await supabase
    .from("priorities")
    .update({ status: "complete" })
    .eq("id", priorityId);
  if (error) {
    return { ok: false, message: "Commitments closed, but couldn't mark the priority complete." };
  }

  revalidatePath("/plan");
  revalidatePath(`/plan/priority/${priorityId}`);
  revalidatePath("/commitments");
  revalidatePath("/dashboard");
  return { ok: true, commitmentsClosedCount: closed };
}

export async function completeGoalAction(
  goalId: string
): Promise<CascadeResult> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();

  const { data: goal } = await supabase
    .from("annual_goals")
    .select("id, company_id")
    .eq("id", goalId)
    .maybeSingle<Pick<AnnualGoal, "id" | "company_id">>();
  if (!goal) return { ok: false, message: "Goal not found." };

  // Non-archived priorities under this goal, whatever their current
  // status. Cascade closes their open commitments and marks them
  // complete. Already-complete ones are re-flagged (no-op).
  const { data: priorityRows } = await supabase
    .from("priorities")
    .select("id")
    .eq("annual_goal_id", goalId)
    .eq("archived", false);
  const priorityIds = (priorityRows ?? []).map((row) => row.id);

  let totalClosed = 0;
  for (const priorityId of priorityIds) {
    const closed = await cascadeClosePriorityCommitments(
      supabase,
      priorityId
    );
    if (closed === null) {
      return {
        ok: false,
        message: "Couldn't close some open commitments — goal left unchanged.",
      };
    }
    totalClosed += closed;
  }

  if (priorityIds.length > 0) {
    const { error } = await supabase
      .from("priorities")
      .update({ status: "complete" })
      .in("id", priorityIds);
    if (error) {
      return {
        ok: false,
        message: "Commitments closed, but couldn't mark the priorities complete.",
      };
    }
  }

  const { error: goalError } = await supabase
    .from("annual_goals")
    .update({ status: "complete" })
    .eq("id", goalId);
  if (goalError) {
    return {
      ok: false,
      message: "Priorities updated, but couldn't mark the goal complete.",
    };
  }

  revalidatePath("/plan");
  revalidatePath(`/plan/goal/${goalId}`);
  revalidatePath("/commitments");
  revalidatePath("/dashboard");
  return {
    ok: true,
    commitmentsClosedCount: totalClosed,
    prioritiesCompletedCount: priorityIds.length,
  };
}

// Close every open commitment under a priority as kept. Returns the
// count on success, null on failure (caller decides how to react).
async function cascadeClosePriorityCommitments(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  priorityId: string
): Promise<number | null> {
  const { data: openRows } = await supabase
    .from("commitments")
    .select("id")
    .eq("priority_id", priorityId)
    .eq("status", "open");
  const openIds = (openRows ?? []).map((r) => r.id);
  if (openIds.length === 0) return 0;

  const { error } = await supabase
    .from("commitments")
    .update({
      status: "kept",
      completed_at: new Date().toISOString(),
      missed_reason: null,
    })
    .in("id", openIds);
  if (error) return null;
  return openIds.length;
}
