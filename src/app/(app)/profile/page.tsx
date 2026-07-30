import { requireProfile } from "@/lib/auth/current-user";
import { getUserStrengths } from "@/lib/strengths/user-strengths";
import { StrengthsEditor } from "@/components/strengths/StrengthsEditor";
import { ProfileDetailsForm } from "./ProfileDetailsForm";
import { ChangePasswordForm } from "./ChangePasswordForm";
import styles from "./profile.module.css";

// /profile — self-serve edit for the signed-in user.
// Name + position live on public.profiles; password change goes
// through Supabase auth.updateUser({ password }).

export default async function ProfilePage() {
  const session = await requireProfile();
  const strengths = await getUserStrengths(session.profile.id);

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

      <section className={styles.card} aria-labelledby="strengths">
        <h2 id="strengths" className={styles.h2}>
          Strengths & superpowers
        </h2>
        <p className={styles.subtitleInline}>
          A few words about what you&rsquo;re strong at, and what people say
          you&rsquo;re uniquely good at. Your coach uses these to tailor the
          conversation.
        </p>
        <StrengthsEditor userId={session.profile.id} initial={strengths} heading="" />
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
