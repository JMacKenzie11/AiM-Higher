"use client";

import { prepareHref } from "@/lib/hq/derive";
import ui from "@/components/ui/ui.module.css";
import t from "./hq-tabs.module.css";

// Prepare on a Your companies row. A plain click stays on the page: it
// moves the address to ?company=<id>#coaching-calls and tells the tabs
// the hash changed, so Coaching calls opens on that company and
// CallsPanel scrolls to "Your next session" without reloading Coach HQ
// (Jason, 2026-11-17). A new tab or window keeps the link's own
// behaviour, which loads the same view.
export function PrepareButton({ companyId, companyName }: { companyId: string; companyName: string }) {
  const href = prepareHref(companyId);
  return (
    <a
      href={href}
      className={`${ui.btn} ${ui.btnSecondary}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        window.history.pushState(null, "", href);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }}
    >
      Prepare<span className={t.srOnly}> a session with {companyName}</span>
    </a>
  );
}
