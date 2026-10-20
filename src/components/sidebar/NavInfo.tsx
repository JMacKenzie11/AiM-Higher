"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";
import type { Role } from "@/lib/types";
import { simplifyOn } from "@/lib/ui/simplify";
import { activeTab, sectionForPath, visibleTabs } from "./sections";
import styles from "./SectionTabs.module.css";

// Who is looking and which modules their company has, for the section
// tabs (simplification review, change 4). The layout already knows
// both for the sidebar; this hands the same two values to the pages,
// so a page header can show its section's tabs without each page
// loading them again.
type NavInfo = { role: Role; features: readonly string[] };

const NavInfoContext = createContext<NavInfo | null>(null);

export function NavInfoProvider({ role, features, children }: NavInfo & { children: ReactNode }) {
  return <NavInfoContext.Provider value={{ role, features }}>{children}</NavInfoContext.Provider>;
}

// The pages of the section this page is in, as tabs, under the
// "nav-sections" switch. Nothing for a page in no section, or in a
// section with one page for this person.
export function SectionTabs() {
  const info = useContext(NavInfoContext);
  const pathname = usePathname() ?? "";
  if (!simplifyOn("nav-sections") || !info) return null;
  const section = sectionForPath(pathname);
  if (!section) return null;
  const tabs = visibleTabs(section, info.role, info.features);
  if (tabs.length < 2) return null;
  const current = activeTab(pathname, tabs);
  return (
    <nav className={styles.tabs} aria-label={`${section.label} pages`}>
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={styles.tab}
          aria-current={current?.href === t.href ? "page" : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
