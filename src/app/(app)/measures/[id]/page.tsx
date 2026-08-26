import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { thisFriday, addDays, formatShortDate } from "@/lib/dates";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { PageShell } from "@/components/ui/PageShell";
import type {
  MetricValueType,
  SuccessMeasureEntry,
  TargetDirection,
} from "@/lib/types";
import { QuickLogForm } from "./QuickLogForm";
import listStyles from "../../admin/companies/admin.module.css";
import styles from "../measures.module.css";

// Single-metric quick-log — the mobile-friendly entry point that
// bypasses the /measures batch table when an owner just wants to
// punch in one number. Reachable from the batch table's metric-name
// link or from a reminder email deep-link. Authorization mirrors
// upsertMeasureEntryAction: admins or the function's Lead/Track.

type PageProps = { params: Promise<{ id: string }> };

type MeasureRow = {
  id: string;
  description: string;
  target: string | null;
  value_type: MetricValueType;
  target_direction: TargetDirection;
  outcome: {
    title: string;
    function: {
      id: string;
      title: string;
      company_id: string;
      lead_id: string | null;
      track_id: string | null;
    };
  };
};

export default async function QuickLogPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const supabase = await createSupabaseServerClient();
  const { data: measure } = await supabase
    .from("success_measures")
    .select(
      "id, description, target, value_type, target_direction, outcome:function_outcomes!inner(title, function:functions!inner(id, title, company_id, lead_id, track_id))"
    )
    .eq("id", id)
    .eq("archived", false)
    .maybeSingle<MeasureRow>();

  if (!measure) notFound();
  const fn = measure.outcome.function;

  // Cross-company safety: the URL id is authoritative for who can
  // write, but only measures in the currently-scoped company are
  // shown so a wrong-scope link surfaces a 404 rather than opening
  // an unrelated tenant's data.
  if (fn.company_id !== companyId) notFound();

  const canLog =
    isAdminForCompany(session.profile, fn.company_id) ||
    fn.lead_id === session.profile.id ||
    fn.track_id === session.profile.id;
  if (!canLog) {
    redirect("/measures");
  }

  const { data: companyRow } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", fn.company_id)
    .maybeSingle<{ timezone: string }>();
  const weekEnding = thisFriday(companyRow?.timezone ?? "America/Anchorage");
  const oldest = addDays(weekEnding, -35);

  const { data: entriesRaw } = await supabase
    .from("success_measure_entries")
    .select("*")
    .eq("measure_id", measure.id)
    .gte("week_ending", oldest)
    .lte("week_ending", weekEnding)
    .order("week_ending", { ascending: false });
  const entries = (entriesRaw ?? []) as SuccessMeasureEntry[];
  const currentEntry =
    entries.find((e) => e.week_ending === weekEnding) ?? null;
  const priorEntries = entries.filter((e) => e.week_ending !== weekEnding);

  return (
    <PageShell
      backHref="/measures"
      backLabel="Back to Key Success Measures"
      eyebrow={`${fn.title} · ${measure.outcome.title}`}
      title={measure.description}
      subtitle={`Log the week ending ${formatShortDate(weekEnding)}.`}
    >
      <section className={listStyles.card}>
        <div className={styles.quickLogCard}>
          <div className={styles.quickLogTargetRow}>
            <span className={styles.quickLogTargetLabel}>Target</span>
            <span className={styles.quickLogTargetValue}>
              {measure.target ? (
                <>
                  {measure.target_direction === "higher_is_better" ? "≥ " : "≤ "}
                  {measure.target}
                </>
              ) : (
                "—"
              )}
            </span>
          </div>

          <QuickLogForm
            measureId={measure.id}
            valueType={measure.value_type}
            weekEnding={weekEnding}
            initialEntry={currentEntry}
          />

          {priorEntries.length > 0 ? (
            <div>
              <p className={styles.quickLogTargetLabel} style={{ marginBottom: 8 }}>
                Recent history
              </p>
              <div className={styles.quickLogHistory}>
                {priorEntries.slice(0, 6).map((e) => (
                  <div key={e.week_ending} className={styles.quickLogHistoryRow}>
                    <span className={styles.quickLogHistoryWeek}>
                      Week of {formatShortDate(e.week_ending)}
                    </span>
                    <span className={styles.quickLogHistoryValue}>
                      {formatEntry(measure.value_type, e)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className={listStyles.card}>
        <p className={listStyles.subtitleInline}>
          Rather log a whole week of metrics in one place?{" "}
          <Link href="/measures" className={styles.metricTitleLink}>
            Open the batch scoreboard →
          </Link>
        </p>
      </section>
    </PageShell>
  );
}

function formatEntry(
  valueType: MetricValueType,
  entry: SuccessMeasureEntry
): string {
  if (valueType === "text") return entry.value_text ?? "—";
  if (entry.value_number == null || !Number.isFinite(entry.value_number)) {
    return "—";
  }
  if (valueType === "percent") return `${entry.value_number}%`;
  return String(entry.value_number);
}
