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
import styles from "./foundation.module.css";

// Foundation — a single stacked page (dashboard-style).
// Marketing Strategy / Messaging Pillars / Hooks / Messaging to Avoid
// were removed from the UI while the marketing surface is rethought.
// The underlying tables and server actions remain intact so the
// content isn't lost. To bring them back, restore the removed sections
// in this file (see git history) and re-import the removed helpers.

export default async function FoundationPage() {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) redirect("/admin/companies");

  const data = await getFoundation(companyId);
  const supabase = await createSupabaseServerClient();
  const { data: company } = await supabase
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle<{ name: string }>();
  const companyName = company?.name ?? "this company";
  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";

  const f = data.foundation;

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Foundation summary">
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>Company foundation</p>
          <h1 className={styles.h1}>Foundation</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Who {companyName} is, in your own words.
          </p>
        </div>
      </section>

      <div className={styles.content}>
        {/* ============ Purpose ============ */}
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

        {/* ============ Core Values ============ */}
        <section className={styles.card} aria-labelledby="values">
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

        {/* ============ Vision ============ */}
        <SectionEditToggle
          title="Vision"
          canEdit={isAdmin}
          readView={
            <div className={styles.sectionBody}>
              {f?.vision_title ? (
                <h3 className={styles.visionTitle}>{f.vision_title}</h3>
              ) : null}
              {f?.vision_tagline ? (
                <p className={styles.visionTagline}>{f.vision_tagline}</p>
              ) : null}
              {f?.vision_body ? (
                <p className={styles.bodyText}>{f.vision_body}</p>
              ) : null}
              {!f?.vision_title && !f?.vision_body ? (
                <p className={styles.emptyLine}>
                  Add the vision title and narrative so the whole team can
                  picture the destination.
                </p>
              ) : null}
            </div>
          }
          editView={<VisionForm foundation={data.foundation} />}
        />

        {/* ============ Vision Milestones ============ */}
        <section className={styles.card} aria-labelledby="milestones">
          <h2 id="milestones" className={styles.h2}>
            Vision Milestones
          </h2>
          {data.visionMilestones.length === 0 ? (
            <p className={styles.emptyLine}>
              No milestones yet. Break the vision into markers your team can
              see themselves reaching.
            </p>
          ) : (
            <div className={styles.grid2}>
              {data.visionMilestones.map((milestone) => (
                <article key={milestone.id} className={styles.subcard}>
                  <h3 className={styles.h3}>{milestone.title}</h3>
                  {milestone.body ? (
                    <p className={styles.bodyText}>{milestone.body}</p>
                  ) : null}
                  {isAdmin ? (
                    <div className={styles.subcardActions}>
                      <EditFoundationItemForm item={milestone} />
                      <DeleteButton
                        action={deleteFoundationItemAction}
                        itemId={milestone.id}
                        confirmMessage="Delete this milestone?"
                      />
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
          {isAdmin ? (
            <AddFoundationItemForm
              kind="vision_milestone"
              addLabel="Add milestone"
              titleLabel="Milestone title"
              bodyLabel="Description"
            />
          ) : null}
        </section>

        {/* ============ Differentiators ============ */}
        <section className={styles.card} aria-labelledby="diffs">
          <h2 id="diffs" className={styles.h2}>
            Differentiators
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

        {/* ============ ICP ============ */}
        <section className={styles.card} aria-labelledby="icp">
          <h2 id="icp" className={styles.h2}>
            Ideal Customer Profile
          </h2>
          <div className={styles.grid2}>
            <div className={styles.subcard}>
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

            <div className={styles.subcard}>
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
          </div>
        </section>

      </div>
    </div>
  );
}
