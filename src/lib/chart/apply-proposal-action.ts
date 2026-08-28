"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  parseChartProposal,
  type ChartProposal,
} from "@/lib/practices/parse-chart-proposal";

// Server action for the ChartProposalCard's "Apply to Chart" button.
//
// Additive-only semantics (per the UX decision):
//   * Top-level functions whose title matches an existing function
//     case-insensitively are SKIPPED (not modified). Their proposal
//     responsibilities do NOT overwrite existing ones.
//   * Missing responsibilities on an existing function are MERGED
//     in (add-only, case-insensitive on body text). Never modifies
//     or deletes existing responsibilities.
//   * Sub-functions follow the same skip rule; parent is resolved
//     to whichever function (already-existing or just-created) has
//     the matching name.
//   * Top seats are SKIPPED entirely when the chart already has
//     >= 2 top-level functions (universal case, since every company
//     is seeded with Visionary + Integrator). Their names surface
//     in the summary so the leader knows the coached names weren't
//     lost silently.
//
// Chart-edit rights: company_admin or system_admin on this company,
// or an aims_guide with an assignment. Enforced via isAdminForCompany.
// Writes go through the admin Supabase client because guides don't
// hold RLS insert rights on function_roles.

export type ApplyResult =
  | {
      ok: true;
      summary: ApplySummary;
    }
  | { ok: false; message: string };

export type ApplySummary = {
  createdFunctions: string[]; // titles
  addedResponsibilitiesByFunction: Array<{ function: string; count: number }>;
  createdSubFunctions: string[]; // titles
  keptTopSeats: string[]; // titles the leader already had at the top (kept as-is)
  renamedTopSeats: Array<{ from: string; to: string }>; // Visionary/Integrator → chosen names
  proposedTopSeats: string[]; // titles the proposal called them
  totalCreatedFunctions: number;
  totalAddedResponsibilities: number;
};

type ExistingFunction = {
  id: string;
  title: string;
  parent_function_id: string | null;
};

type ExistingRole = {
  id: string;
  function_id: string;
  title: string;
  body: string | null;
};

