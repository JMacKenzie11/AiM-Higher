import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import {
  calendarQuarterOf,
  getQuartersForCompany,
  nextCalendarQuarter,
  type CalendarQuarter,
} from "@/lib/quarters/service";
import { QuartersTable } from "./QuartersTable";
import { OpenQuarterForm } from "./OpenQuarterForm";
import styles from "./quarters.module.css";

// Section 8.8 — quarter management. Admin-only writes; team members
// see the same table read-only.

export default async function QuartersPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);

  if (!companyId) {
    redirect("/admin/companies");
  }

  const [quarters] = await Promise.all([getQuartersForCompany(companyId)]);
  const canWrite =
    session.profile.role === "company_admin" ||
    session.profile.role === "system_admin";

  // Prefill "Open next quarter" from the calendar.
  const latest = quarters[0];
  let suggested: CalendarQuarter;
  if (latest) {
    const latestAsCal: CalendarQuarter = {
      label: latest.label,
      startDate: latest.start_date,
      endDate: latest.end_date,
    };
    suggested = nextCalendarQuarter(latestAsCal);
  } else {
    suggested = calendarQuarterOf(new Date());
  }

  const openQuarterExists = quarters.some((q) => q.status === "open");

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Quarters</h1>
        <span className="aims-rule" aria-hidden="true" />
        <p className={styles.subtitle}>
          Open a new quarter, close one when its 90 days end.
        </p>
      </header>

      {canWrite ? (
        <section className={styles.card} aria-labelledby="open-next">
          <h2 id="open-next" className={styles.h2}>
            Open next quarter
          </h2>
          {openQuarterExists ? (
            <p className={styles.emptyInline}>
              A quarter is already open. Close it before opening the next.
            </p>
          ) : (
            <OpenQuarterForm
              defaultLabel={suggested.label}
              defaultStart={suggested.startDate}
              defaultEnd={suggested.endDate}
              companyId={
                session.profile.role === "system_admin" ? companyId : undefined
              }
            />
          )}
        </section>
      ) : null}

      <section className={styles.card} aria-labelledby="quarters-table">
        <h2 id="quarters-table" className={styles.h2}>
          All quarters
        </h2>
        <QuartersTable quarters={quarters} canWrite={canWrite} />
      </section>
    </div>
  );
}
