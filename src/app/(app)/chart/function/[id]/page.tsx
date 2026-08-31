import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getChartFunctionDetail } from "@/lib/chart/service";
import {
  createFunctionCompetencyAction,
  createFunctionDecisionRightAction,
  deleteFunctionCompetencyAction,
  deleteFunctionDecisionRightAction,
  renameFunctionCompetencyAction,
  renameFunctionDecisionRightAction,
} from "@/lib/chart/actions";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { CardAccent } from "@/components/ui/CardAccent";
import { PageShell } from "@/components/ui/PageShell";
import { DeleteFunctionButton } from "./DeleteFunctionButton";
import { RolesList } from "./RolesList";
import { SeatEditor } from "./SeatEditor";
import { FunctionTitleEditor } from "./FunctionTitleEditor";
import { RoleDescriptionReadiness } from "./RoleDescriptionReadiness";
import { SimpleFunctionItemList } from "./SimpleFunctionItemList";
import styles from "../../chart.module.css";

// Function detail — the whole story for a single function.
// The org chart is the map (function name, seat). This page is the
// dashboard: seat holder, roles & responsibilities, decision rights,
// competency indicators.

type PageProps = { params: Promise<{ id: string }> };

export default async function ChartFunctionDetailPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const detail = await getChartFunctionDetail(id);
  if (!detail) notFound();

  // isAdmin controls the inline edit affordances (add/rename/delete
  // rows, seat picker, delete function). aims_guide is admin-
  // equivalent for their assigned companies — see the memory rule
  // "guides = company_admin on assigned companies" — so this uses
  // isAdminForCompany rather than a role-only check.
  const isAdmin = isAdminForCompany(session.profile, detail.fn.company_id);

  const rdEnabled = await companyHasFeature(
    detail.fn.company_id,
    "role_descriptions"
  );

  return (
    <PageShell
      backHref="/chart"
      backLabel="Back to chart"
      eyebrow="Function"
      title={
        <FunctionTitleEditor
          functionId={detail.fn.id}
          initialTitle={detail.fn.title}
          canEdit={isAdmin}
        />
      }
      subtitle={
        detail.parent ? (
          <>
            Part of{" "}
            <Link href={`/chart/function/${detail.parent.id}`}>
              {detail.parent.title}
            </Link>
          </>
        ) : undefined
      }
    >
        <section className={styles.sectionCard} aria-labelledby="seat">
          <h2 id="seat" className={styles.sectionTitle}>
            In the seat
          </h2>
          <SeatEditor
            functionId={detail.fn.id}
            currentSeatHolder={detail.seatHolder}
            roster={detail.roster}
            canEdit={isAdmin}
          />
        </section>

        <section className={styles.sectionCardAccent} aria-labelledby="roles">
          <CardAccent />
          <h2 id="roles" className={styles.sectionTitle}>
            Roles & Responsibilities
          </h2>
          <RolesList
            functionId={detail.fn.id}
            roles={detail.roles}
            canEdit={isAdmin}
            rdEnabled={rdEnabled}
          />
        </section>

        {rdEnabled ? (
          <>
            <section
              className={styles.sectionCardAccent}
              aria-labelledby="decision-rights"
            >
              <CardAccent />
              <h2 id="decision-rights" className={styles.sectionTitle}>
                Decision Rights
              </h2>
              <SimpleFunctionItemList
                functionId={detail.fn.id}
                items={detail.decisionRights}
                canEdit={isAdmin}
                singularLabel="decision right"
                addPlaceholder="Add a decision this role can make without escalation — press Enter to save."
                suggestTarget="decision_rights"
                suggestButtonLabel="Suggest decision rights"
                createAction={createFunctionDecisionRightAction}
                renameAction={renameFunctionDecisionRightAction}
                deleteAction={deleteFunctionDecisionRightAction}
              />
            </section>

            <section
              className={styles.sectionCardAccent}
              aria-labelledby="competencies"
            >
              <CardAccent />
              <h2 id="competencies" className={styles.sectionTitle}>
                Competency Indicators
              </h2>
              <SimpleFunctionItemList
                functionId={detail.fn.id}
                items={detail.competencies}
                canEdit={isAdmin}
                singularLabel="competency indicator"
                addPlaceholder="Add an observable behavior that shows excellence in this seat — press Enter to save."
                suggestTarget="competencies"
                suggestButtonLabel="Suggest competency indicators"
                createAction={createFunctionCompetencyAction}
                renameAction={renameFunctionCompetencyAction}
                deleteAction={deleteFunctionCompetencyAction}
              />
            </section>
          </>
        ) : null}

        {detail.children.length > 0 ? (
          <section className={styles.sectionCard} aria-labelledby="subs">
            <h2 id="subs" className={styles.sectionTitle}>
              Sub-functions
            </h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {detail.children.map((c) => (
                <li key={c.id}>
                  <Link href={`/chart/function/${c.id}`} className={styles.crumb}>
                    {c.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {rdEnabled ? (
          <RoleDescriptionReadiness detail={detail} canEdit={isAdmin} />
        ) : null}

        {isAdmin ? (
          <section className={styles.dangerZone}>
            <DeleteFunctionButton
              functionId={detail.fn.id}
              functionTitle={detail.fn.title}
              hasChildren={detail.children.length > 0}
            />
          </section>
        ) : null}
    </PageShell>
  );
}
