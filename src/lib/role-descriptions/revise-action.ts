"use server";

import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { createPracticeConversation } from "@/lib/practices/create";
import { leadsFunction } from "@/lib/practices/function-leads";

// Open a conversation to revise a saved role description.
//
// The same four who can save one can open a revision, checked here
// rather than left to the save at the end: sending somebody through
// an eight-question interview and refusing them at Save is the
// shape of a feature people stop using.
//
// The role is recorded ON the new conversation, which is what makes
// a colleague's document revisable at all. The original conversation
// is private to whoever held it — that is the coach's privacy model
// and it is not changing — so a second admin is always somewhere
// new, and without this the save would have no idea what it was
// extending.

export async function reviseRoleDescriptionAction(
  roleId: string
): Promise<{ ok: false; message: string } | never> {
  const session = await requireProfile();
  if (!roleId) return { ok: false, message: "Missing role." };

  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: role } = await db
    .from("role_descriptions")
    .select("id, company_id, function_id")
    .eq("id", roleId)
    .maybeSingle<{
      id: string;
      company_id: string;
      function_id: string | null;
    }>();
  // RLS already scopes the read to the caller's company, so a null
  // here is "gone or not yours" and both answers are the same one.
  if (!role) return { ok: false, message: "That role description is gone." };

  const isAdmin = isAdminForCompany(session.profile, role.company_id);
  const isLead =
    !isAdmin &&
    role.function_id !== null &&
    (await leadsFunction(session.profile.id, role.function_id));
  if (!isAdmin && !isLead) {
    return {
      ok: false,
      message:
        role.function_id === null
          ? "Only an admin can revise a role description that isn't on the chart."
          : "You can only revise the role description for a function you lead.",
    };
  }

  const created = await createPracticeConversation("role-description", {
    revisingRoleId: roleId,
  });
  if (!created.ok) return created;

  redirect(`/ask-aimee/${created.item.id}`);
}
