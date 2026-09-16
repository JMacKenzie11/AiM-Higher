// Which sidebar groups start collapsed, and how that survives a page
// load.
//
// THE MECHANISM ALREADY EXISTED and is better than a session: the
// collapsed set is a cookie, read by the server layout and handed to
// Sidebar as initialCollapsedGroups, so the first paint already
// matches the preference instead of flashing open and snapping shut.
// It lasts a year rather than a session, which is what somebody who
// closed a group actually meant.
//
// WHAT HAD TO CHANGE is subtler than the default itself. The old
// encoding cleared the cookie whenever nothing was collapsed, so
// "no cookie" meant "everything expanded". The moment some groups
// default to COLLAPSED, that encoding cannot tell two different
// people apart:
//
//   a new user, who should get the defaults
//   somebody who deliberately opened every group, who should not
//
// Under the old rule the second person opens Guide HQ, the set
// empties, the cookie clears, and the next page load closes it again
// — the exact "continually have to reopen it" this was meant to fix.
//
// So an empty set now writes a sentinel instead of clearing. Absent
// cookie means "never expressed a preference"; present-but-empty
// means "expanded everything, on purpose".

export const NAV_GROUPS_COOKIE = "nav-groups-collapsed";

// Collapsed for a new user. Both are single-link bands that sit above
// the working nav: Guide HQ and Portfolio are where you arrive, not
// where you spend the day, and open they push everything else down.
export const DEFAULT_COLLAPSED_GROUPS: readonly string[] = [
  "Guide HQ",
  "Portfolio",
];

// Written when the user has collapsed nothing. Any value that cannot
// be a group label does; "-" is short and survives a cookie round
// trip without encoding.
export const NO_GROUPS_COLLAPSED = "-";

// Cookie value -> the groups to start collapsed.
//
// `undefined` is a caller who has never toggled anything. An empty or
// whitespace-only string is treated the same way, because that is
// what a stale cookie from the previous encoding looks like and the
// defaults are the better answer for it.
export function parseCollapsedGroups(
  cookieValue: string | undefined
): string[] {
  if (cookieValue === undefined) return [...DEFAULT_COLLAPSED_GROUPS];
  const raw = cookieValue.trim();
  if (raw.length === 0) return [...DEFAULT_COLLAPSED_GROUPS];
  if (raw === NO_GROUPS_COLLAPSED) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// The collapsed set -> the cookie value. Never an empty string: see
// the sentinel above.
export function serializeCollapsedGroups(
  groups: Iterable<string>
): string {
  const list = Array.from(groups).filter(Boolean);
  return list.length === 0 ? NO_GROUPS_COLLAPSED : list.join(",");
}
