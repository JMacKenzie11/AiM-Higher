"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getCachedRoleDescription,
  isCacheStale,
  saveRoleDescription,
} from "./cache";
import { generateRoleDescription } from "./generate";
import { publishVersion, deletePublishedVersion } from "./versions";
import type { getChartFunctionDetail } from "@/lib/chart/service";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Publish the current Role Description as an immutable version
// snapshot. Uses the cached document if fresh; regenerates + saves
// otherwise (so the snapshot reflects current chart state). Any
// user overrides live at publish time are captured alongside the
// raw document so the snapshot renders exactly what the publisher
// saw.

export async function publishRoleDescriptionAction(input: {
  functionId: string;
  notes: string | null;
}): Promise<
  { ok: true; versionNumber: number } | { ok: false; message: string }
> {
  const session = await requireProfile();

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: fn } = await supabase
    .from("functions")
    .select("company_id")
    .eq("id", input.functionId)
    .maybeSingle<{ company_id: string }>();
  if (!fn) return { ok: false, message: "Function not found." };

  if (!isAdminForCompany(session.profile, fn.company_id)) {
    return {
      ok: false,
      message: "You don't have permission to publish this role description.",
    };
  }

  // We need the full detail to resolve staleness. Load lazily here
  // so the shape stays consistent with what the view page uses.
  const detail = await loadDetail(input.functionId);
  if (!detail) return { ok: false, message: "Function not found." };

  const cached = await getCachedRoleDescription(input.functionId);
  let rawDoc = null;
  let overrides = null;
  if (cached && !isCacheStale(cached, detail)) {
    rawDoc = cached.document;
    overrides = cached.overrides;
  } else {
    rawDoc = await generateRoleDescription(detail);
    if (rawDoc) {
      await saveRoleDescription({
        functionId: input.functionId,
        generatedBy: session.profile.id,
        document: rawDoc,
      });
      overrides = cached?.overrides ?? null;
    } else if (cached) {
      rawDoc = cached.document;
      overrides = cached.overrides;
    }
  }

  if (!rawDoc) {
    return {
      ok: false,
      message:
        "Couldn't assemble the role description right now — try Regenerate first.",
    };
  }

  const result = await publishVersion({
    functionId: input.functionId,
    publishedBy: session.profile.id,
    document: rawDoc,
    overrides,
    notes: input.notes,
  });
  if (!result.ok) return result;

  revalidatePath(`/chart/function/${input.functionId}/role-description`);
  return { ok: true, versionNumber: result.versionNumber };
}

export async function deleteRoleDescriptionVersionAction(input: {
  functionId: string;
  versionNumber: number;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await requireProfile();

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: fn } = await supabase
    .from("functions")
    .select("company_id")
    .eq("id", input.functionId)
    .maybeSingle<{ company_id: string }>();
  if (!fn) return { ok: false, message: "Function not found." };

  if (!isAdminForCompany(session.profile, fn.company_id)) {
    return {
      ok: false,
      message: "You don't have permission to delete this version.",
    };
  }

  const result = await deletePublishedVersion(
    input.functionId,
    input.versionNumber
  );
  if (!result.ok) return result;

  revalidatePath(`/chart/function/${input.functionId}/role-description`);
  return { ok: true };
}

async function loadDetail(
  functionId: string
): Promise<Awaited<ReturnType<typeof getChartFunctionDetail>> | null> {
  // Inline import to avoid a cycle if this module ever grows an
  // export that chart/service depends on transitively.
  const { getChartFunctionDetail } = await import("@/lib/chart/service");
  return getChartFunctionDetail(functionId);
}
