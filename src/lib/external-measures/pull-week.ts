import type { ExternalMapping } from "./mapping";

// Which week Pull now targets when nobody has chosen one. Always one
// of the platform's own week-endings (`weeks`, oldest first); the
// drawer's select offers those and nothing else, and the action
// re-checks the choice against the same list.
//
// THE DEFAULT FOLLOWS THE MAPPING, and there are three cases rather
// than two:
//
//   week_keyed            this week. The sheet has a row per week
//                         and this week's is the one being filled.
//   snapshot, no freshness  this week. The mapping means "whatever
//                         is in that cell right now", so now is the
//                         week it belongs to.
//   snapshot + freshness  the last COMPLETED week. A dashboard that
//                         carries an as-of date is reporting a
//                         closed period, so the current week is the
//                         one week its number is certainly not
//                         about, and defaulting there would hand a
//                         new user a decline on their first press.
//
// A HubSpot weekly total is recorded once its week closes, so its
// default is the last completed week too.
//
// ONE HOME, two callers: the drawer's Pull now (with its week picker)
// and the grid row's menu, which has no picker and so pulls exactly
// the week the drawer would have offered first.
export function defaultPullWeek(
  mapping: ExternalMapping | null,
  weeks: readonly string[]
): string {
  const reportsAClosedPeriod =
    (mapping?.connector === "google_sheet" &&
      mapping.kind === "snapshot" &&
      !!mapping.recipe.freshness) ||
    (mapping?.connector === "hubspot" && mapping.kind === "weekly");
  return reportsAClosedPeriod && weeks.length > 1
    ? weeks[weeks.length - 2]
    : (weeks[weeks.length - 1] ?? "");
}
