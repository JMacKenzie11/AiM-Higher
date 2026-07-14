import Link from "next/link";
import styles from "./boundary.module.css";

// Root 404. Friendly copy, single ghost link home.

export default function NotFound() {
  return (
    <main className={styles.stage}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>404</p>
        <h1 className={styles.h1}>That page isn&rsquo;t here.</h1>
        <span className={styles.rule} aria-hidden="true" />
        <p className={styles.body}>
          The link may be outdated, or the page has moved. Head home and
          try again from the nav.
        </p>
        <div className={styles.actions}>
          <Link href="/" className={styles.primaryButton}>
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
