import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// A COMPANY'S NAME AND TIMEZONE, READ ONCE PER REQUEST.
//
// The (app) layout needs both on every page. Most pages then asked for
// the timezone again to work out "today" or "this Friday", and a
// cross-company caller's scope check asked a third time whether the
// company still exists (lib/admin/scope.ts). Three reads of one row,
// each a round trip the page waited on.
//
// Wrapped in React's cache(), as getCurrentSession is, so every caller
// in one request shares one read. Per request, never across requests
// or users. It reads through the caller's own client, so row security
// decides what comes back: null means the company is not visible to
// this caller, which includes a soft-deleted one
// (companies_hide_deleted).
export type CompanyBasics = { id: string; name: string; timezone: string | null };

export const getCompanyBasics = cache(async function getCompanyBasics(
  companyId: string
): Promise<CompanyBasics | null> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data } = await supabase
    .from("companies")
    .select("id, name, timezone")
    .eq("id", companyId)
    .maybeSingle<CompanyBasics>();
  return data ?? null;
});
