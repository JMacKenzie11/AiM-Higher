"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Drawer } from "@/components/ui/Drawer";
import { usePageHelp } from "@/components/help/usePageHelp";
import { trackClient } from "@/lib/analytics/track-client";
import { AimeeIcon } from "./AimeeIcons";
import styles from "./AimeeLauncher.module.css";

// AIMEE'S ICON AND PANEL, replacing the "?" help button in the same
// corner (docs/investigations/aimee-panel.md).
//
// Step 1: the panel shows "About this page" (the same role-filtered
// help the "?" shows) and a way into Ask Aimee. The conversation moves
// into the panel in Step 3. Until both are merged the app layout shows
// this to system admins only; everyone else keeps the "?".
//
// ---- A PANEL THAT DOES NOT BLOCK THE PAGE ----------------------------
//
// Desktop: the house Drawer's `side` mode. A labelled complementary
// region, no scrim, no aria-modal, no focus trap. It floats over the
// page's right-hand edge (Jason, 2026-09-29) and the page keeps its
// width, so everything not under it stays usable. Opening moves focus into the panel, Escape closes it
// and returns focus to the button.
//
// Phone (768px and under, the sidebar's breakpoint): the panel covers
// the screen, so it is a dialog, with focus kept inside until closed.
//
// ---- THE SHORTCUT: Ctrl+. ----------------------------------------------
//
// Opens the panel, or brings focus back into it when it is open. Ctrl,
// not Cmd, on a Mac as well: Cmd+. is Stop in Safari and Firefox on a
// Mac, while Ctrl+. is bound by none of Chrome, Edge, Firefox or Safari
// on Mac or Windows, types no character on either, and is not an
// accessibility shortcut (VoiceOver uses Ctrl+Option, NVDA and JAWS use
// Insert or Caps Lock). Alt+A, the first proposal, types "å" on a Mac.
// The e2e spec checks the keypress reaches the page in Chromium,
// Firefox and WebKit.

const PHONE = "(max-width: 768px)";

function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return phone;
}

export function isAimeeShortcut(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "key">): boolean {
  return e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key === ".";
}

export function AimeeLauncher() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const phone = usePhone();
  const firstFocus = useRef<HTMLHeadingElement>(null);
  const help = usePageHelp(pathname, open);

  // Says the panel is open, on desktop: the corner button steps to the
  // panel's edge, and other drawers open beside it rather than under it.
  useEffect(() => {
    const root = document.documentElement;
    if (open && !phone) root.dataset.aimeePanel = "open";
    else delete root.dataset.aimeePanel;
    return () => {
      delete root.dataset.aimeePanel;
    };
  }, [open, phone]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!isAimeeShortcut(e)) return;
      e.preventDefault();
      if (!open) {
        setOpen(true);
        trackClient("aimee.panel_opened", { pathname, via: "shortcut" });
      } else {
        firstFocus.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, pathname]);

  return (
    <>
      <button
        type="button"
        className={styles.launcher}
        data-testid="corner-launcher"
        aria-label={open ? "Close Aimee" : "Aimee"}
        aria-expanded={open}
        aria-controls="aimee-panel"
        title="Aimee (Ctrl+.)"
        onClick={() => {
          setOpen((prev) => {
            const next = !prev;
            if (next) trackClient("aimee.panel_opened", { pathname, via: "button" });
            return next;
          });
        }}
      >
        <AimeeIcon />
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Ask Aimee"
        side={!phone}
        trapFocus={phone}
        keepMounted
        name="aimee-panel"
        testId="aimee-panel"
        initialFocusRef={firstFocus}
      >
        <div id="aimee-panel" className={styles.body}>
          <section aria-labelledby="aimee-about-this-page">
            <h3 id="aimee-about-this-page" ref={firstFocus} tabIndex={-1} className={styles.sectionTitle}>
              About this page
            </h3>
            {help.kind === "loading" ? (
              <p className={styles.muted}>Loading…</p>
            ) : help.kind === "empty" ? (
              <p className={styles.muted}>There is no help for this page yet.</p>
            ) : help.kind === "error" ? (
              <p className={styles.muted}>The help for this page could not be loaded.</p>
            ) : help.kind === "loaded" ? (
              <div className={styles.prose}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{help.markdown}</ReactMarkdown>
              </div>
            ) : null}
          </section>
          <section className={styles.ask} aria-label="Ask Aimee">
            <p className={styles.muted}>Want to talk something through, or ask how to do something here?</p>
            <Link href="/ask-aimee/new" className={styles.askLink} onClick={() => setOpen(false)}>
              Ask Aimee
            </Link>
          </section>
        </div>
      </Drawer>
    </>
  );
}
