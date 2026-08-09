import * as Sentry from "@sentry/nextjs";

// Thin wrapper around Sentry.captureException for server-side
// infrastructure failures (Supabase queries, external API calls,
// email dispatch). Use it in the "!ok" branch of a server action
// only when the failure is caused by a downstream system — not for
// user-input validation errors (those are expected and shouldn't
// page us).
//
//   const { error } = await admin.from("...").insert(...);
//   if (error) {
//     reportError("guides.assign.upsert", error, { guideId, companyId });
//     return { ok: false, message: error.message };
//   }
//
// The `scope` string becomes a Sentry tag so alert rules and
// dashboards can group by action + failure point.

export function reportError(
  scope: string,
  error: unknown,
  context?: Record<string, unknown>
): void {
  Sentry.withScope((s) => {
    s.setTag("scope", scope);
    if (context) s.setContext("action", context);
    if (error instanceof Error) {
      s.captureException(error);
    } else if (typeof error === "object" && error !== null) {
      s.captureException(new Error(JSON.stringify(error)));
    } else {
      s.captureException(new Error(String(error)));
    }
  });
}
