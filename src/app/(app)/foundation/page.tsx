import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFoundation } from "@/lib/foundation/service";
import {
  deleteFoundationItemAction,
  deleteSnippetAction,
} from "@/lib/foundation/actions";
import { DeleteButton } from "./DeleteButton";
import {
  AddFoundationItemForm,
  EditFoundationItemForm,
} from "./FoundationItemForms";
import { PurposeForm } from "./PurposeForm";
import { VisionForm } from "./VisionForm";
import { AddSnippetForm } from "./MarketingForms";
import { SectionEditToggle } from "./SectionEditToggle";
import { CardAccent } from "@/components/ui/CardAccent";
import type { StrategicFocusArea } from "@/lib/types";
import styles from "./foundation.module.css";

// One-Page Plan — the single-page AiMS one-pager. Two columns of
// content plus a full-width Key Success Metrics band at the bottom.
// Vision is now a single field; the legacy title/tagline/body split
// and vision_milestone items were consolidated in migration 0106.

export default async function OnePagePlanPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const supabase = await createSupabaseServerClient();
  const [data, { data: companyRow }, { data: sfaRows }] = await Promise.all([
    getFoundation(companyId),
    supabase
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle<{ name: string }>(),
    supabase
      .from("strategic_focus_areas")
      .select("id, title, description, sort_order, archived")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("sort_order"),
  ]);

  const companyName = companyRow?.name ?? "this company";
  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";
  const f = data.foundation;
  const sfas = (sfaRows ?? []) as Array<Pick<StrategicFocusArea, "id" | "title" | "description">>;

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="One-Page Plan summary">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Plan</p>
          <h1 className={styles.h1}>One-Page Plan</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Who {companyName} is, where you&rsquo;re going, and what you&rsquo;re
            measuring, all in one place.
          </p>
        </div>
      </section>

      <div className={styles.content}>
        <div className={styles.columns}>
          {/* ============ LEFT COLUMN ============ */}
          <div className={styles.column}>
            {/* Purpose */}
            <SectionEditToggle
              title="Purpose"
              canEdit={isAdmin}
              readView={
                <div className={styles.sectionBody}>
                  {f?.purpose_context ? (
                    <p className={styles.contextLine}>{f.purpose_context}</p>
                  ) : null}
                  {f?.purpose_statement ? (
                    <p className={styles.purposeStatement}>{f.purpose_statement}</p>
                  ) : (
                    <p className={styles.emptyLine}>
                      Add the purpose statement and context to give the whole
                      company a shared north star.
                    </p>
                  )}
                </div>
              }
              editView={<PurposeForm foundation={data.foundation} />}
              accent
            />

            {/* Core Values */}
            <section className={styles.cardAccent} aria-labelledby="values">
              <CardAccent />
              <h2 id="values" className={styles.h2}>
                Core Values
              </h2>
              {data.coreValues.length === 0 ? (
                <p className={styles.emptyLine}>
                  No core values yet. {isAdmin ? "Add the first one below." : ""}
                </p>
              ) : (
                <div className={styles.grid2}>
                  {data.coreValues.map((value) => (
                    <article key={value.id} className={styles.subcard}>
                      <h3 className={styles.h3}>{value.title}</h3>
                      {value.body ? (
                        <p className={styles.bodyText}>{value.body}</p>
                      ) : null}
                      {isAdmin ? (
                        <div className={styles.subcardActions}>
                          <EditFoundationItemForm item={value} />
                          <DeleteButton
                            action={deleteFoundationItemAction}
                            itemId={value.id}
                            confirmMessage="Delete this core value?"
                          />
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
              {isAdmin ? (
                <AddFoundationItemForm
                  kind="core_value"
                  addLabel="Add core value"
                  titleLabel="Value title"
                  bodyLabel="What it looks like in practice"
                />
              ) : null}
            </section>

            {/* Strengths & Differentiators */}
            <section className={styles.cardAccent} aria-labelledby="diffs">
              <CardAccent />
              <h2 id="diffs" className={styles.h2}>
                Strengths & Differentiators
              </h2>
              {data.differentiators.length === 0 ? (
                <p className={styles.emptyLine}>
                  No differentiators yet.{" "}
                  {isAdmin
                    ? "Name the two or three things that make this company distinct."
                    : ""}
                </p>
              ) : (
                <div className={styles.grid2}>
                  {data.differentiators.map((item, index) => (
                    <article key={item.id} className={styles.differentiatorCard}>
                      <span
                        className={`${styles.differentiatorNumber} aims-tabular`}
                        aria-hidden="true"
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className={styles.differentiatorMain}>
                        <h3 className={styles.h3}>{item.title}</h3>
                        {item.body ? (
                          <p className={styles.bodyText}>{item.body}</p>
                        ) : null}
                        {isAdmin ? (
                          <div className={styles.subcardActions}>
                            <EditFoundationItemForm item={item} />
                            <DeleteButton
                              action={deleteFoundationItemAction}
                              itemId={item.id}
                              confirmMessage="Delete this differentiator?"
                            />
                          </div>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {isAdmin ? (
                <AddFoundationItemForm
                  kind="differentiator"
                  addLabel="Add differentiator"
                  titleLabel="Differentiator title"
                  bodyLabel="Supporting paragraph"
                />
              ) : null}
            </section>
          </div>

          {/* ============ RIGHT COLUMN ============ */}
          <div className={styles.column}>
            {/* Vision */}
            <SectionEditToggle
              title="Vision"
              canEdit={isAdmin}
              readView={
                <div className={styles.sectionBody}>
                  {f?.vision ? (
                    <p className={styles.bodyText} style={{ whiteSpace: "pre-wrap" }}>
                      {f.vision}
                    </p>
                  ) : (
                    <p className={styles.emptyLine}>
                      Add the vision so the whole team can picture the destination.
                    </p>
                  )}
                </div>
              }
              editView={<VisionForm foundation={data.foundation} />}
              accent
            />

            {/* Strategic Focus Areas — read-only preview; managed on /plan */}
            <section className={styles.cardAccent} aria-labelledby="sfas">
              <CardAccent />
              <h2 id="sfas" className={styles.h2}>
                Strategic Focus Areas
              </h2>
              {sfas.length === 0 ? (
                <p className={styles.emptyLine}>
                  No strategic focus areas yet.{" "}
                  {isAdmin ? (
                    <>
                      Add them on the{" "}
                      <Link href="/plan" className={styles.inlineLink}>
                        Strategic Plan
                      </Link>{" "}
                      page.
                    </>
                  ) : null}
                </p>
              ) : (
                <>
                  <ul className={styles.plainList}>
                    {sfas.map((sfa) => (
                      <li key={sfa.id} className={styles.plainListItem}>
                        <h3 className={styles.h3}>{sfa.title}</h3>
                        {sfa.description ? (
                          <p className={styles.bodyText}>{sfa.description}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {isAdmin ? (
                    <p className={styles.contextLine}>
                      Manage focus areas on the{" "}
                      <Link href="/plan" className={styles.inlineLink}>
                        Strategic Plan
                      </Link>{" "}
                      page.
                    </p>
                  ) : null}
                </>
              )}
            </section>

            {/* Ideal Client Avatar */}
            <section className={styles.cardAccent} aria-labelledby="ica">
              <CardAccent />
              <h2 id="ica" className={styles.h2}>
                Ideal Client Avatar
              </h2>
              <div>
                <p className={styles.metaLabel}>Best-fit clients and projects</p>
                {data.snippets.icp_best_fit.length === 0 ? (
                  <p className={styles.emptyLine}>No entries yet.</p>
                ) : (
                  <ul className={styles.plainList}>
                    {data.snippets.icp_best_fit.map((snippet) => (
                      <li key={snippet.id} className={styles.plainListItem}>
                        <div className={styles.itemRow}>
                          <span>{snippet.content}</span>
                          {isAdmin ? (
                            <DeleteButton
                              action={deleteSnippetAction}
                              itemId={snippet.id}
                              confirmMessage="Remove this entry?"
                            />
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {isAdmin ? (
                  <AddSnippetForm kind="icp_best_fit" addLabel="Add best-fit" />
                ) : null}
              </div>

              <div>
                <p className={styles.metaLabel}>Psychographics</p>
                {data.snippets.icp_psychographic.length === 0 ? (
                  <p className={styles.emptyLine}>No entries yet.</p>
                ) : (
                  <ul className={styles.plainList}>
                    {data.snippets.icp_psychographic.map((snippet) => (
                      <li key={snippet.id} className={styles.plainListItem}>
                        <div className={styles.itemRow}>
                          <span>{snippet.content}</span>
                          {isAdmin ? (
                            <DeleteButton
                              action={deleteSnippetAction}
                              itemId={snippet.id}
                              confirmMessage="Remove this entry?"
                            />
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {isAdmin ? (
                  <AddSnippetForm
                    kind="icp_psychographic"
                    addLabel="Add psychographic"
                  />
                ) : null}
              </div>
            </section>
          </div>
        </div>

        {/* ============ Key Success Metrics (full width) ============ */}
        <section className={styles.cardAccent} aria-labelledby="metrics">
          <CardAccent />
          <h2 id="metrics" className={styles.h2}>
            Key Success Metrics
          </h2>
          {data.keySuccessMetrics.length === 0 ? (
            <p className={styles.emptyLine}>
              No metrics yet.{" "}
              {isAdmin
                ? "Add the handful of numbers this company measures itself by."
                : ""}
            </p>
          ) : (
            <div className={styles.grid2}>
              {data.keySuccessMetrics.map((metric) => (
                <article key={metric.id} className={styles.subcard}>
                  <h3 className={styles.h3}>{metric.title}</h3>
                  {metric.body ? (
                    <p className={styles.bodyText}>{metric.body}</p>
                  ) : null}
                  {isAdmin ? (
                    <div className={styles.subcardActions}>
                      <EditFoundationItemForm item={metric} />
                      <DeleteButton
                        action={deleteFoundationItemAction}
                        itemId={metric.id}
                        confirmMessage="Delete this metric?"
                      />
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
          {isAdmin ? (
            <AddFoundationItemForm
              kind="key_success_metric"
              addLabel="Add metric"
              titleLabel="Metric"
              bodyLabel="Target or definition"
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
