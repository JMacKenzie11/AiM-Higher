import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import {
  getChartTree,
  type ChartFunction,
} from "@/lib/chart/service";
import { PageShell } from "@/components/ui/PageShell";
import { AddFunctionForm } from "./InlineForms";
import { DraggableTree } from "./DraggableTree";
import { PanZoomTree } from "./PanZoomTree";
import styles from "./chart.module.css";

// Chart — an org-chart tree of the company's functions.
//
// Each function box carries the minimum needed to read the shape of
// the org at a glance: function name, who's in the seat, and the
// outcomes the function is obsessed with delivering. LTD (Lead /
// Track / Decide) are three responsibilities of the one seat holder,
// not three separate assignments — so we show one name, not three.
// Success measures + weekly values live on the function's detail
// page; keeping them off the chart is what lets the chart stay a
// chart.

export default async function ChartPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const { roots, roster } = await getChartTree(companyId);

  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";

  // Flatten the tree so the Add form can offer any function as a
  // parent. Two levels of depth is what we render nicely on the
  // chart; the picker doesn't cap depth since a user could still
  // want a third level in unusual shapes.
  const parentOptions = flattenForParentPicker(roots);

  return (
    <PageShell
      eyebrow="Company"
      title="Functional Org Chart"
      subtitle={
        <>
          The functions that run the business. Each box shows who&rsquo;s in
          the seat and what they&rsquo;re obsessed with delivering. Click a
          function to see its success measures.
          {isAdmin ? " Drag a card to reorder siblings." : null}
        </>
      }
    >
      <div className={styles.chartCard}>
        {isAdmin ? (
          <div className={styles.chartCardHeader}>
            <details className={styles.addDetails}>
              <summary className={styles.addSummary}>+ Add function</summary>
              <AddFunctionForm people={roster} parentOptions={parentOptions} />
            </details>
          </div>
        ) : null}

        {roots.length === 0 ? (
          <EmptyChart isAdmin={isAdmin} />
        ) : (
          <div className={styles.tree}>
            <PanZoomTree>
              <DraggableTree roots={roots} canReorder={isAdmin} />
            </PanZoomTree>
          </div>
        )}
      </div>
    </PageShell>
  );
}

function flattenForParentPicker(
  roots: ChartFunction[]
): Array<{ id: string; title: string }> {
  const out: Array<{ id: string; title: string }> = [];
  const walk = (nodes: ChartFunction[], depth: number) => {
    for (const n of nodes) {
      out.push({
        id: n.id,
        title: depth === 0 ? n.title : `${"— ".repeat(depth)}${n.title}`,
      });
      if (n.children.length > 0) walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

function EmptyChart({ isAdmin }: { isAdmin: boolean }) {
  return (
    <section className={styles.emptyCard}>
      <p className={styles.emptyLead}>No functions yet.</p>
      <p className={styles.emptyLine}>
        {isAdmin
          ? "Start with the three or four functions your business needs — Field Operations, Preconstruction, Safety, Finance — and add the outcomes each one is on the hook for."
          : "Your team's accountability chart will appear here once it's set up."}
      </p>
    </section>
  );
}
