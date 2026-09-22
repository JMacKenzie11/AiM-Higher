"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getAccessForConversation } from "@/lib/coach/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { parseRoleDescription } from "./parse-document";

// Save a role description the agent proposed.
//
// Nothing lands in the database until this runs. The agent proposes
// and the card's Save is the human's confirmation, which is why
// there is no auto-save anywhere in this feature and why a revision
// in conversation produces a fresh card with its own Save rather
// than overwriting the last one.
//
// ---- WHAT IT WRITES --------------------------------------------
//
// A new row in role_description_versions every time. Never an
// update: versions are immutable snapshots and the table has no
// UPDATE policy to make one possible. Saving twice is two versions,
// which is the point.
//
// ---- WHICH ROLE IT EXTENDS -------------------------------------
//
// Three answers, tried in order, and the order matters:
//
//   1. A role this CONVERSATION has already saved. Two saves in one
//      sitting are two versions of one role, not two roles.
//   2. For an on-chart role, the role row for that function. A
//      second conversation about the Marketing seat extends the
//      Marketing seat's history.
//   3. Otherwise a new role. An off-chart role written in a fresh
//      conversation cannot be matched to an earlier one by anything
//      we actually know — the titles might match by coincidence and
//      might differ by choice — so it starts its own history rather
//      than guessing its way into somebody else's.
//
// ---- THE BOUNDARY ----------------------------------------------
//
// Same argument applyChartProposalAction makes, for the same
// reasons. The company is the CONVERSATION'S, never the caller's
// scope cookie, because a system admin can scope elsewhere while
// the conversation stays put and the saved document would land on
// the wrong tenant. Access to act on the conversation is owner or
// write-share; a read-only sharee can see the card and not press
// the button. And the write itself is gated on isAdminForCompany
// for that company, which is the app-layer boundary this path uses.

export type SaveRoleDescriptionResult =
  | { ok: true; roleId: string; versionNumber: number }
  | { ok: false; message: string };

export async function saveRoleDescriptionAction(
  documentJson: string,
  conversationId: string
): Promise<SaveRoleDescriptionResult> {
  // Re-validated on the server. The client already parsed it; we
  // trust nothing that came off the wire.
  const doc = parseRoleDescription(documentJson);
  if (!doc) {
    return { ok: false, message: "That role description isn't in the right shape." };
  }
  if (!conversationId) {
    return { ok: false, message: "Missing conversation reference." };
  }

  const session = await requireProfile();
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());

  const { data: convo } = await admin
    .from("coaching_conversations")
    .select("id, company_id")
    .eq("id", conversationId)
    .maybeSingle<{ id: string; company_id: string }>();
  if (!convo) {
    return { ok: false, message: "Couldn't find that conversation." };
  }

  const access = await getAccessForConversation(
    conversationId,
    session.profile.id
  );
  if (access !== "owner" && access !== "write") {
    return {
      ok: false,
      message:
        access === "read"
          ? "You have read-only access to this chat, so you can't save it."
          : "Not yours to save.",
    };
  }

  const companyId = convo.company_id;
  if (!isAdminForCompany(session.profile, companyId)) {
    return { ok: false, message: "You can't save role descriptions for this company." };
  }

  // The caller's own client from here, so RLS is the boundary on
  // every write below rather than the check above being the only
  // thing standing between a payload and the table.
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());

  const roleId = await resolveRoleId(db, {
    companyId,
    conversationId,
    functionId: doc.function?.id ?? null,
    title: doc.title,
    supportsFunctions: doc.supports_functions,
    createdBy: session.profile.id,
  });
  if (!roleId) {
    return { ok: false, message: "Couldn't create a record for that role." };
  }

  // max + 1, read on the caller's client so a version cannot be
  // numbered against rows they cannot see.
  const { data: latest } = await db
    .from("role_description_versions")
    .select("version_number")
    .eq("role_id", roleId)
    .order("version_number", { ascending: false })
    .limit(1);
  const versionNumber =
    latest && latest.length > 0
      ? ((latest[0] as { version_number: number }).version_number ?? 0) + 1
      : 1;

  const { error } = await db.from("role_description_versions").insert({
    role_id: roleId,
    company_id: companyId,
    // Kept alongside role_id for every reader that still queries by
    // function. Null for an off-chart role, which is what 0221 made
    // possible.
    function_id: doc.function?.id ?? null,
    version_number: versionNumber,
    body_json: doc,
    // NOT NULL on the table since 0129 and written by the old
    // generator. The agent's document lives in body_json; this
    // column says "not from the generator" by being empty.
    snapshot_document: {},
    source_conversation_id: conversationId,
    published_by: session.profile.id,
  });
  if (error) {
    return { ok: false, message: "Couldn't save that role description." };
  }

  revalidatePath("/people");
  if (doc.function?.id) {
    revalidatePath(`/chart/function/${doc.function.id}/role-description`);
    revalidatePath(`/chart/function/${doc.function.id}`);
  }
  return { ok: true, roleId, versionNumber };
}

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function resolveRoleId(
  db: Db,
  args: {
    companyId: string;
    conversationId: string;
    functionId: string | null;
    title: string;
    supportsFunctions: string[];
    createdBy: string;
  }
): Promise<string | null> {
  // 1. This conversation has saved before.
  const { data: mine } = await db
    .from("role_description_versions")
    .select("role_id")
    .eq("source_conversation_id", args.conversationId)
    .limit(1);
  if (mine && mine.length > 0) {
    return (mine[0] as { role_id: string }).role_id;
  }

  // 2. The function already has a role row.
  if (args.functionId) {
    const { data: byFunction } = await db
      .from("role_descriptions")
      .select("id")
      .eq("function_id", args.functionId)
      .limit(1);
    if (byFunction && byFunction.length > 0) {
      const id = (byFunction[0] as { id: string }).id;
      // Keep the title current: the agent may have named the seat
      // something the chart does not, and the list reads by this.
      await db
        .from("role_descriptions")
        .update({ title: args.title })
        .eq("id", id);
      return id;
    }
  }

  // 3. A new role.
  const { data: created } = await db
    .from("role_descriptions")
    .insert({
      company_id: args.companyId,
      function_id: args.functionId,
      title: args.title,
      supports_functions: args.supportsFunctions,
      created_by: args.createdBy,
    })
    .select("id")
    .single<{ id: string }>();
  return created?.id ?? null;
}
