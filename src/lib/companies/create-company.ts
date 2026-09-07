import type { SupabaseClient } from "@supabase/supabase-js";

import { calendarQuarterOf } from "@/lib/quarters/calendar";
import {
  COMPANY_FEATURES,
  VALID_COMPANY_FEATURES,
} from "@/lib/companies/features";
import type { Company } from "@/lib/types";

// Creating a company, as data work, with every decision inside.
//
// Extracted from createCompanyAction so the provisioning CLI can build
// a new instance's first company through the same code rather than a
// second implementation that drifts. The action keeps what only it can
// do — authorization, redirects, cache revalidation — and calls this
// for the rest.
//
// THE BOUNDARY IS THE POINT. Callers supply true inputs only —
// things a human actually chose. That a Visionary and an Integrator
// exist, that a quarter covering today is open, what a valid feature
// name is: decided here, not expressible by a caller, and impossible
// to forget.
//
// Features are the one input that is genuinely a choice: the create
// form has a checkbox per feature and a system_admin picks them. So
// they are accepted, and the rule is still enforced here rather than
// by the caller — the set is validated against the catalogue, an empty
// or all-invalid set is refused rather than producing a featureless
// company, and omitting the field gets the defaults. A caller cannot
// half-configure a company because there is no way to express one.
//
// That matters more than it looks. A company missing its default
// quarter cannot accept a commitment; one missing its chart roots
// cannot open the org chart. Both are silent until someone tries.

// The features a company starts with. Marked on the catalogue entries
// rather than listed here, so adding a feature is one edit.
export function defaultFeatures(): string[] {
  return COMPANY_FEATURES.filter((f) => f.defaultOnCreate).map((f) => f.value);
}

export const DEFAULT_TIMEZONE = "America/Anchorage";

export type CreateCompanyInput = {
  name: string;
  // All optional, all genuinely someone's input.
  timezone?: string | null;
  industry?: string | null;
  // Omit to get defaultFeatures(). Supply only what a human chose;
  // invalid names are dropped and an empty result is refused.
  features?: readonly string[];
};

export type CreateCompanyResult =
  | { ok: true; company: Company; features: string[] }
  | { ok: false; message: string };

// Takes a SupabaseClient rather than a narrowed structural type. Both
// callers already have one — the action its request-scoped server
// client, the provisioning CLI a service-role client for the new
// instance — and the alternative was a hand-written shape full of
// casts that described the query builder worse than its own types do.
export async function createCompany(
  db: SupabaseClient,
  input: CreateCompanyInput
): Promise<CreateCompanyResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Give the company a name." };

  const timezone = (input.timezone ?? "").trim() || DEFAULT_TIMEZONE;
  const industryRaw = (input.industry ?? "").trim();
  const industry = industryRaw.length > 0 ? industryRaw : null;

  // Validated here, before anything is written, so a company row can
  // never exist alongside a feature set that was silently emptied.
  const features =
    input.features === undefined
      ? defaultFeatures()
      : [...new Set(input.features.map((f) => f.trim()))].filter((f) =>
          VALID_COMPANY_FEATURES.has(f)
        );
  if (features.length === 0) {
    return { ok: false, message: "Pick at least one feature." };
  }

  const { data, error } = await db
    .from("companies")
    .insert({ name, timezone, industry })
    .select("*")
    .single<Company>();

  if (error || !data) {
    return { ok: false, message: "Couldn't create that company." };
  }
  const company = data;

  // ---- Features -----------------------------------------------
  const { error: featuresError } = await db
    .from("company_features")
    .insert(features.map((feature) => ({ company_id: company.id, feature })));
  if (featuresError) {
    return {
      ok: false,
      message:
        "Company created, but its features didn't save. Open its settings and set them.",
    };
  }

  // ---- Chart roots --------------------------------------------
  // Visionary at the top, Integrator beneath it. Without these the
  // functional org chart has no root and cannot be opened at all.
  // maybeSingle on the Visionary, and a plain insert for the
  // Integrator: it needs the parent id, nothing needs the child's.
  const { data: visionary } = await db
    .from("functions")
    .insert({
      company_id: company.id,
      parent_function_id: null,
      title: "Visionary",
      description:
        "Owner/founder — sets direction, culture, and the long-term bet.",
      sort_order: 0,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (visionary?.id) {
    await db.from("functions").insert({
      company_id: company.id,
      parent_function_id: visionary.id,
      title: "Integrator",
      description:
        "COO — turns the vision into execution across the leadership team.",
      sort_order: 0,
    });
  }

  // ---- Opening quarter ----------------------------------------
  // Seeded so an admin can drop actions in immediately rather than
  // hitting an "open a quarter first" detour. Best-effort by design:
  // if it bounces, one can be opened by hand on /quarters.
  const quarter = calendarQuarterOf(new Date());
  await db
    .from("quarters")
    .insert({
      company_id: company.id,
      label: quarter.label,
      start_date: quarter.startDate,
      end_date: quarter.endDate,
      status: "open",
    });

  return { ok: true, company, features };
}
