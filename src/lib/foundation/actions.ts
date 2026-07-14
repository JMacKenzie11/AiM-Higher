"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  CompanyFoundation,
  FoundationItem,
  FoundationItemKind,
  MarketingSnippet,
  MarketingSnippetKind,
  MarketingStrategy,
  MessagingPillar,
} from "@/lib/types";

// Foundation + marketing server actions — Sections 4.6 and 4.7.
// All writes are admin-only. RLS enforces the same rule.

export type Result<T> =
  | { ok: true; item: T }
  | { ok: false; message: string };

function scopedCompanyId(
  session: { profile: { role: string; company_id: string | null } },
  formCompanyId: string
): string | null {
  if (session.profile.role === "system_admin") {
    return formCompanyId || session.profile.company_id;
  }
  return session.profile.company_id;
}

function nullableString(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  return value.length === 0 ? null : value;
}

// =============================================================
// company_foundation (upsert singleton)
// =============================================================
export async function upsertFoundationAction(
  _prev: Result<CompanyFoundation> | undefined,
  formData: FormData
): Promise<Result<CompanyFoundation>> {
  const session = await requireRole(["system_admin", "company_admin"]);
  const companyId = scopedCompanyId(
    session,
    String(formData.get("company_id") ?? "")
  );
  if (!companyId) return { ok: false, message: "Pick a company first." };

  const payload = {
    company_id: companyId,
    purpose_statement: nullableString(formData.get("purpose_statement")),
    purpose_context: nullableString(formData.get("purpose_context")),
    vision_title: nullableString(formData.get("vision_title")),
    vision_tagline: nullableString(formData.get("vision_tagline")),
    vision_body: nullableString(formData.get("vision_body")),
  };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("company_foundation")
    .upsert(payload, { onConflict: "company_id" })
    .select("*")
    .single<CompanyFoundation>();
  if (error || !data) return { ok: false, message: "Couldn't save." };

  revalidatePath("/foundation");
  return { ok: true, item: data };
}

// =============================================================
// foundation_items (values / vision milestones / differentiators)
// =============================================================
export async function createFoundationItemAction(
  _prev: Result<FoundationItem> | undefined,
  formData: FormData
): Promise<Result<FoundationItem>> {
  const session = await requireRole(["system_admin", "company_admin"]);
  const companyId = scopedCompanyId(
    session,
    String(formData.get("company_id") ?? "")
  );
  if (!companyId) return { ok: false, message: "Pick a company first." };

  const kindRaw = String(formData.get("kind") ?? "");
  const kind = validateItemKind(kindRaw);
  if (!kind) return { ok: false, message: "Invalid item kind." };

  const title = String(formData.get("title") ?? "").trim();
  const body = nullableString(formData.get("body"));
  if (!title) return { ok: false, message: "Give this a title." };

  const supabase = await createSupabaseServerClient();

  // Compute next sort_order so new items land at the bottom.
  const { data: existing } = await supabase
    .from("foundation_items")
    .select("sort_order")
    .eq("company_id", companyId)
    .eq("kind", kind)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort =
    existing && existing.length > 0 ? (existing[0].sort_order ?? 0) + 1 : 0;

  const { data, error } = await supabase
    .from("foundation_items")
    .insert({
      company_id: companyId,
      kind,
      title,
      body,
      sort_order: nextSort,
    })
    .select("*")
    .single<FoundationItem>();
  if (error || !data) return { ok: false, message: "Couldn't add that." };

  revalidatePath("/foundation");
  return { ok: true, item: data };
}

