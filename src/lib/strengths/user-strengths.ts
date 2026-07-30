"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UserStrength } from "@/lib/types";

// Manual strengths + superpowers per user. These feed the coaching
// context directly — no strengths assessment required. Editable by:
//   - the user themselves
//   - system_admin (any user)
//   - company_admin (users in their company)
// Enforced both here (server action) and by RLS on user_strengths.

export type UserStrengthsView = {
  strengths: UserStrength[];
  superpowers: UserStrength[];
};

export async function getUserStrengths(userId: string): Promise<UserStrengthsView> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("user_strengths")
    .select("*")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true });

  const rows = (data ?? []) as UserStrength[];
  return {
    strengths: rows.filter((r) => r.kind === "strength"),
    superpowers: rows.filter((r) => r.kind === "superpower"),
  };
}

export type SaveStrengthsResult =
  | { ok: true }
  | { ok: false; message: string };

// Replace-all semantics: takes the current form values as truth and
// resets the user's strengths + superpowers to match. Simpler than
// diffing, and the row count is small.
export async function saveUserStrengthsAction(
  _prev: SaveStrengthsResult | undefined,
  formData: FormData
): Promise<SaveStrengthsResult> {
  const session = await requireProfile();
  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return { ok: false, message: "Missing user id." };

  // Authorization: self, system_admin, or same-company company_admin.
  if (userId !== session.profile.id) {
    if (session.profile.role === "system_admin") {
      // ok
    } else if (session.profile.role === "company_admin") {
      const supabase = await createSupabaseServerClient();
      const { data: target } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", userId)
        .maybeSingle<{ company_id: string | null }>();
      if (!target || target.company_id !== session.profile.company_id) {
        return { ok: false, message: "Not your user to edit." };
      }
    } else {
      return { ok: false, message: "You can't edit that user's strengths." };
    }
  }

  const strengths = formData
    .getAll("strength_label")
    .map((v) => String(v).trim())
    .filter(Boolean);
  const superpowers = formData
    .getAll("superpower_label")
    .map((v) => String(v).trim())
    .filter(Boolean);

  const supabase = await createSupabaseServerClient();

  // Replace-all: delete existing rows, insert the new set.
  const { error: delErr } = await supabase
    .from("user_strengths")
    .delete()
    .eq("user_id", userId);
  if (delErr) return { ok: false, message: "Couldn't save your strengths." };

  const rows = [
    ...strengths.map((label, i) => ({
      user_id: userId,
      kind: "strength" as const,
      label,
      sort_order: i,
    })),
    ...superpowers.map((label, i) => ({
      user_id: userId,
      kind: "superpower" as const,
      label,
      sort_order: i,
    })),
  ];
  if (rows.length > 0) {
    const { error: insErr } = await supabase.from("user_strengths").insert(rows);
    if (insErr) return { ok: false, message: "Couldn't save your strengths." };
  }

  revalidatePath("/profile");
  revalidatePath(`/people/${userId}/strengths`);
  return { ok: true };
}
