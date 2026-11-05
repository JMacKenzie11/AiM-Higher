// What the measures grid's boxes hold when the server's values change
// under them (Jason, 2026-11-05).
//
// The grid keeps a local copy of every editable box so typing is
// instant. That copy used to be taken once, on first render, and never
// again: Pull now wrote the entry and refreshed the page's data, and
// the box went on showing what it held before until a full reload.
//
// The rule: a box the person has not touched follows the server; a
// box they have changed and not yet saved keeps what they typed. "Not
// touched" means it still holds what the server last said, which is
// the same comparison the save uses to decide what changed, so the two
// cannot disagree. A box the server has newly started showing (a month
// opened, a week added) takes the server's value.
export function mergeServerValues(
  local: Record<string, string>,
  previousServer: Record<string, string>,
  nextServer: Record<string, string>
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, serverValue] of Object.entries(nextServer)) {
    const mine = local[key];
    const untouched = mine === undefined || mine === (previousServer[key] ?? "");
    merged[key] = untouched ? serverValue : mine;
  }
  return merged;
}
