import type { Metadata } from "next";
import styles from "../boundary.module.css";

// Shown when a hostname resolves to no instance.
//
// Deliberately outside every route group: it renders on hostnames
// that map to no database at all, so it cannot sit under a layout
// that reads one. No nav, no auth, no links back into the app —
// there is no app here to link to. Middleware rewrites to this path
// before touching Supabase, so nothing on this page can depend on a
// session.
//
// It reuses the boundary styles the root 404 and error pages use, so
// an unknown hostname still lands somewhere that looks like the
// product rather than a bare stack of text.

export const metadata: Metadata = {
  title: "No instance at this address",
  // Nothing here should be indexed: every one of these URLs is a
  // hostname that isn't a customer.
  robots: { index: false, follow: false },
};

export default function InstanceNotFoundPage() {
  return (
    <main className={styles.stage}>
      <div className={styles.card}>
        <h1 className={styles.h1} data-testid="instance-not-found">
          There&rsquo;s no AiMS Higher instance at this address
        </h1>
        <span className={styles.rule} aria-hidden="true" />
        <p className={styles.body}>
          Check the address you typed. If it came from a link or an invitation,
          the person who sent it can confirm the right one.
        </p>
      </div>
    </main>
  );
}
