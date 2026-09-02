import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Cheap duplicate-awareness check for extracted commitments and
// issues on the meeting summary page. Uses pg_trgm's similarity()
// function (enabled in migration 0143) to flag items that closely
// match already-open commitments or issues created in the last 14
// days. Never suppresses; only badges. Threshold is a named
// constant so it's tunable without a deploy hunt.

export const SIMILARITY_THRESHOLD = 0.4;
const LOOKBACK_DAYS = 14;

export type SimilarMatch = {
  kind: "commitment" | "issue";
  id: string;
  text: string;
  similarity: number;
};

// Look for a near-duplicate open commitment OR open issue in the
// company. Returns the best match above SIMILARITY_THRESHOLD, or
// null when nothing crosses the bar. Uses the admin client so it
// can be called from server components; RLS-scope safety comes
// from the explicit company_id filter.
export async function findSimilarOpenItem(
  companyId: string,
  text: string
): Promise<SimilarMatch | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const admin = createSupabaseAdminClient();
  const since = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const [commitmentRes, issueRes] = await Promise.all([
    admin.rpc("find_similar_open_commitment", {
      p_company_id: companyId,
      p_text: trimmed,
      p_threshold: SIMILARITY_THRESHOLD,
      p_since: since,
    }),
    admin.rpc("find_similar_open_issue", {
      p_company_id: companyId,
      p_text: trimmed,
      p_threshold: SIMILARITY_THRESHOLD,
      p_since: since,
    }),
  ]);

  // Surface RPC failures instead of swallowing them. Only .data was
  // read before, so a missing function, a revoked grant or a bad
  // argument all returned "no similar item found" — indistinguishable
  // from a genuine miss. That's how a duplicate-detection outage could
  // run indefinitely with no signal. Still non-fatal: the badge is an
  // enhancement, and a failed lookup must never block the page.
  if (commitmentRes.error) {
    console.warn("findSimilarOpenItem: commitment RPC failed", {
      companyId,
      code: commitmentRes.error.code,
      message: commitmentRes.error.message,
    });
  }
  if (issueRes.error) {
    console.warn("findSimilarOpenItem: issue RPC failed", {
      companyId,
      code: issueRes.error.code,
      message: issueRes.error.message,
    });
  }

  const c = firstRow<{ id: string; description: string; sim: number }>(
    commitmentRes.data
  );
  const i = firstRow<{ id: string; title: string; sim: number }>(issueRes.data);

  const candidates: SimilarMatch[] = [];
  if (c) {
    candidates.push({
      kind: "commitment",
      id: c.id,
      text: c.description,
      similarity: c.sim,
    });
  }
  if (i) {
    candidates.push({
      kind: "issue",
      id: i.id,
      text: i.title,
      similarity: i.sim,
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.similarity - a.similarity);
  return candidates[0]!;
}

function firstRow<T>(data: unknown): T | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0] as T;
}
