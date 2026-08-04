"use client";

import Link from "next/link";
import { useState } from "react";
import { demoUrl } from "./demo-url";
import styles from "./marketing.module.css";

// Mobile disclosure for the marketing nav. Renders a hamburger below
// the tablet breakpoint (the desktop nav is display:none there via
// CSS) and expands a drawer with the anchor links + CTAs when open.

export function MobileNavToggle({
  links,
}: {
  links: Array<{ label: string; href: string }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={styles.mobileToggle}
        aria-controls="marketing-mobile-drawer"
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">{open ? "×" : "☰"}</span>
      </button>
      {open ? (
        <div
          id="marketing-mobile-drawer"
          className={styles.mobileDrawer}
          role="navigation"
          aria-label="Primary mobile"
        >
          <ul className={styles.mobileList}>
            {links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className={styles.mobileLink}
                  onClick={() => setOpen(false)}
                >
                  {l.label}
                </a>
              </li>
            ))}
            <li>
              <Link
                href="/sign-in"
                className={styles.mobileLink}
                onClick={() => setOpen(false)}
              >
                Sign in
              </Link>
            </li>
            <li>
              <a
                href={demoUrl()}
                className={styles.mobileDemoCta}
                onClick={() => setOpen(false)}
              >
                Book a demo
              </a>
            </li>
          </ul>
        </div>
      ) : null}
    </>
  );
}
