import type { RoleDescriptionDoc } from "@/lib/role-descriptions/parse-document";
import styles from "./RoleDescriptionView.module.css";

// The document, as it reads.
//
// One renderer for two places: the card the agent hands back, and
// the saved document at /chart/function/[id]/role-description. That
// is deliberate and it is the whole reason this is a component
// rather than markup inside the card. A preview that is assembled
// by different code from the thing it previews will eventually show
// something the saved page does not, and the leader finds out after
// they have sent it to somebody.
//
// Presentational only. It takes a parsed document and renders it;
// it never fetches, never saves, and has no opinion about whether
// what it is showing has been stored yet.

export function RoleDescriptionView({ doc }: { doc: RoleDescriptionDoc }) {
  const rights: Array<[string, string[]]> = [
    ["Decides", doc.decision_rights.decides],
    ["Decides with others", doc.decision_rights.decides_with],
    ["Recommends", doc.decision_rights.recommends],
  ];
  const hasRights = rights.some(([, list]) => list.length > 0);

  return (
    <article className={styles.doc}>
      <header className={styles.head}>
        <h3 className={styles.title}>{doc.title}</h3>
        <p className={styles.placement}>
          {doc.function ? (
            <>Part of {doc.function.title}</>
          ) : doc.supports_functions.length > 0 ? (
            <>Not on the chart. Supports {doc.supports_functions.join(", ")}</>
          ) : (
            // Said out loud. An off-chart role that supports nothing
            // is a choice the leader made when the agent asked, and a
            // blank here would read as a section that failed to load.
            <>Not on the chart</>
          )}
          {doc.reports_to ? <> · Reports to {doc.reports_to}</> : null}
        </p>
      </header>

      <Prose heading="Why this role exists" text={doc.why_this_role_exists} />

      {doc.responsibilities.length > 0 ? (
        <Section heading="Responsibilities">
          <ul className={styles.list}>
            {doc.responsibilities.map((r, i) => (
              <li key={`${r.category}-${i}`} className={styles.item}>
                <span className={styles.itemLead}>{r.category}</span>
                {r.description ? (
                  <span className={styles.itemBody}>{r.description}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {doc.critical_success_factors.length > 0 ? (
        <Section heading="Critical Success Factors">
          <ul className={styles.list}>
            {doc.critical_success_factors.map((c, i) => (
              <li key={`${c.description}-${i}`} className={styles.item}>
                <span className={styles.itemLead}>{c.description}</span>
                <span className={styles.meta}>
                  {/* Never "0" and never blank. A factor with no
                      target is an allowed state throughout this
                      product and must not read as a missed number. */}
                  {c.target === null ? (
                    <em className={styles.noTarget}>no target set</em>
                  ) : (
                    c.target
                  )}
                  {" · "}
                  {c.update_frequency}
                </span>
                {c.why_it_matters ? (
                  <span className={styles.itemBody}>{c.why_it_matters}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {hasRights ? (
        <Section heading="Decision Rights">
          {rights.map(([label, list]) =>
            list.length === 0 ? null : (
              <div key={label} className={styles.subBlock}>
                <p className={styles.subHeading}>{label}</p>
                <ul className={styles.list}>
                  {list.map((d, i) => (
                    <li key={`${d}-${i}`} className={styles.item}>
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}
        </Section>
      ) : null}

      {doc.what_excellence_looks_like.length > 0 ? (
        <Section heading="What excellence looks like">
          <ul className={styles.list}>
            {doc.what_excellence_looks_like.map((e, i) => (
              <li key={`${e.value}-${i}`} className={styles.item}>
                <span className={styles.itemLead}>{e.value}</span>
                <span className={styles.itemBody}>{e.behaviour}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {doc.capabilities.length > 0 ? (
        <Section heading="Capabilities">
          <ul className={styles.list}>
            {doc.capabilities.map((c, i) => (
              <li key={`${c}-${i}`} className={styles.item}>
                {c}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {doc.qualifications.length > 0 ? (
        <Section heading="Qualifications">
          <ul className={styles.list}>
            {doc.qualifications.map((q, i) => (
              <li key={`${q}-${i}`} className={styles.item}>
                {q}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Prose heading="Why this role matters" text={doc.why_this_role_matters} />
    </article>
  );
}

function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h4 className={styles.heading}>{heading}</h4>
      {children}
    </section>
  );
}

// A section that is missing renders as nothing rather than as an
// empty heading. The interview can legitimately end without one.
function Prose({ heading, text }: { heading: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <Section heading={heading}>
      {text.split(/\n{2,}/).map((para, i) =>
        para.trim() ? (
          <p key={i} className={styles.para}>
            {para.trim()}
          </p>
        ) : null
      )}
    </Section>
  );
}