export async function applyChartProposalAction(
  proposalJson: string,
  conversationId: string
): Promise<ApplyResult> {
  // Re-validate on the server. Client already parsed; we trust
  // nothing that came off the wire.
  const proposal = parseChartProposal(proposalJson);
  if (!proposal) {
    return {
      ok: false,
      message: "That proposal isn't in the right shape.",
    };
  }
  if (!conversationId) {
    return { ok: false, message: "Missing conversation reference." };
  }

  const session = await requireProfile();
  const admin = createSupabaseAdminClient();

  // The chart target is the company the CONVERSATION belongs to,
  // not the caller's current scope cookie. A sysadmin can scope
  // between companies while the practice conversation stays put;
  // applying to the current scope silently lands the coached
  // chart on the wrong tenant (the exact bug the leader saw:
  // proposal applied to "a completely separate company").
  const { data: convo } = await admin
    .from("coaching_conversations")
    .select("id, company_id, created_by")
    .eq("id", conversationId)
    .maybeSingle<{ id: string; company_id: string; created_by: string }>();
  if (!convo) {
    return { ok: false, message: "Couldn't find that conversation." };
  }
  if (convo.created_by !== session.profile.id) {
    return { ok: false, message: "Not yours to apply." };
  }
  const companyId = convo.company_id;
  if (!isAdminForCompany(session.profile, companyId)) {
    return { ok: false, message: "You can't edit this company's chart." };
  }

  // Load the current top-level functions + all their roles so we
  // can name-check without a round-trip per proposal item.
  const { data: existing, error: loadErr } = await admin
    .from("functions")
    .select("id, title, parent_function_id")
    .eq("company_id", companyId)
    .eq("archived", false);
  if (loadErr) {
    return { ok: false, message: "Couldn't read the current chart." };
  }
  const allFns: ExistingFunction[] = (existing ?? []) as ExistingFunction[];
  const topLevelFns = allFns.filter((f) => f.parent_function_id === null);
  const byLowerName = new Map<string, ExistingFunction>();
  for (const f of allFns) byLowerName.set(f.title.trim().toLowerCase(), f);

  // Preload existing roles for functions we'll potentially merge into.
  const existingIds = allFns.map((f) => f.id);
  const rolesByFunction = new Map<string, ExistingRole[]>();
  if (existingIds.length > 0) {
    const { data: roles } = await admin
      .from("function_roles")
      .select("id, function_id, title, body")
      .in("function_id", existingIds);
    for (const r of (roles ?? []) as ExistingRole[]) {
      const arr = rolesByFunction.get(r.function_id) ?? [];
      arr.push(r);
      rolesByFunction.set(r.function_id, arr);
    }
  }

  const summary: ApplySummary = {
    createdFunctions: [],
    addedResponsibilitiesByFunction: [],
    createdSubFunctions: [],
    keptTopSeats: [],
    renamedTopSeats: [],
    proposedTopSeats: [],
    totalCreatedFunctions: 0,
    totalAddedResponsibilities: 0,
  };

  // ---- Top seats. Three cases:
  //
  //   (a) Chart has the seeded Visionary + Integrator-under-Visionary
  //       shape → RENAME them to the leader's chosen names from
  //       Step 4 of the practice. The whole point of Step 4 is that
  //       the leader names the two seeded seats; skipping the proposal
  //       drops that choice on the floor. Only renames when the
  //       current title matches "Visionary" / "Integrator" (case-
  //       insensitive) so a leader who's already customized the
  //       seats keeps their customization.
  //
  //   (b) Chart has some other top structure (leader-customized,
  //       missing the seed, etc.) → skip proposal.top_seats and
  //       report kept titles. Never create duplicates alongside.
  //
  //   (c) Chart is empty at the top → create the proposal's top
  //       seats as top-level functions.
  if (proposal.top_seats.length >= 1) {
    summary.proposedTopSeats = proposal.top_seats.map((s) => s.name);

    const seededVisionary = topLevelFns.find(
      (f) => f.title.trim().toLowerCase() === "visionary"
    );
    const seededIntegrator = seededVisionary
      ? allFns.find(
          (f) =>
            f.parent_function_id === seededVisionary.id &&
            f.title.trim().toLowerCase() === "integrator"
        )
      : undefined;

    if (
      seededVisionary &&
      seededIntegrator &&
      proposal.top_seats.length >= 2
    ) {
      // Case (a) — rename the seeded seats.
      const [ceoName, cooName] = [
        proposal.top_seats[0]!.name,
        proposal.top_seats[1]!.name,
      ];
      if (ceoName.toLowerCase() !== "visionary") {
        await renameFunction(admin, seededVisionary.id, ceoName);
        summary.renamedTopSeats.push({
          from: seededVisionary.title,
          to: ceoName,
        });
        seededVisionary.title = ceoName;
        byLowerName.delete("visionary");
        byLowerName.set(ceoName.trim().toLowerCase(), seededVisionary);
      }
      if (cooName.toLowerCase() !== "integrator") {
        await renameFunction(admin, seededIntegrator.id, cooName);
        summary.renamedTopSeats.push({
          from: seededIntegrator.title,
          to: cooName,
        });
        seededIntegrator.title = cooName;
        byLowerName.delete("integrator");
        byLowerName.set(cooName.trim().toLowerCase(), seededIntegrator);
      }
    } else if (topLevelFns.length >= 1) {
      // Case (b) — customized top structure. Respect and report.
      const topAndImmediateChildren = new Set<string>();
      for (const fn of topLevelFns) topAndImmediateChildren.add(fn.title);
      for (const fn of allFns) {
        if (
          fn.parent_function_id &&
          topLevelFns.some((t) => t.id === fn.parent_function_id)
        ) {
          topAndImmediateChildren.add(fn.title);
        }
      }
      summary.keptTopSeats = Array.from(topAndImmediateChildren);
    } else {
      // Case (c) — empty chart. Create the proposal's seats.
      for (const seat of proposal.top_seats) {
        const collision = byLowerName.get(seat.name.trim().toLowerCase());
        if (collision) continue;
        const inserted = await insertFunction(admin, {
          company_id: companyId,
          parent_function_id: null,
          title: seat.name,
          description: seat.note || null,
        });
        if (inserted) {
          summary.createdFunctions.push(inserted.title);
          summary.totalCreatedFunctions += 1;
          byLowerName.set(inserted.title.trim().toLowerCase(), inserted);
        }
      }
    }
  }

  // ---- Top-level functions from the proposal.functions list.
  // Skip if a top-level function with the same name exists. If a
  // function with the same name exists at ANY level (sub too), we
  // still skip to avoid weird chart shapes.
  for (const fn of proposal.functions) {
    const existingMatch = byLowerName.get(fn.name.trim().toLowerCase());
    if (existingMatch) {
      const added = await mergeResponsibilities(
        admin,
        existingMatch,
        fn.responsibilities,
        rolesByFunction.get(existingMatch.id) ?? []
      );
      if (added > 0) {
        summary.addedResponsibilitiesByFunction.push({
          function: existingMatch.title,
          count: added,
        });
        summary.totalAddedResponsibilities += added;
      }
    } else {
      const inserted = await insertFunction(admin, {
        company_id: companyId,
        parent_function_id: null,
        title: fn.name,
        description: null,
      });
      if (inserted) {
        summary.createdFunctions.push(inserted.title);
        summary.totalCreatedFunctions += 1;
        byLowerName.set(inserted.title.trim().toLowerCase(), inserted);
        const added = await addResponsibilities(
          admin,
          inserted.id,
          fn.responsibilities
        );
        if (added > 0) {
          summary.addedResponsibilitiesByFunction.push({
            function: inserted.title,
            count: added,
          });
          summary.totalAddedResponsibilities += added;
        }
      }
    }

    if (!fn.sub_functions) continue;

    // Resolve parent: prefer the function we just created / matched.
    const parent = byLowerName.get(fn.name.trim().toLowerCase());
    if (!parent) continue;

    for (const sub of fn.sub_functions) {
      const subExisting = byLowerName.get(sub.name.trim().toLowerCase());
      if (subExisting) {
        const added = await mergeResponsibilities(
          admin,
          subExisting,
          sub.responsibilities,
          rolesByFunction.get(subExisting.id) ?? []
        );
        if (added > 0) {
          summary.addedResponsibilitiesByFunction.push({
            function: subExisting.title,
            count: added,
          });
          summary.totalAddedResponsibilities += added;
        }
      } else {
        const inserted = await insertFunction(admin, {
          company_id: companyId,
          parent_function_id: parent.id,
          title: sub.name,
          description: null,
        });
        if (inserted) {
          summary.createdSubFunctions.push(inserted.title);
          byLowerName.set(inserted.title.trim().toLowerCase(), inserted);
          const added = await addResponsibilities(
            admin,
            inserted.id,
            sub.responsibilities
          );
          if (added > 0) {
            summary.addedResponsibilitiesByFunction.push({
              function: inserted.title,
              count: added,
            });
            summary.totalAddedResponsibilities += added;
          }
        }
      }
    }
  }

  revalidatePath("/chart");
  return { ok: true, summary };
}

