import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBoardData } from "@/lib/measures/board";
import { PageShell } from "@/components/ui/PageShell";
import { BoardView } from "./BoardView";
import styles from "./board.module.css";

// Success Tracking board — 13 weeks of metric performance across
// every function. Two views (toggle in BoardView): a cockpit grid
// where each function is a card with a per-metric weekly heatmap,
// and a timeline where each function is a row and each cell rolls
// up all its metrics for that week. Same underlying data.

export default async function BoardPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const supabase = await createSupabaseServerClient();
  const { data: company } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle<{ timezone: string }>();
  const tz = company?.timezone ?? "America/Anchorage";

  const board = await getBoardData(companyId, tz);
  const totalMetrics = board.functions.reduce(
    (n, f) => n + f.metrics.length,
    0
  );

  return (
    <PageShell
      backHref="/measures"
      backLabel="Back to Success Measures"
      eyebrow="Company"
      title="Success Tracking Board"
      subtitle="Metric performance vs. targets across every function — the last 13 weeks. Green means the week hit target, red means it missed, grey means nothing was logged."
    >
      {board.functions.length === 0 || totalMetrics === 0 ? (
        <section className={styles.emptyCard}>
          <p className={styles.emptyLead}>Nothing to plot yet.</p>
          <p className={styles.emptyLine}>
            Add success measures + metrics under each function on the Chart.
            Come back once a few weeks of data are logged and the board will
            fill in.
          </p>
        </section>
      ) : (
        <BoardView data={board} />
      )}
    </PageShell>
  );
}
