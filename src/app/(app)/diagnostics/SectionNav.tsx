import Link from "next/link";
import styles from "./diagnostics.module.css";

// Diagnostics, Across clients, Clients and Bots (0308), as tabs at the
// top of each list page's content, never in the hero (Jason,
// 2026-10-29: Company settings' tabs). The module is on no menu
// (reached by its address), so this is how they find each other.
export function SectionNav({ current }: { current: "diagnostics" | "across" | "clients" | "bots" }) {
  return (
    <nav className={styles.tabRow} aria-label="Capacity Diagnostic">
      <Link href="/diagnostics" className={current === "diagnostics" ? styles.tabActive : styles.tab} aria-current={current === "diagnostics" ? "page" : undefined}>
        Diagnostics
      </Link>
      <Link href="/diagnostics?view=across" className={current === "across" ? styles.tabActive : styles.tab} aria-current={current === "across" ? "page" : undefined}>
        Across clients
      </Link>
      <Link href="/diagnostics/clients" className={current === "clients" ? styles.tabActive : styles.tab} aria-current={current === "clients" ? "page" : undefined}>
        Clients
      </Link>
      <Link href="/diagnostics/bots" className={current === "bots" ? styles.tabActive : styles.tab} aria-current={current === "bots" ? "page" : undefined}>
        Bots
      </Link>
    </nav>
  );
}
