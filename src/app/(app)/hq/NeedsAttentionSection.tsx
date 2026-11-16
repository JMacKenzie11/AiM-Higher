import Link from "next/link";
import { reasonPhrase, type CompanyAttention } from "@/lib/hq/attention";
import { prepareHref, questionFor } from "@/lib/hq/derive";
import { ScopeIntoCompanyButton } from "../admin/companies/ScopeIntoCompanyButton";
import ui from "@/components/ui/ui.module.css";
import styles from "./hq.module.css";
import t from "./hq-tabs.module.css";

// Needs you this week: one row per assigned company that meets at
// least one attention trigger, ranked by severity. Each row says why
// in plain sentences (reasonPhrase, straight from the attention
// module so the "why" is verifiable), a question worth asking for the
// strongest signal (questionFor: fixed text, never generated), and
// Prepare a session, which opens the Coaching calls tab on that
// company. The oversight view passes prepare={false}: prep is the
// coach's own.

export function NeedsAttentionSection({
  rows,
  prepare = true,
}: {
  rows: CompanyAttention[];
  prepare?: boolean;
}) {
  return (
    <section id="needs-you" className={styles.card} aria-labelledby="hq-attention">
      <h2 id="hq-attention" className={styles.h2}>
        Needs you this week
      </h2>
      {rows.length === 0 ? (
        <p className={styles.empty}>Every company is on course this week.</p>
      ) : (
        <ul className={t.rowList}>
          {rows.map((row) => {
            const lead = row.triggers[0];
            return (
              <li key={row.companyId} className={t.needsRow}>
                <div className={t.needsText}>
                  <ScopeIntoCompanyButton companyId={row.companyId} className={styles.attentionNameLink}>
                    <span className={t.needsName}>{row.companyName}</span>
                  </ScopeIntoCompanyButton>
                  <span className={t.needsReason}>
                    {row.triggers.map((tr) => `${reasonPhrase(tr)}.`).join(" ")}
                  </span>
                  {lead ? <span className={t.needsQuestion}>Worth asking: {questionFor(lead)}</span> : null}
                </div>
                {prepare ? (
                  <Link href={prepareHref(row.companyId)} className={`${ui.btn} ${ui.btnPrimary}`} scroll={false}>
                    Prepare a session
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
