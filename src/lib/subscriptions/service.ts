import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

// Subscription-gate helpers. NavBand + module pages call these to
// decide what's visible for a given company. Feature strings are
// intentionally open — the DB has no CHECK constraint — so a new
// module can ship without a migration to add its name here.

export type ModuleFeature = "execution" | "strengths";

export async function getCompanyFeatures(
  companyId: string
): Promise<ModuleFeature[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("company_features")
    .select("feature")
    .eq("company_id", companyId);
  return ((data ?? []) as Array<{ feature: string }>).map(
    (row) => row.feature as ModuleFeature
  );
}

export async function companyHasFeature(
  companyId: string,
  feature: ModuleFeature
): Promise<boolean> {
  const features = await getCompanyFeatures(companyId);
  return features.includes(feature);
}
