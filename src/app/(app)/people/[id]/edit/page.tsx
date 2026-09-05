import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";
import { EditUserForm } from "./EditUserForm";
import styles from "../../people.module.css";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Admin edit surface for a single person. Handles first/last name,
// email, position, role, reports_to. Self-serve name/position edits
// still live on /profile. Company admins may edit users in their own
// company; sysadmins may edit anyone.

type PageProps = { params: Promise<{ id: string }> };

export default async function EditPersonPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const isSystemAdmin = session.profile.role === "system_admin";
  const isCompanyAdmin = session.profile.role === "company_admin";
  if (!isSystemAdmin && !isCompanyAdmin) redirect(`/people/${id}`);

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: subject } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle<Profile>();
  if (!subject) notFound();

  if (isCompanyAdmin && session.profile.company_id !== subject.company_id) {
    redirect("/people");
  }

  // Email lives on auth.users. Only sysadmins can call the admin API,
  // but this page is only reachable by admin roles anyway. Use the
  // admin client so a company_admin session can still read the value.
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data: authUser } = await admin.auth.admin.getUserById(subject.id);
  const email = authUser?.user?.email ?? "";

  // Roster for the "reports to" picker — company members only,
  // excluding the subject themselves.
  const roster: Array<Pick<Profile, "id" | "full_name">> = [];
  if (subject.company_id) {
    const { data: rows } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("company_id", subject.company_id)
      .neq("id", subject.id)
      .neq("status", "inactive")
      .order("full_name");
    roster.push(
      ...((rows ?? []) as Array<Pick<Profile, "id" | "full_name">>)
    );
  }

  const firstName = subject.full_name.split(" ")[0] ?? "";

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Edit person">
        <div className={styles.heroInner}>
          <Link href={`/people/${subject.id}`} className={styles.heroCrumb}>
            ← Back to {firstName}&rsquo;s scorecard
          </Link>
          <h1 className={styles.h1}>Edit {subject.full_name}</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            Update names, email, role, and who they report to. Email
            changes propagate to the Supabase auth record.
          </p>
        </div>
      </section>

      <div className={styles.content}>
        <section className={styles.card}>
          <EditUserForm
            subject={subject}
            initialEmail={email}
            roster={roster}
            callerRole={session.profile.role}
          />
        </section>
      </div>
    </div>
  );
}
