import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMeasuresOwnedBy } from "@/lib/measures/service";
import { getBoardData } from "@/lib/measures/board";
import { formatShortDate } from "@/lib/dates";
import { MeasuresBatchForm } from "./MeasuresBatchForm";
import { BoardView } from "./board/BoardView";
import styles from "../admin/companies/admin.module.css";

// Success Measures — read at the top, write at the bottom.
//   * Board view (top): a 13-week read of metric performance vs.
//     target across every function. Two toggleable views (Grid +
//     Timeline) live inside BoardView.
//   * Batch scoreboard (bottom): the caller's own metrics with
//     coloured inputs so a leader can log the current week without
//     leaving the page they came to read.
//
// Everyone sees the board. What varies is the batch table below —
// leaders see the metrics they own via seat holding; admins see
// every metric in the company.

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

  const [{ measures, weekEnding }, board] = await Promise.all([
    getMeasuresOwnedBy(companyId, session.profile.id, timezone, isAdmin),
    getBoardData(companyId, timezone),
  ]);

  const boardHasContent =
    board.functions.length > 0 &&
    board.functions.some((f) => f.metrics.length > 0);

  return (
    <div className={styles.stage}>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Company</p>
          <h1 className={styles.h1}>Success Measures</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            The last 13 weeks vs. target, by function — then log the week
            ending {formatShortDate(weekEnding)} below.
          </p>
        </div>
      </header>

      <div className={styles.content}>
        {boardHasContent ? <BoardView data={board} /> : null}

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
