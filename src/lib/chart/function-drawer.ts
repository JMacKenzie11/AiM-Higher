"use server";

import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getChartFunctionDetail } from "@/lib/chart/service";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { getCachedRoleDescription } from "@/lib/role-descriptions/cache";
import { computeReadiness } from "@/lib/role-descriptions/readiness";
import type { ReadinessGate } from "@/lib/role-descriptions/readiness";
import type {
  FunctionCompetency,
  FunctionDecisionRight,
  FunctionNode,
  FunctionRole,
  Profile,
} from "@/lib/types";

// What the chart's function drawer needs, in one round trip.
//
// The detail PAGE is a server component and assembles this by
// awaiting four helpers in its own body. The drawer opens inside an
// already-rendered client tree, so it has to ask for the same
// material over the wire the moment it opens — hence one action
// rather than four, and hence a payload trimmed to what the drawer
// actually renders.
//
// Deliberately NOT returning `outcomes`: the drawer doesn't draw
// critical success factors (those live on /measures), but readiness
// counts them, so the gates are computed here on the server where
// the outcomes already are and only the verdict travels.

export type FunctionDrawerDetail = {
  fn: Pick<FunctionNode, "id" | "title" | "company_id">;
  parent: Pick<FunctionNode, "id" | "title"> | null;
  children: Array<Pick<FunctionNode, "id" | "title">>;
  seatHolder: Pick<Profile, "id" | "full_name"> | null;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  roles: FunctionRole[];
  decisionRights: FunctionDecisionRight[];
  competencies: FunctionCompetency[];
  canEdit: boolean;
  rdEnabled: boolean;
  readiness: {
    gates: ReadinessGate[];
    readyCount: number;
    total: number;
    hasBeenCreated: boolean;
  } | null;
};

export type FunctionDrawerResult =
  | { ok: true; detail: FunctionDrawerDetail }
  | { ok: false; message: string };

export async function loadFunctionDrawerAction(
  functionId: string
): Promise<FunctionDrawerResult> {
  const session = await requireProfile();

  const detail = await getChartFunctionDetail(functionId);
  // RLS already scopes the read to the caller's company, so a null
  // here is "gone or not yours" and both answers are the same one.
  if (!detail) {
    return { ok: false, message: "That function is no longer there." };
  }

  const canEdit = isAdminForCompany(session.profile, detail.fn.company_id);
  const rdEnabled = await companyHasFeature(
    detail.fn.company_id,
    "role_descriptions"
  );

  let readiness: FunctionDrawerDetail["readiness"] = null;
  if (rdEnabled) {
    const { gates, readyCount, total } = computeReadiness(detail);
    const cached = await getCachedRoleDescription(detail.fn.id);
    readiness = { gates, readyCount, total, hasBeenCreated: cached !== null };
  }

  return {
    ok: true,
    detail: {
      fn: {
        id: detail.fn.id,
        title: detail.fn.title,
        company_id: detail.fn.company_id,
      },
      parent: detail.parent,
      children: detail.children.map((c) => ({ id: c.id, title: c.title })),
      seatHolder: detail.seatHolder,
      roster: detail.roster,
      roles: detail.roles,
      decisionRights: detail.decisionRights,
      competencies: detail.competencies,
      canEdit,
      rdEnabled,
      readiness,
    },
  };
}