export async function updateFoundationItemAction(
  _prev: Result<FoundationItem> | undefined,
  formData: FormData
): Promise<Result<FoundationItem>> {
  await requireRole(["system_admin", "company_admin"]);
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const body = nullableString(formData.get("body"));
  if (!id || !title) return { ok: false, message: "Missing title or id." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("foundation_items")
    .update({ title, body })
    .eq("id", id)
    .select("*")
    .single<FoundationItem>();
  if (error || !data) return { ok: false, message: "Couldn't save." };

  revalidatePath("/foundation");
  return { ok: true, item: data };
}

export async function deleteFoundationItemAction(
  itemId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("foundation_items")
    .delete()
    .eq("id", itemId);
  if (error) return { ok: false, message: "Couldn't delete." };
  revalidatePath("/foundation");
  return { ok: true };
}

export async function moveFoundationItemAction(
  itemId: string,
  direction: "up" | "down"
): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();

  const { data: item } = await supabase
    .from("foundation_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle<FoundationItem>();
  if (!item) return { ok: false, message: "Not found." };

  const compare = direction === "up" ? "lt" : "gt";
  const orderDirection = direction === "up" ? false : true; // asc for down, desc for up
  const { data: neighbourRows } = await supabase
    .from("foundation_items")
    .select("*")
    .eq("company_id", item.company_id)
    .eq("kind", item.kind)
    [compare]("sort_order", item.sort_order)
    .order("sort_order", { ascending: orderDirection })
    .limit(1);
  const neighbour = (neighbourRows ?? [])[0] as FoundationItem | undefined;
  if (!neighbour) return { ok: true }; // already at edge

  // Swap sort_order. Two updates in sequence; a briefly-inconsistent
  // ordering during the swap is acceptable at v1 volumes.
  await supabase
    .from("foundation_items")
    .update({ sort_order: neighbour.sort_order })
    .eq("id", item.id);
  await supabase
    .from("foundation_items")
    .update({ sort_order: item.sort_order })
    .eq("id", neighbour.id);

  revalidatePath("/foundation");
  return { ok: true };
}

function validateItemKind(raw: string): FoundationItemKind | null {
  if (
    raw === "core_value" ||
    raw === "vision_milestone" ||
    raw === "differentiator"
  ) {
    return raw;
  }
  return null;
}

// =============================================================
// marketing_strategy (upsert singleton)
// =============================================================
export async function upsertMarketingAction(
  _prev: Result<MarketingStrategy> | undefined,
  formData: FormData
): Promise<Result<MarketingStrategy>> {
  const session = await requireRole(["system_admin", "company_admin"]);
  const companyId = scopedCompanyId(
    session,
    String(formData.get("company_id") ?? "")
  );
  if (!companyId) return { ok: false, message: "Pick a company first." };

  const payload = {
    company_id: companyId,
    positioning_statement: nullableString(formData.get("positioning_statement")),
    executive_summary: nullableString(formData.get("executive_summary")),
    anchoring_message: nullableString(formData.get("anchoring_message")),
  };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("marketing_strategy")
    .upsert(payload, { onConflict: "company_id" })
    .select("*")
    .single<MarketingStrategy>();
  if (error || !data) return { ok: false, message: "Couldn't save." };

  revalidatePath("/foundation");
  return { ok: true, item: data };
}

// =============================================================
// messaging_pillars
// =============================================================
export async function createPillarAction(
  _prev: Result<MessagingPillar> | undefined,
  formData: FormData
): Promise<Result<MessagingPillar>> {
  const session = await requireRole(["system_admin", "company_admin"]);
  const companyId = scopedCompanyId(
    session,
    String(formData.get("company_id") ?? "")
  );
  if (!companyId) return { ok: false, message: "Pick a company first." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Give this pillar a name." };
  const message = nullableString(formData.get("message"));
  const languageBank = parseLanguageBank(formData.get("language_bank"));

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("messaging_pillars")
    .select("sort_order")
    .eq("company_id", companyId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort =
    existing && existing.length > 0 ? (existing[0].sort_order ?? 0) + 1 : 0;

  const { data, error } = await supabase
    .from("messaging_pillars")
    .insert({
      company_id: companyId,
      name,
      message,
      language_bank: languageBank,
      sort_order: nextSort,
    })
    .select("*")
    .single<MessagingPillar>();
  if (error || !data) return { ok: false, message: "Couldn't add that." };

  revalidatePath("/foundation");
  return { ok: true, item: data };
}

export async function updatePillarAction(
  _prev: Result<MessagingPillar> | undefined,
  formData: FormData
): Promise<Result<MessagingPillar>> {
  await requireRole(["system_admin", "company_admin"]);
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const message = nullableString(formData.get("message"));
  const languageBank = parseLanguageBank(formData.get("language_bank"));
  if (!id || !name) return { ok: false, message: "Missing name or id." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("messaging_pillars")
    .update({ name, message, language_bank: languageBank })
    .eq("id", id)
    .select("*")
    .single<MessagingPillar>();
  if (error || !data) return { ok: false, message: "Couldn't save." };

  revalidatePath("/foundation");
  return { ok: true, item: data };
}

export async function deletePillarAction(
  pillarId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("messaging_pillars")
    .delete()
    .eq("id", pillarId);
  if (error) return { ok: false, message: "Couldn't delete." };
  revalidatePath("/foundation");
  return { ok: true };
}

// The language bank is a textarea, one phrase per line. Blank lines
// are dropped. Kept as a JSON array in the DB for future queryability.
function parseLanguageBank(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// =============================================================
// marketing_snippets
// =============================================================
const SNIPPET_KINDS: MarketingSnippetKind[] = [
  "short_hook",
  "long_hook",
  "website_copy",
  "avoid",
  "icp_best_fit",
  "icp_psychographic",
  "elevated_phrase",
];

export async function createSnippetAction(
  _prev: Result<MarketingSnippet> | undefined,
  formData: FormData
): Promise<Result<MarketingSnippet>> {
  const session = await requireRole(["system_admin", "company_admin"]);
  const companyId = scopedCompanyId(
    session,
    String(formData.get("company_id") ?? "")
  );
  if (!companyId) return { ok: false, message: "Pick a company first." };

  const kindRaw = String(formData.get("kind") ?? "");
  if (!SNIPPET_KINDS.includes(kindRaw as MarketingSnippetKind)) {
    return { ok: false, message: "Invalid snippet kind." };
  }
  const kind = kindRaw as MarketingSnippetKind;
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return { ok: false, message: "Write something." };

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("marketing_snippets")
    .select("sort_order")
    .eq("company_id", companyId)
    .eq("kind", kind)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort =
    existing && existing.length > 0 ? (existing[0].sort_order ?? 0) + 1 : 0;

  const { data, error } = await supabase
    .from("marketing_snippets")
    .insert({
      company_id: companyId,
      kind,
      content,
      sort_order: nextSort,
    })
    .select("*")
    .single<MarketingSnippet>();
  if (error || !data) return { ok: false, message: "Couldn't add that." };

  revalidatePath("/foundation");
  return { ok: true, item: data };
}

export async function deleteSnippetAction(
  snippetId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireRole(["system_admin", "company_admin"]);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("marketing_snippets")
    .delete()
    .eq("id", snippetId);
  if (error) return { ok: false, message: "Couldn't delete." };
  revalidatePath("/foundation");
  return { ok: true };
}
