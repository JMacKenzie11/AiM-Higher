import "server-only";

import crypto from "node:crypto";
import type { TranscriptAlias } from "@/lib/types";

// SHA-256 of the extracted text. Used for the per-company duplicate
// index — reprocessing the same file (rename, re-share) doesn't
// create a second meeting row for the same company.
export function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export type RouteDecision =
  | { kind: "routed"; companyId: string; alias: string }
  | { kind: "unrouted"; reason: "no_match" | "multiple_matches" };

// Lowercase-substring match every alias against the file name.
// EXACTLY ONE company's aliases match → routed. Zero matches or
// matches spanning more than one company → unrouted. The rule is
// deliberately strict: guessing here would silently deliver
// commitments to the wrong company.
//
// Aliases are pre-scoped by the caller to same-provider or shared
// visibility; this function only owns the decision.
export function routeByFilename(
  fileName: string,
  aliases: Pick<TranscriptAlias, "company_id" | "alias">[]
): RouteDecision {
  const lower = fileName.toLowerCase();

  const matchedCompanies = new Map<string, string>(); // company_id → alias that hit
  for (const a of aliases) {
    const needle = a.alias.trim().toLowerCase();
    if (!needle) continue;
    if (lower.includes(needle)) {
      // Keep the first alias that matched per company (longest-match
      // isn't meaningful because we still only route on one company).
      if (!matchedCompanies.has(a.company_id)) {
        matchedCompanies.set(a.company_id, a.alias);
      }
    }
  }

  if (matchedCompanies.size === 0) {
    return { kind: "unrouted", reason: "no_match" };
  }
  if (matchedCompanies.size > 1) {
    return { kind: "unrouted", reason: "multiple_matches" };
  }
  const [companyId, alias] = matchedCompanies.entries().next().value as [
    string,
    string,
  ];
  return { kind: "routed", companyId, alias };
}
