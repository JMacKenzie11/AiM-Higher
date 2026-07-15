import Link from "next/link";
import { requireProfile } from "@/lib/auth/current-user";
import { ProfileDetailsForm } from "./ProfileDetailsForm";
import { ChangePasswordForm } from "./ChangePasswordForm";
import styles from "./profile.module.css";

// /profile — self-serve edit for the signed-in user.
// Name + position live on public.profiles; password change goes
// through Supabase auth.updateUser({ password }).

export default async function ProfilePage() {
  const session = await requireProfile();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>My profile</h1>
        <span className="aims-rule" aria-hidden="true" />
        <p className={styles.subtitle}>
          Keep your name, position, and password up to date. Only you can
          edit this page.
        </p>
      </header>

      <section className={styles.card} aria-labelledby="details">
        <h2 id="details" className={styles.h2}>
          Details
        </h2>
        <p className={styles.email}>Signed in as {session.email}</p>
        <ProfileDetailsForm
          id={session.profile.id}
          fullName={session.profile.full_name}
          position={session.profile.position ?? ""}
          role={session.profile.role}
        />
      </section>

      <section className={styles.card} aria-labelledby="coaching">
        <h2 id="coaching" className={styles.h2}>
          Coaching
        </h2>
        <p className={styles.subtitleInline}>
          Talk through what&rsquo;s on your mind — your commitments, where
          you&rsquo;re stuck, what to prepare for. Your conversations stay
          private to you.
        </p>
        <Link href={`/coach/${session.profile.id}`} className={styles.ctaLink}>
          Get coaching →
        </Link>
      </section>

      <section className={styles.card} aria-labelledby="password">
        <h2 id="password" className={styles.h2}>
          Change password
        </h2>
        <p className={styles.subtitleInline}>
          At least 8 characters. You&rsquo;ll stay signed in on this device.
        </p>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
