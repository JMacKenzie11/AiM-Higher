import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserStrengths } from "@/lib/strengths/user-strengths";
import { StrengthsEditor } from "@/components/strengths/StrengthsEditor";
import type { Profile } from "@/lib/types";
import styles from "@/app/(app)/strengths/strengths.module.css";

// Manual strengths for a specific team member. Editable by self,
// system_admin, or company_admin of the same company.

type PageProps = { params: Promise<{ id: string }> };

export default async function PersonStrengthsPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const supabase = await createSupabaseServerClient();

  const { data: subject } = await supabase
    .from("profiles")
    .select("id, first_name, full_name, position, company_id")
    .eq("id", id)
    .maybeSingle<
      Pick<Profile, "id" | "first_name" | "full_name" | "position" | "company_id">
    >();
  if (!subject) notFound();

  const isSelf = session.profile.id === subject.id;
  const isSystemAdmin = session.profile.role === "system_admin";
  const isCompanyAdmin =
    session.profile.role === "company_admin" &&
    session.profile.company_id === subject.company_id;
  if (!isSelf && !isSystemAdmin && !isCompanyAdmin) redirect("/people");

  const strengths = await getUserStrengths(subject.id);
  const firstName = subject.first_name ?? subject.full_name.split(" ")[0] ?? "";

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Strengths">
        <div className={styles.heroInner}>
          <Link href={`/people/${subject.id}`} className={styles.backCrumbLink}>
            ← Back to {firstName}&rsquo;s scorecard
          </Link>
          <p className={styles.eyebrow}>Strengths</p>
          <h1 className={styles.h1}>
            {isSelf
              ? `Your strengths, ${firstName}`
              : `${subject.full_name}'s strengths`}
          </h1>
          <span className={styles.rule} aria-hidden="true" />
          {subject.position ? (
            <p className={styles.subtitle}>{subject.position}</p>
          ) : null}
        </div>
      </section>
      <div className={styles.content}>
        <section className={styles.card}>
          <StrengthsEditor userId={subject.id} initial={strengths} heading="" />
        </section>
      </div>
    </div>
  );
}
