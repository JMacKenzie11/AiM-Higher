import type { getChartFunctionDetail } from "@/lib/chart/service";
import { computeReadiness } from "@/lib/role-descriptions/readiness";
import { getCachedRoleDescription } from "@/lib/role-descriptions/cache";
import { ReadinessChecklist } from "./ReadinessChecklist";

// Function-level readiness for the AiMS Role Description. Pure
// checklist + link; the actual editing happens inline on the
// section cards above (each has its own "Suggest options" popover
// when the RD feature is on). Reads gates from the shared helper
// so this card and the /role-description view route share one
// source of truth.
//
// The markup moved to ReadinessChecklist when the chart drawer
// started drawing the same card from data it fetched itself. What
// is left here is the server work: compute the gates, ask whether a
// document exists yet.
//
// Anchors match aria-labelledby ids on the page sections so a
// pending row can jump straight to where the fix lives.

type Detail = NonNullable<Awaited<ReturnType<typeof getChartFunctionDetail>>>;

export async function RoleDescriptionReadiness({
  detail,
  canEdit,
}: {
  detail: Detail;
  canEdit: boolean;
}) {
  const { gates, readyCount, total } = computeReadiness(detail);
  const viewHref = `/chart/function/${detail.fn.id}/role-description`;
  // "Created" here means a cached RD document exists for this
  // function. Once created, the button reads "View role
  // description →"; before that it reads "Create role
  // description →" for admins (who can trigger the initial
  // generation by visiting the view page). Team members without
  // a cached doc see no button.
  const cached = await getCachedRoleDescription(detail.fn.id);

  return (
    <ReadinessChecklist
      gates={gates}
      readyCount={readyCount}
      total={total}
      viewHref={viewHref}
      hasBeenCreated={cached !== null}
      canEdit={canEdit}
    />
  );
}
