import { requireProfile } from "@/lib/auth/current-user";
import { listMyMemoriesAction } from "@/lib/coach/memory-actions";
import { PageShell } from "@/components/ui/PageShell";
import { MemoryList } from "./MemoryList";
import styles from "./memory.module.css";

// "What Aimee remembers" — the trust surface.
//
// EVERY USER, ABOUT THEMSELVES ONLY. There is no route parameter for
// whose memory to show and no role branch anywhere on this page:
// listMyMemoriesAction reads as the caller, and the SELECT policy on
// coach_memories admits `profile_id = auth.uid()` and nothing else.
// So the page cannot be pointed at another person — not by an admin,
// not by editing a URL, because there is no URL to edit. That is the
// same property the table was probed for, held one layer up.
//
// No export. No share. No admin view. Those are not omissions to fill
// in later: a page that could hand somebody's memory to a second
// person would undo the thing this page exists to demonstrate.
export const metadata = { title: "What Aimee remembers" };

export default async function CoachMemoryPage() {
  await requireProfile();
  const memories = await listMyMemoriesAction();

  return (
    <PageShell
      backHref="/ask-aimee"
      backLabel="Ask Aimee"
      eyebrow="Coaching"
      title="What Aimee remembers"
      subtitle="Everything she has noted from your conversations, newest first."
    >
      {/* The promise, in the same words as the help content. It sits
          at the top rather than the bottom because it is the reason
          the page exists, not a footnote to it. */}
      <div className={styles.promiseCard}>
        <p className={styles.promise}>
          What you tell Aimee stays between you and Aimee. No one else can
          read it. You can see everything Aimee remembers about you, and
          delete any of it, whenever you want.
        </p>
      </div>

      <MemoryList memories={memories} />
    </PageShell>
  );
}
