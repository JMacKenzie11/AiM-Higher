import Link from "next/link";
import { reasonPhrase, type CompanyAttention } from "@/lib/hq/attention";
import styles from "./hq.module.css";

// Needs-your-attention list. One row per assigned company that meets
// at least one attention trigger; ranked by severity. Reason phrases
// come straight from the attention module so the "why" is verifiable.

export function NeedsAttentionSection({ rows }: { rows: CompanyAttention[] }) {
  return (
    <section className={styles.card} aria-labelledby="hq-attention">
      <h2 id="hq-attention" className={styles.h2}>
        Needs your attention
      </h2>
      <p className={styles.sectionCaption}>
        Assigned companies flagged for at least one signal this week.
        Ranked by severity.
      </p>
      {rows.length === 0 ? (
        <p className={styles.empty}>
          Nothing needs attention this week. Enjoy the quiet.
        </p>
      ) : (
        <ul className={styles.attentionList}>
          {rows.map((row) => (
            <li key={row.companyId} className={styles.attentionItem}>
              <div className={styles.attentionHead}>
                <span className={styles.attentionName}>
                  <Link
                    className={styles.attentionNameLink}
                    href={`/admin/companies/${row.companyId}`}
                  >
                    {row.companyName}
                  </Link>
                </span>
                <span className={styles.attentionSeverity}>
                  {row.triggers.length} signal
                  {row.triggers.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className={styles.attentionReasons}>
                {row.triggers.map((t, i) => (
                  <li key={i}>{reasonPhrase(t)}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
