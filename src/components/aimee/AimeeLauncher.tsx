"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Drawer } from "@/components/ui/Drawer";
import { trackClient } from "@/lib/analytics/track-client";
import { recordPanelEventAction } from "@/lib/aimee/panel-actions";
import { AimeeIcon } from "./AimeeIcons";
import type { NotificationItem } from "@/lib/notifications/service";
import { useArriving } from "@/lib/notifications/use-arriving";
import styles from "./AimeeLauncher.module.css";

// AIMEE'S ICON AND PANEL, replacing the "?" help button in the same
// corner (docs/investigations/aimee-panel.md).
//
// A conversation with Aimee (AimeePanelChat): her last one started in
// the panel, or a new one, opening with a greeting and a few questions
// for the page. Everyone gets it, in place of the "?".
//
// NO "ABOUT THIS PAGE" (Jason, 2026-09-29). People do their interacting
// through Aimee; the page's help is what she answers from (search_help),
// not a document the panel shows them.
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

// ---- THE CONVERSATION IS FETCHED ON FIRST OPEN -------------------------
//
// This launcher is in the (app) layout, so what it imports is
// downloaded on every page. The conversation brings ChatView and the
// markdown renderer with it (about 62 kB compressed), and most page
// loads never open the panel. So it is its own file: fetched when the
// pointer or keyboard focus reaches the button (so it is usually there
// before the click), drawn from the first open on, and kept mounted
// after that exactly as before.
const loadPanelChat = () => import("./AimeePanelChat");
const AimeePanelChat = dynamic(() => loadPanelChat().then((m) => m.AimeePanelChat), {
  ssr: false,
});

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

// notifications: Aimee's own (invitations to debrief a meeting, and
// shared chats), split from the bell's by the layout
// (notifications/kinds.ts). Their count is the icon's badge.
//
// They may come as a promise: the layout sends the page before they are
// read, and the badge fills in when they land (use-arriving.ts).
const NO_NOTIFICATIONS: NotificationItem[] = [];

export function AimeeLauncher({
  notifications: notificationsSource = NO_NOTIFICATIONS,
}: {
  notifications?: NotificationItem[] | Promise<NotificationItem[]>;
}) {
  const notifications = useArriving(notificationsSource, NO_NOTIFICATIONS);
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  // True from the first open on. The conversation is not drawn before
  // that; after it, it stays mounted with the panel (keepMounted).
  const [everOpened, setEverOpened] = useState(false);
  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);
  const phone = usePhone();
  // The message box, where focus goes on a computer. Not on a phone:
  // focusing it there throws the keyboard up the moment the panel opens.
  const composer = useRef<HTMLTextAreaElement>(null);

  // Counted in the database for the weekly report (aimee:uptake), as
  // well as in analytics. Only that it opened.
  useEffect(() => {
    if (open) void recordPanelEventAction("opened").catch(() => {});
  }, [open]);

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
        (composer.current ?? document.querySelector<HTMLElement>('[data-testid="aimee-panel"]'))?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, pathname]);

  return (
    <>
      <button
        type="button"
        className={open && phone ? `${styles.launcher} ${styles.launcherHidden}` : styles.launcher}
        data-testid="corner-launcher"
        aria-label={
          open
            ? "Close Aimee"
            : notifications.length > 0
              ? `Aimee, ${notifications.length} waiting for you`
              : "Aimee"
        }
        aria-expanded={open}
        aria-controls="aimee-panel"
        title="Aimee (Ctrl+.)"
        onPointerEnter={() => void loadPanelChat()}
        onFocus={() => void loadPanelChat()}
        onClick={() => {
          setOpen((prev) => {
            const next = !prev;
            if (next) trackClient("aimee.panel_opened", { pathname, via: "button" });
            return next;
          });
        }}
      >
        <AimeeIcon />
        {notifications.length > 0 ? (
          <span className={styles.badge} aria-hidden="true" data-testid="aimee-badge">
            {notifications.length}
          </span>
        ) : null}
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
        initialFocusRef={phone ? undefined : composer}
        fill
      >
        <div id="aimee-panel" className={styles.body}>
          {open || everOpened ? (
            <AimeePanelChat active={open} notifications={notifications} composerRef={composer} focusOnLoad={!phone} />
          ) : null}
        </div>
      </Drawer>
    </>
  );
}
