"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

// The keyboard half of a menu button, shared by every menu that says
// role="menu" (ARIA APG menu button pattern).
//
// ---- WHY A HOOK AND NOT A COMPONENT ----------------------------
//
// The menus that use it differ in everything a component would have
// to own: a bell with a badge and a tray of links, a circle on a
// commitment row that is positioned absolutely and must stay the row's
// LAST child, a three-dot button with confirm dialogs beside it. Each
// keeps its own markup, styles and portal positioning. What they share
// is the behaviour, so that is what lives here:
//
//   - trigger: aria-haspopup, aria-expanded, aria-controls (while open)
//   - opening, by click, Enter or Space, focuses the first item;
//     ArrowDown on the trigger opens on the first, ArrowUp on the last
//   - inside: ArrowUp and ArrowDown move and wrap, Home and End jump
//   - Escape closes and puts focus back on the trigger
//   - Tab closes and carries on from the trigger, so the next stop is
//     the control after it rather than the page under a portalled menu
//   - a click outside both the trigger and the menu closes it
//   - an item that closes the menu by unmounting hands focus back to
//     the trigger instead of dropping it on <body>
//
// Items are the enabled [role="menuitem"] elements inside the menu, in
// DOM order, found when a key is pressed. Nothing has to register.
// Opening focuses the first of them, or the one marked
// data-menu-initial: the bell marks its first notification, so the
// "Mark all as read" above it is reachable but is not where Enter lands.

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])';

// Which item a key moves to, or null for a key the menu does not
// handle. Pure so the wrap rules are unit tested without a DOM.
// `current` is -1 when focus is not on an item.
export function menuFocusIndex(
  key: string,
  current: number,
  count: number
): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 || current >= count - 1 ? 0 : current + 1;
    case "ArrowUp":
      return current <= 0 ? count - 1 : current - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
}

export function useMenuButton<T extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpenState] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<T>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // State as well as a ref, so the focus-on-open effect reruns when the
  // menu mounts. The bell mounts its tray a render after `open` flips,
  // once it has measured where to put it.
  const [menuEl, setMenuEl] = useState<HTMLDivElement | null>(null);
  const focusOnOpen = useRef<"first" | "last" | null>(null);
  const returnFocus = useRef(true);

  const menuCallbackRef = useCallback((el: HTMLDivElement | null) => {
    menuRef.current = el;
    setMenuEl(el);
  }, []);

  const setOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setOpenState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      if (value && !prev && !focusOnOpen.current) focusOnOpen.current = "first";
      return value;
    });
  }, []);

  // Close without pulling focus back to the trigger. For a close that
  // is not the user's doing, such as the route changing under the bell.
  const closeQuietly = useCallback(() => {
    returnFocus.current = false;
    setOpenState(false);
  }, []);

  const toggle = useCallback(() => setOpen((prev) => !prev), [setOpen]);

  // Focus the first (or last) item once the menu is in the DOM.
  useEffect(() => {
    if (!open || !menuEl || !focusOnOpen.current) return;
    const items = menuItems(menuEl);
    const preferred = items.find((el) => el.hasAttribute("data-menu-initial"));
    const target =
      focusOnOpen.current === "last" ? items[items.length - 1] : (preferred ?? items[0]);
    focusOnOpen.current = null;
    target?.focus({ preventScroll: true });
  }, [open, menuEl]);

  // On close, if focus went down with the menu (an item unmounted under
  // it), put it back on the trigger. Focus somewhere real, such as the
  // next control after a Tab or a dialog an item opened, is left alone.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      // A closeQuietly() while already closed (the bell's on mount)
      // must not carry over into this opening.
      returnFocus.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    focusOnOpen.current = null;
    const restore = returnFocus.current;
    returnFocus.current = true;
    if (!restore) return;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  // Outside click and Escape. "Outside" is outside both the trigger and
  // the menu, because a portalled menu is not inside the trigger's
  // wrapper and a click on one of its own items would otherwise read
  // as outside and close it before the item's handler ran.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      // A click lands focus where it lands. Only a click on nothing
      // focusable, which leaves focus on <body>, brings it back.
      setOpenState(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      triggerRef.current?.focus({ preventScroll: true });
      setOpenState(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onTriggerKeyDown = useCallback(
    (e: ReactKeyboardEvent<T>) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      if (open) {
        const items = menuItems(menuRef.current);
        const target = e.key === "ArrowUp" ? items[items.length - 1] : items[0];
        target?.focus({ preventScroll: true });
        return;
      }
      focusOnOpen.current = e.key === "ArrowUp" ? "last" : "first";
      setOpenState(true);
    },
    [open]
  );

  const onMenuKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      // Focus the trigger and let the Tab go ahead: the browser moves
      // on from there, to the control after the trigger (or before it,
      // with Shift).
      returnFocus.current = false;
      triggerRef.current?.focus({ preventScroll: true });
      setOpenState(false);
      return;
    }
    const items = menuItems(menuRef.current);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = menuFocusIndex(e.key, current, items.length);
    if (next === null) return;
    e.preventDefault();
    items[next]?.focus({ preventScroll: true });
  }, []);

  return {
    open,
    setOpen,
    toggle,
    closeQuietly,
    triggerRef,
    menuRef,
    triggerProps: {
      ref: triggerRef,
      "aria-haspopup": "menu" as const,
      "aria-expanded": open,
      "aria-controls": open ? menuId : undefined,
      onKeyDown: onTriggerKeyDown,
    },
    menuProps: {
      ref: menuCallbackRef,
      id: menuId,
      role: "menu" as const,
      tabIndex: -1,
      onKeyDown: onMenuKeyDown,
    },
  };
}
