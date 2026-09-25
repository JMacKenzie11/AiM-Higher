"use client";

import { useEffect, useState, type ReactNode } from "react";
import styles from "./analysis-tabs.module.css";

// THE THREE TABS, AND A LINK TO EACH.
//
// Each tab is a plain anchor, "#issues-and-commitments", so a link
// in an email, a notification or a message can open the page on a
// specific tab. The panels are rendered on the server; this only
// decides which one shows.
//
// The panel ids are NOT the hash. A panel whose id matched the hash
// would make the browser jump the page to it on every click, and on
// arrival, which reads as the page lurching. The hash names the tab;
// the panel is found through it.
//
// The pill style is the measures board's view toggle (BoardView),
// the same tokens, so this is the app's existing segmented control
// rather than a new one.

export type AnalysisTab = {
  hash: string;
  label: string;
  content: ReactNode;
};

export function AnalysisTabs({ tabs }: { tabs: AnalysisTab[] }) {
  const [active, setActive] = useState(tabs[0]?.hash ?? "");

  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      if (tabs.some((t) => t.hash === hash)) setActive(hash);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [tabs]);

  return (
    <div>
      <div className={styles.tabRow} role="tablist" aria-label="Meeting analysis">
        {tabs.map((t) => (
          <a
            key={t.hash}
            href={`#${t.hash}`}
            role="tab"
            id={`tab-${t.hash}`}
            aria-selected={t.hash === active}
            aria-controls={`panel-${t.hash}`}
            className={t.hash === active ? styles.tabActive : styles.tab}
            onClick={(e) => {
              // Same URL a pasted link produces, without the jump.
              e.preventDefault();
              window.history.replaceState(null, "", `#${t.hash}`);
              setActive(t.hash);
            }}
          >
            {t.label}
          </a>
        ))}
      </div>
      {tabs.map((t) => (
        <section
          key={t.hash}
          id={`panel-${t.hash}`}
          role="tabpanel"
          aria-labelledby={`tab-${t.hash}`}
          hidden={t.hash !== active}
          className={styles.panel}
        >
          {t.content}
        </section>
      ))}
    </div>
  );
}
