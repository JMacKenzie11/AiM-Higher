"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { VALID_COMPANY_FEATURES } from "@/lib/companies/features";
import { HUB_ROLE_VALUES, FUNCTION_LEAD_PREDICATE } from "./hub-constants";

// System-admin writes for the Agent Hub.
//
// RLS is the boundary: every policy on `agents` and
// `agent_categories` requires system_admin (0226). requireRole here
// fails fast with a message a human can read, before the round trip.
//
// NOTHING HERE TOUCHES A PROMPT. Identity and access only. Prompts
// stay in the registry until phase 2 gives them an immutable,
// versioned home that a running conversation can be pinned to.

export type HubResult =
  | { ok: true }
  | { ok: false; message: string };

function refreshAgentSurfaces() {
  revalidatePath("/admin/agents");
  // Every picker and every launched conversation reads the merge, so
  // a rename that showed only on the Hub would be the change not
  // having happened.
  revalidatePath("/ask-aimee", "layout");
}

async function db() {
  return createSupabaseServerClient(getCurrentInstanceConfig());
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ---- Agent identity -------------------------------------------

export async function updateAgentIdentityAction(
  id: string,
  fields: { title: string; description: string }
): Promise<HubResult> {
  await requireRole(["system_admin"]);
  const title = fields.title.trim();
  const description = fields.description.trim();
  if (!title) return { ok: false, message: "Give the agent a name." };
  if (title.length > 80) {
    return { ok: false, message: "Keep the name under 80 characters." };
  }
  if (!description) {
    return {
      ok: false,
      message: "Give the agent a description. It is the line under the name on the card.",
    };
  }
  if (description.length > 300) {
    return { ok: false, message: "Keep the description under 300 characters." };
  }

  const supabase = await db();
  const { error } = await supabase
    .from("agents")
    .update({ title, description })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't save that change." };
  refreshAgentSurfaces();
  return { ok: true };
}

// ---- Agent placement ------------------------------------------

// Moving between categories puts the agent last in the destination.
// Dropping it into the middle of a list it has never been in has no
// natural answer, and last is the one an admin can see and fix.
export async function moveAgentToCategoryAction(
  id: string,
  categoryId: string
): Promise<HubResult> {
  await requireRole(["system_admin"]);
  const supabase = await db();

  const { data: category } = await supabase
    .from("agent_categories")
    .select("id, archived")
    .eq("id", categoryId)
    .maybeSingle<{ id: string; archived: boolean }>();
  if (!category) return { ok: false, message: "That category no longer exists." };
  if (category.archived) {
    return {
      ok: false,
      message: "That category is archived. Restore it before moving agents into it.",
    };
  }

  const { data: siblings } = await supabase
    .from("agents")
    .select("sort_order")
    .eq("category_id", categoryId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const last = (siblings ?? [])[0] as { sort_order: number } | undefined;

  const { error } = await supabase
    .from("agents")
    .update({
      category_id: categoryId,
      sort_order: last ? last.sort_order + 1 : 0,
    })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't move that agent." };
  refreshAgentSurfaces();
  return { ok: true };
}

// Up and down rather than drag. The list is five rows in three
// groups; drag would be more code and more ways to be wrong, and the
// Classroom admin surface next door already moves lessons this way.
export async function moveAgentAction(
  id: string,
  direction: "up" | "down"
): Promise<HubResult> {
  await requireRole(["system_admin"]);
  const supabase = await db();

  const { data: agent } = await supabase
    .from("agents")
    .select("id, category_id, sort_order")
    .eq("id", id)
    .maybeSingle<{ id: string; category_id: string; sort_order: number }>();
  if (!agent) return { ok: false, message: "That agent no longer exists." };

  const { data: rows } = await supabase
    .from("agents")
    .select("id, sort_order")
    .eq("category_id", agent.category_id)
    .order("sort_order");
  const siblings = (rows ?? []) as Array<{ id: string; sort_order: number }>;
  const index = siblings.findIndex((s) => s.id === id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  // Already at the end. Not an error: the button is disabled there,
  // and a race that gets past it should do nothing rather than fail.
  if (index === -1 || swapWith < 0 || swapWith >= siblings.length) {
    return { ok: true };
  }

  const a = siblings[index];
  const b = siblings[swapWith];
  // Positions are rewritten from array order rather than swapping the
  // two stored values, because seeded rows can share a sort_order and
  // swapping equal numbers moves nothing.
  const reordered = [...siblings];
  reordered[index] = b;
  reordered[swapWith] = a;
  for (const [i, row] of reordered.entries()) {
    const { error } = await supabase
      .from("agents")
      .update({ sort_order: i })
      .eq("id", row.id);
    if (error) return { ok: false, message: "Couldn't reorder those agents." };
  }
  refreshAgentSurfaces();
  return { ok: true };
}

// ---- Agent access ---------------------------------------------

export async function updateAgentAccessAction(
  id: string,
  fields: {
    allowedRoles: string[];
    feature: string | null;
    functionLead: boolean;
    companyAllowlist: string[];
  }
): Promise<HubResult> {
  await requireRole(["system_admin"]);

  const roles = [...new Set(fields.allowedRoles)];
  for (const role of roles) {
    if (!HUB_ROLE_VALUES.has(role)) {
      return { ok: false, message: "That isn't a role this system has." };
    }
  }
  if (fields.feature && !VALID_COMPANY_FEATURES.has(fields.feature)) {
    return { ok: false, message: "That isn't a feature this system has." };
  }

  const supabase = await db();
  const { error } = await supabase
    .from("agents")
    .update({
      // Empty is stored as empty, which the merge reads as "every
      // role" — the same thing a registry entry with no allowedRoles
      // means. Ticking nothing widens rather than locks out, which
      // the help text beside the control says out loud.
      allowed_roles: roles,
      feature: fields.feature || null,
      access_predicates: fields.functionLead ? [FUNCTION_LEAD_PREDICATE] : [],
      company_allowlist: [...new Set(fields.companyAllowlist)],
    })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't save that access change." };
  refreshAgentSurfaces();
  return { ok: true };
}

// ---- Archive ---------------------------------------------------

// Hides the agent from every picker. Conversations already attached
// to it keep working and keep their name: the runtime resolves them
// through listAgentsIncludingArchived, which an archived row does not
// drop. This is why archive exists instead of delete.
export async function setAgentArchivedAction(
  id: string,
  archived: boolean
): Promise<HubResult> {
  await requireRole(["system_admin"]);
  const supabase = await db();
  const { error } = await supabase
    .from("agents")
    .update({ archived })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't change that agent." };
  refreshAgentSurfaces();
  return { ok: true };
}

// ---- Categories ------------------------------------------------

export async function createHubCategoryAction(
  name: string
): Promise<HubResult> {
  await requireRole(["system_admin"]);
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: "Give the category a name." };
  if (trimmed.length > 60) {
    return { ok: false, message: "Keep the category name under 60 characters." };
  }
  const slug = slugify(trimmed);
  if (!slug) {
    return { ok: false, message: "Give the category a name with letters in it." };
  }

  const supabase = await db();
  const { data: last } = await supabase
    .from("agent_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const tail = (last ?? [])[0] as { sort_order: number } | undefined;

  const { error } = await supabase.from("agent_categories").insert({
    name: trimmed,
    slug,
    sort_order: tail ? tail.sort_order + 1 : 0,
  });
  if (error) {
    return {
      ok: false,
      message: "Couldn't create that category. There may already be one with that name.",
    };
  }
  refreshAgentSurfaces();
  return { ok: true };
}

// The display name only. The slug stays put: it is the join key the
// merge uses, and rewriting it would detach every agent in the
// category from its heading.
export async function renameHubCategoryAction(
  id: string,
  name: string
): Promise<HubResult> {
  await requireRole(["system_admin"]);
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: "Category name can't be empty." };
  if (trimmed.length > 60) {
    return { ok: false, message: "Keep the category name under 60 characters." };
  }
  const supabase = await db();
  const { error } = await supabase
    .from("agent_categories")
    .update({ name: trimmed })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't rename that category." };
  refreshAgentSurfaces();
  return { ok: true };
}

export async function moveHubCategoryAction(
  id: string,
  direction: "up" | "down"
): Promise<HubResult> {
  await requireRole(["system_admin"]);
  const supabase = await db();
  const { data: rows } = await supabase
    .from("agent_categories")
    .select("id, sort_order")
    .order("sort_order");
  const all = (rows ?? []) as Array<{ id: string; sort_order: number }>;
  const index = all.findIndex((c) => c.id === id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapWith < 0 || swapWith >= all.length) {
    return { ok: true };
  }
  const reordered = [...all];
  reordered[index] = all[swapWith];
  reordered[swapWith] = all[index];
  for (const [i, row] of reordered.entries()) {
    const { error } = await supabase
      .from("agent_categories")
      .update({ sort_order: i })
      .eq("id", row.id);
    if (error) {
      return { ok: false, message: "Couldn't reorder those categories." };
    }
  }
  refreshAgentSurfaces();
  return { ok: true };
}

// Refused while the category still holds agents, archived ones
// included. Allowing it would leave those agents pointing at a
// heading no picker renders and no editor lists, which is a state
// with no way back out from this screen.
export async function setHubCategoryArchivedAction(
  id: string,
  archived: boolean
): Promise<HubResult> {
  await requireRole(["system_admin"]);
  const supabase = await db();

  if (archived) {
    const { count } = await supabase
      .from("agents")
      .select("id", { count: "exact", head: true })
      .eq("category_id", id);
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        message:
          "Move its agents to another category first. Archiving this one would leave them with nowhere to appear.",
      };
    }
  }

  const { error } = await supabase
    .from("agent_categories")
    .update({ archived })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't change that category." };
  refreshAgentSurfaces();
  return { ok: true };
}
