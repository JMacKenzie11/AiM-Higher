import { requireRole } from "@/lib/auth/current-user";
import { PageShell } from "@/components/ui/PageShell";
import {
  loadPortfolioOverview,
  loadPortfolioAdminAccess,
} from "@/lib/portfolio/service";
import { CompanyAccessRows } from "@/components/access/CompanyAccessRows";
import { setPortfolioCompanyAccessAction } from "@/lib/portfolio/company-access-actions";
import { CreateCompanyForm } from "../admin/companies/CreateCompanyForm";
import { PortfolioCompanyCard } from "./PortfolioCompanyCard";
import styles from "./portfolio.module.css";

// /portfolio — where a portfolio_admin lands, and the only cross-
// company surface they have.
//
// OVERSIGHT, NOT COACHING. Guide HQ answers "what needs me this week":
// an attention queue, nudges, session briefs, an activity feed. This
// answers "what shape is the portfolio in". The coaching machinery is
// deliberately absent and deliberately not imported — a queue that
// tells a portfolio owner which companies to chase is a different
// product decision, and it would arrive here by accretion if the
// imports were already in the file.
//
// NO SPECIAL CASING FOR ONE COMPANY. An instance with a single company
// renders one card in the same grid. The alternative — detecting the
// case and rendering something bespoke — means a second layout that
// only one instance ever sees, and therefore a second layout nobody
// ever looks at.

export default async function PortfolioPage() {
  // system_admin is admitted alongside, and only so the surface can be
  // looked at by the people who grant the role. It is not their home;
  // middleware still sends them to /hq.
  const session = await requireRole(["portfolio_admin", "system_admin"]);
  const [cards, access] = await Promise.all([
    loadPortfolioOverview(),
    loadPortfolioAdminAccess(),
  ]);
  // A portfolio admin manages their own access and nobody else's,
  // which is what portfolio_assignments_insert already enforces: it
  // admits a row only when it names the caller. Filtering here keeps
  // the page from rendering rows whose Update button RLS would
  // refuse. A system admin sees every row.
  const accessRows =
    session.profile.role === "system_admin"
      ? access
      : access.filter((row) => row.id === session.profile.id);

  return (
    <PageShell
      eyebrow={
        session.profile.role === "portfolio_admin"
          ? "Portfolio admin"
          : "System admin"
      }
      title="Portfolio"
      subtitle="Every company on this instance, with the three numbers that say how each one is doing. Open a company to look inside it."
      ariaLabel="Portfolio header"
    >
      <div className={styles.content}>
        {cards.length === 0 ? (
          // THE EMPTY INSTANCE IS THE CREATE AFFORDANCE, not an empty
          // dashboard with a button hidden under it. A portfolio admin
          // arriving at a fresh instance has exactly one useful thing
          // to do, so that is what the page is.
          <section className={styles.zeroCard} aria-labelledby="portfolio-zero">
            <h2 id="portfolio-zero" className={styles.zeroTitle}>
              No companies yet
            </h2>
            <p className={styles.zeroBody}>
              This instance has no companies on it. Create the first one
              and it will appear here with its scorecard, its quarter and
              its week.
            </p>
            <CreateCompanyForm />
          </section>
        ) : (
          <>
            <section className={styles.card} aria-labelledby="portfolio-companies">
              <h2 id="portfolio-companies" className={styles.h2}>
                Companies
              </h2>
              <p className={styles.sectionCaption}>
                Scorecard overall, this quarter&rsquo;s priorities, and this
                week&rsquo;s commitments. Each company&rsquo;s week ends on
                Friday in its own timezone.
              </p>
              <ul className={styles.grid}>
                {cards.map((card) => (
                  <PortfolioCompanyCard key={card.id} card={card} />
                ))}
              </ul>
            </section>

            {/* Company admin access. The one thing a portfolio admin
                could not do from anywhere in the app until now: the
                grant existed, was enforced, and was reachable only by
                writing a migration. */}
            {accessRows.length > 0 ? (
              <section className={styles.card} aria-labelledby="portfolio-access">
                <h2 id="portfolio-access" className={styles.h2}>
                  Company admin access
                </h2>
                <p className={styles.sectionCaption}>
                  Tick the companies you actively run. You get the same rights
                  a company admin has there, and you appear on that
                  company&rsquo;s team list. Reading every company on the
                  instance does not depend on this and never changes.
                </p>
                <CompanyAccessRows
                  rows={accessRows.map((r) => ({
                    id: r.id,
                    name: r.fullName,
                    companyIds: r.companyIds,
                    openCommitmentsByCompany: r.openCommitmentsByCompany,
                  }))}
                  companies={cards.map((c) => ({ id: c.id, name: c.name }))}
                  action={setPortfolioCompanyAccessAction}
                  personLabel="Portfolio admin"
                  emptyLabel="No portfolio admins on this instance yet."
                />
              </section>
            ) : null}

            <section className={styles.card} aria-labelledby="portfolio-create">
              <h2 id="portfolio-create" className={styles.h2}>
                Create a company
              </h2>
              <CreateCompanyForm />
            </section>
          </>
        )}
      </div>
    </PageShell>
  );
}
