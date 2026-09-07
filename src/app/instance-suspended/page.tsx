import type { Metadata } from "next";
import styles from "../boundary.module.css";

// Shown when a hostname resolves to an instance whose registry status
// is not "active".
//
// Same shape and the same constraints as /instance-not-found: outside
// every route group, no nav, no auth, no session. Middleware rewrites
// here before Supabase is touched, so nothing on this page may read a
// database — the whole point of a suspension is that the instance's
// data is not being served.
//
// The wording is deliberately neutral. A suspension can mean an
// unpaid invoice, a migration being worked through, or an instance
// being torn down, and the person reading this is usually an end user
// who has no idea which. Naming a reason here would be wrong most of
// the time; naming a person to contact is right every time.
//
// See the status contract in src/lib/instances/types.ts.

export const metadata: Metadata = {
  title: "This instance is unavailable",
  robots: { index: false, follow: false },
};

export default function InstanceSuspendedPage() {
  return (
    <main className={styles.stage}>
      <div className={styles.card}>
        <h1 className={styles.h1} data-testid="instance-suspended">
          This AiMS Higher instance is temporarily unavailable
        </h1>
        <span className={styles.rule} aria-hidden="true" />
        <p className={styles.body}>
          Access has been paused. Nothing has been lost: your data is intact and
          service resumes as soon as the pause is lifted. Your administrator or
          your AiMS Higher contact can tell you where things stand.
        </p>
      </div>
    </main>
  );
}
