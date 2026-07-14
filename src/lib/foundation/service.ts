import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  CompanyFoundation,
  FoundationItem,
  MarketingSnippet,
  MarketingStrategy,
  MessagingPillar,
} from "@/lib/types";

// Full read model for /foundation. Every tab pulls from one shared
// query so the page renders in a single round-trip.

export type FoundationData = {
  foundation: CompanyFoundation | null;
  coreValues: FoundationItem[];
  visionMilestones: FoundationItem[];
  differentiators: FoundationItem[];
  marketing: MarketingStrategy | null;
  pillars: MessagingPillar[];
  snippets: {
    short_hook: MarketingSnippet[];
    long_hook: MarketingSnippet[];
    website_copy: MarketingSnippet[];
    avoid: MarketingSnippet[];
    icp_best_fit: MarketingSnippet[];
    icp_psychographic: MarketingSnippet[];
    elevated_phrase: MarketingSnippet[];
  };
};

export async function getFoundation(
  companyId: string
): Promise<FoundationData> {
  const supabase = await createSupabaseServerClient();

  const [
    { data: foundationRow },
    { data: itemRows },
    { data: marketingRow },
    { data: pillarRows },
    { data: snippetRows },
  ] = await Promise.all([
    supabase
      .from("company_foundation")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle<CompanyFoundation>(),
    supabase
      .from("foundation_items")
      .select("*")
      .eq("company_id", companyId)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("marketing_strategy")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle<MarketingStrategy>(),
    supabase
      .from("messaging_pillars")
      .select("*")
      .eq("company_id", companyId)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("marketing_snippets")
      .select("*")
      .eq("company_id", companyId)
      .order("sort_order")
      .order("created_at"),
  ]);

  const items = (itemRows ?? []) as FoundationItem[];
  const snippets = (snippetRows ?? []) as MarketingSnippet[];

  return {
    foundation: foundationRow ?? null,
    coreValues: items.filter((i) => i.kind === "core_value"),
    visionMilestones: items.filter((i) => i.kind === "vision_milestone"),
    differentiators: items.filter((i) => i.kind === "differentiator"),
    marketing: marketingRow ?? null,
    pillars: (pillarRows ?? []) as MessagingPillar[],
    snippets: {
      short_hook: snippets.filter((s) => s.kind === "short_hook"),
      long_hook: snippets.filter((s) => s.kind === "long_hook"),
      website_copy: snippets.filter((s) => s.kind === "website_copy"),
      avoid: snippets.filter((s) => s.kind === "avoid"),
      icp_best_fit: snippets.filter((s) => s.kind === "icp_best_fit"),
      icp_psychographic: snippets.filter((s) => s.kind === "icp_psychographic"),
      elevated_phrase: snippets.filter((s) => s.kind === "elevated_phrase"),
    },
  };
}
