import { requireProfile } from "@/lib/auth/current-user";
import { getUserStrengths } from "@/lib/strengths/user-strengths";
import { StrengthsEditor } from "@/components/strengths/StrengthsEditor";
import { PageShell } from "@/components/ui/PageShell";
import { listMyMemoriesAction } from "@/lib/coach/memory-actions";
import { MemoryCard } from "./MemoryCard";
import { AvatarUpload } from "./AvatarUpload";
import { ProfileDetailsForm } from "./ProfileDetailsForm";
import { ChangePasswordForm } from "./ChangePasswordForm";
import styles from "./profile.module.css";
import { ConnectedAssistants } from "./ConnectedAssistants";
import { HowToConnectButton } from "@/components/ai-apps/ConnectAiAppsDrawer";
import { listMyAssistantsAction } from "@/lib/mcp/grants";
import { currentHelpViewer, helpFeaturesFor } from "@/lib/help/loader";

// /profile — self-serve edit for the signed-in user.
// Name + position live on public.profiles; password change goes
// through Supabase auth.updateUser({ password }).

export default async function ProfilePage() {
  const session = await requireProfile();
  const strengths = await getUserStrengths(session.profile.id);

  // Newest first already. The card takes all of them and pages in
  // place, so there is no second page to send anybody to.
  const { rows: memories } = await listMyMemoriesAction();

  const [assistants, viewer] = await Promise.all([listMyAssistantsAction(), currentHelpViewer()]);
  // Shown where this person's role can use AI apps here, on or off for
  // their company: switched off, How to connect says so and who to ask.
  const helpFeatures = helpFeaturesFor(session.profile.role, viewer);
  const assistantsVisible = helpFeatures.has("outside_assistants") || helpFeatures.has("ai_apps_off");

  return (
    <PageShell
      eyebrow="You"
      title="My profile"
      subtitle="Keep your name, position, and password up to date. Only you can edit this page."
    >
      <section className={styles.card} aria-labelledby="photo">
        <h2 id="photo" className={styles.h2}>
          Photo
        </h2>
        <p className={styles.subtitleInline}>
          Shown next to your name in the sidebar and on your profile.
          Drag and zoom to position; the visible circle is what saves.
        </p>
        <AvatarUpload
          currentUrl={session.profile.avatar_url}
          fullName={session.profile.full_name}
        />
      </section>

      <section className={styles.card} aria-labelledby="details">
        <h2 id="details" className={styles.h2}>
          Details
        </h2>
        <p className={styles.email}>Signed in as {session.email}</p>
        <p className={styles.subtitleInline}>
          To change the email you sign in with, ask an admin at your company.
        </p>
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

      {/* Connected assistants (Phase 4): shown where this person could
          use outside assistants, or when they already have one
          connected, so a connection is never hidden from the person
          who can revoke it. */}
      {assistantsVisible || assistants.length > 0 ? (
        <section className={styles.card} aria-labelledby="assistants">
          <h2 id="assistants" className={styles.h2}>
            Your connected AI apps
          </h2>
          <p className={styles.subtitleInline}>
            AI apps, such as Claude and ChatGPT, that you&apos;ve allowed to act as you in AiMS HQ.
            Disconnect one and it stops reaching AiMS at once.
          </p>
          <ConnectedAssistants initial={assistants} />
          {assistantsVisible ? (
            <div className={styles.assistantActions}>
              <HowToConnectButton />
            </div>
          ) : null}
        </section>
      ) : null}

      {/* What Aimee remembers, where the other things that are you
          already live. This replaced a sidebar entry of its own: a
          person checking what the product holds about them is doing
          something closer to reading their profile than opening a
          feature. */}
      <section className={styles.card} aria-labelledby="memory">
        <h2 id="memory" className={styles.h2}>
          Memory
        </h2>
        <p className={styles.subtitleInline}>
          What you tell Aimee stays between you and Aimee. No one else can read
          it. You can see everything Aimee remembers about you, and delete any
          of it, whenever you want.
        </p>
        <MemoryCard memories={memories} />
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
    </PageShell>
  );
}
