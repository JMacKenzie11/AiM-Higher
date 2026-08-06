import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMeasuresOwnedBy } from "@/lib/measures/service";
import { formatShortDate } from "@/lib/dates";
import { MeasuresBatchForm } from "./MeasuresBatchForm";
import styles from "../admin/companies/admin.module.css";
import boardLinkStyles from "./measures.module.css";

// Weekly Success Measures logging — batch entry for every measure the
// caller owns (via function.leader_id), or every measure in the
// company for admins covering for others. One row per measure with a
// current-week input and a mini trend of the last few weeks. Save-all
// writes them in a single upsert. Owners come here on Fridays, or
// from the dashboard "Pending this week" widget's deep link.

export default async function MeasuresPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";

  const supabase = await createSupabaseServerClient();
  const { data: company } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle<{ timezone: string }>();
  const timezone = company?.timezone ?? "America/Anchorage";

  const { measures, weekEnding } = await getMeasuresOwnedBy(
    companyId,
    session.profile.id,
    timezone,
    isAdmin
  );

  return (
    <div className={styles.stage}>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Company</p>
          <h1 className={styles.h1}>Success Measures</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Log the week ending {formatShortDate(weekEnding)}. Enter a value
            in every row you have data for, then Save — leave rows blank if
            you want to come back to them.
          </p>
        </div>
      </header>

      <div className={styles.content}>
        <div className={boardLinkStyles.boardLinkRow}>
          <Link href="/measures/board" className={boardLinkStyles.boardLink}>
            Open Success Tracking Board →
          </Link>
        </div>
        {measures.length === 0 ? (
          <section className={styles.card}>
            <p className={styles.emptyLine}>
              {isAdmin
                ? "No success measures set up in this company yet. Add them on the Chart under each function's outcomes."
                : "No success measures assigned to you yet. Measures live under the functions you lead on the Chart — the person in the seat is the one on the hook for the numbers."}
            </p>
          </section>
        ) : (
          <MeasuresBatchForm measures={measures} weekEnding={weekEnding} />
        )}
      </div>
    </div>
  );
}
