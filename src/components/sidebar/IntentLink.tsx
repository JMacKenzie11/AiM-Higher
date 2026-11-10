"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

// A LINK THAT IS FETCHED AHEAD ONLY WHEN SOMEONE IS HEADING FOR IT
// (2026-11-10 performance audit).
//
// A plain <Link> is fetched ahead as soon as it is on screen. The
// sidebar is on every page with about eighteen of them, so every page
// load set off about eighteen more requests, each through middleware
// (a call to the auth server and a profiles read) to prepare pages
// most of which were never opened.
//
// This one waits for a sign of intent: the pointer over it, keyboard
// focus on it, or a finger down on it. From then on it is an ordinary
// <Link> and Next fetches it ahead exactly as before, so the page's
// loading screen is usually ready by the time the click lands. This is
// the pattern in Next's own guide to prefetching.
//
// Nothing about where a link goes or what a click does changes. A
// request fetched ahead never changes anything on the server either
// (see lib/admin/scope-request.ts for why that is a rule here).
export function IntentLink(props: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const [intent, setIntent] = useState(false);
  const { onPointerEnter, onFocus, onTouchStart, ...rest } = props;
  return (
    <Link
      {...rest}
      prefetch={intent ? null : false}
      onPointerEnter={(e) => {
        setIntent(true);
        onPointerEnter?.(e);
      }}
      onFocus={(e) => {
        setIntent(true);
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        setIntent(true);
        onTouchStart?.(e);
      }}
    />
  );
}
