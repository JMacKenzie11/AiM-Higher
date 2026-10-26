"use client";

import { useSyncExternalStore } from "react";
import { isAiAppId, type AiAppId } from "@/lib/ai-apps/guide";
import { ConnectAiAppsDrawer } from "./ConnectAiAppsDrawer";
import styles from "./ConnectAiApps.module.css";

// Aimee's button to the How to connect drawer, with the app chosen
// (a fenced `connect_ai_app` block: {"app":"claude"}). She writes it
// only where the person can connect one (lib/ai-apps/aimee.ts).
//
// The open drawer is held outside the component: ChatView rebuilds its
// card renderers on every render, so a card is unmounted and mounted
// again whenever the thread redraws (SessionOfferCard has the same
// note), and state held here would close the drawer under the person.
let openApp: AiAppId | null = null;
const listeners = new Set<() => void>();
const setOpenApp = (app: AiAppId | null) => {
  openApp = app;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function parseConnectAiApp(raw: string): AiAppId | null {
  try {
    const v = JSON.parse(raw.trim()) as { app?: unknown };
    return isAiAppId(v?.app) ? v.app : null;
  } catch {
    return null;
  }
}

const NAMES: Record<AiAppId, string> = { claude: "Claude", chatgpt: "ChatGPT", grok: "Grok Bot" };

export function ConnectAiAppCard({ raw, streaming }: { raw: string; streaming: boolean }) {
  const app = parseConnectAiApp(raw);
  const open = useSyncExternalStore(subscribe, () => openApp, () => null);
  if (streaming || !app) return null;
  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => setOpenApp(app)}>
        How to connect {NAMES[app]}
      </button>
      <ConnectAiAppsDrawer open={open === app} onClose={() => setOpenApp(null)} initialApp={app} />
    </>
  );
}