async function renameFunction(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  id: string,
  title: string
): Promise<void> {
  const { error } = await admin
    .from("functions")
    .update({ title })
    .eq("id", id);
  if (error) {
    console.error("apply-chart renameFunction failed", error);
  }
}

async function insertFunction(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  patch: {
    company_id: string;
    parent_function_id: string | null;
    title: string;
    description: string | null;
  }
): Promise<ExistingFunction | null> {
  const { data, error } = await admin
    .from("functions")
    .insert(patch)
    .select("id, title, parent_function_id")
    .single<ExistingFunction>();
  if (error) {
    console.error("apply-chart insertFunction failed", error);
    return null;
  }
  return data;
}

// Add responsibilities to a NEW function (no need to check for
// duplicates — the function is fresh, only the trigger-created
// default row exists).
async function addResponsibilities(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  functionId: string,
  responsibilities: readonly string[]
): Promise<number> {
  if (responsibilities.length === 0) return 0;
  const rows = responsibilities.map((title, i) => ({
    function_id: functionId,
    title,
    body: null,
    sort_order: i + 1, // 0 is the trigger-created "Lead, Track, Decide"
    is_default: false,
  }));
  const { error, count } = await admin
    .from("function_roles")
    .insert(rows, { count: "exact" });
  if (error) {
    console.error("apply-chart addResponsibilities failed", error);
    return 0;
  }
  return count ?? rows.length;
}

// Add only responsibilities that don't already exist on an EXISTING
// function. Case-insensitive on title. Never deletes or modifies.
async function mergeResponsibilities(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  fn: ExistingFunction,
  proposed: readonly string[],
  existingRoles: readonly ExistingRole[]
): Promise<number> {
  const have = new Set(
    existingRoles.map((r) => r.title.trim().toLowerCase())
  );
  const missing = proposed.filter(
    (p) => !have.has(p.trim().toLowerCase())
  );
  if (missing.length === 0) return 0;
  const startOrder = existingRoles.length; // append after current tail
  const rows = missing.map((title, i) => ({
    function_id: fn.id,
    title,
    body: null,
    sort_order: startOrder + i,
    is_default: false,
  }));
  const { error, count } = await admin
    .from("function_roles")
    .insert(rows, { count: "exact" });
  if (error) {
    console.error("apply-chart mergeResponsibilities failed", error);
    return 0;
  }
  return count ?? rows.length;
}
