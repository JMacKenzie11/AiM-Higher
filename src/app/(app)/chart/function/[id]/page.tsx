import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getChartFunctionDetail } from "@/lib/chart/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { thisFriday } from "@/lib/dates";
import { CardAccent } from "@/components/ui/CardAccent";
import { PageShell } from "@/components/ui/PageShell";
import { DeleteFunctionButton } from "./DeleteFunctionButton";
import { RolesList } from "./RolesList";
import { SeatEditor } from "./SeatEditor";
import { AddSuccessMeasureRow } from "./AddSuccessMeasureRow";
import { FunctionTitleEditor } from "./FunctionTitleEditor";
import { SuccessMeasureCard } from "./SuccessMeasureCard";
import styles from "../../chart.module.css";

// Function detail — the whole story for a single function.
// The org chart is the map (function name, seat). This page is the
// dashboard: seat holder, roles & responsibilities, and per success
// measure the full list of metrics with targets and latest values.

type PageProps = { params: Promise<{ id: string }> };

export default async function ChartFunctionDetailPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const detail = await getChartFunctionDetail(id);
  if (!detail) notFound();

  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";
  // Weekly logging is admin OR the function's Lead / Track. Same
  // policy the upsertMeasureEntryAction enforces server-side — this
  // just gates the UI affordance.
  const canLog =
    isAdmin ||
    detail.fn.lead_id === session.profile.id ||
    detail.fn.track_id === session.profile.id;
  const outcomeCount = detail.outcomes.length;

  // Read the company's timezone so "this week" matches what
  // /measures and the Saturday auto-check use. Fall back to Alaska
  // if the row is somehow missing.
  const supabase = await createSupabaseServerClient();
  const { data: company } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", detail.fn.company_id)
    .maybeSingle<{ timezone: string }>();
  const weekEnding = thisFriday(company?.timezone ?? "America/Anchorage");

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
          <span className={styles.fnSeatLabel} id="seat">
            In the seat
          </span>
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
          />
        </section>

        <section className={styles.sectionCardAccent} aria-labelledby="measures">
          <CardAccent />
          <h2 id="measures" className={styles.sectionTitle}>
            Success Measures
          </h2>

          {outcomeCount > 3 ? (
            <p className={styles.focusWarning}>
              <strong>Focus reminder:</strong> {outcomeCount} success measures on
              this function. Three or fewer is the norm — everything else should
              either fold in or move.
            </p>
          ) : null}

          {detail.outcomes.map((o) => (
            <SuccessMeasureCard
              key={o.id}
              outcome={o}
              canEdit={isAdmin}
              canLog={canLog}
              weekEnding={weekEnding}
            />
          ))}

          {isAdmin ? (
            <AddSuccessMeasureRow functionId={detail.fn.id} />
          ) : detail.outcomes.length === 0 ? (
            <p className={styles.emptyOutcomeLine}>No success measures yet.</p>
          ) : null}
        </section>

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
