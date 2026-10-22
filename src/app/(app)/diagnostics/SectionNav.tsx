import Link from "next/link";
import styles from "./diagnostics.module.css";

// Diagnostics and Clients, in the hero of both list pages. The module
// is on no menu (reached by its address), so this is how the two find
// each other.
export function SectionNav({ current }: { current: "diagnostics" | "clients" }) {
  return (
    <nav className={styles.steps} aria-label="Capacity Diagnostic">
      <Link href="/diagnostics" className={styles.step} aria-current={current === "diagnostics" ? "page" : undefined} data-done="true">
        Diagnostics
      </Link>
      <Link href="/diagnostics/clients" className={styles.step} aria-current={current === "clients" ? "page" : undefined} data-done="true">
        Clients
      </Link>
    </nav>
  );
}
