// The link that opens one commitment's drawer (2026-11-17): what the
// weekly meeting email puts on every commitment.
//
//   /commitments?open=<commitment id>&company=<company id>
//   /issues?open=<commitment id>&company=<company id>
//
// /issues for a commitment on an issue, because /commitments leaves
// those out (they live with their issue). `company` matters only to a
// Coach or admin who may be looking at another company when they click
// (OtherCompanyNotice); everyone else's company is their own.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = Record<string, string | string[] | undefined>;

function uuidParam(v: string | string[] | undefined): string | null {
  return typeof v === "string" && UUID.test(v) ? v : null;
}

export function openIdFrom(sp: SearchParams): string | null {
  return uuidParam(sp.open);
}

export function linkCompanyFrom(sp: SearchParams): string | null {
  return uuidParam(sp.company);
}

export function commitmentLinkPath(c: {
  id: string;
  company_id: string;
  issue_id: string | null;
}): string {
  const page = c.issue_id ? "/issues" : "/commitments";
  const qs = new URLSearchParams({ open: c.id, company: c.company_id });
  return `${page}?${qs.toString()}`;
}
