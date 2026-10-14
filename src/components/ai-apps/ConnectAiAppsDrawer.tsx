"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Drawer } from "@/components/ui/Drawer";
import { aiAppsGuideAction } from "@/lib/ai-apps/actions";
import type { AiAppId, AiAppsGuide } from "@/lib/ai-apps/guide";
import styles from "./ConnectAiApps.module.css";

// HOW TO CONNECT (Jason, 2026-10-14). Opened from the company's
// Connect AI apps card, the profile's connected AI apps, and Aimee's
// button. Every word comes from docs/help/ai-apps.md through
// aiAppsGuideAction; nothing here is a second copy of the steps.
export function ConnectAiAppsDrawer({
  open,
  onClose,
  initialApp,
}: {
  open: boolean;
  onClose: () => void;
  initialApp?: AiAppId;
}) {
  const [guide, setGuide] = useState<AiAppsGuide | null>(null);
  const [failed, setFailed] = useState(false);
  const [app, setApp] = useState<AiAppId>(initialApp ?? "claude");

  useEffect(() => {
    if (initialApp) setApp(initialApp);
  }, [initialApp, open]);

  useEffect(() => {
    if (!open || guide) return;
    let live = true;
    aiAppsGuideAction()
      .then((g) => live && setGuide(g))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [open, guide]);

  const chosen = guide?.state === "on" ? guide.apps.find((a) => a.id === app) ?? guide.apps[0] : null;

  return (
    <Drawer open={open} onClose={onClose} eyebrow="AI apps" title="How to connect" name="connect-ai-apps">
      {failed ? (
        <p className={styles.note}>The steps couldn&apos;t be loaded. Close this and try again.</p>
      ) : !guide ? (
        <p className={styles.note}>Loading…</p>
      ) : guide.state === "closed" ? (
        <p className={styles.note}>AI apps aren&apos;t available for your account.</p>
      ) : (
        <div className={styles.body}>
          {guide.intro ? <Markdown text={guide.intro} /> : null}
          {guide.state === "off" ? (
            <div className={styles.off} role="status">
              <Markdown text={guide.off} />
            </div>
          ) : (
            <>
              <label className={styles.pick}>
                <span className={styles.pickLabel}>App</span>
                <select
                  className={styles.select}
                  value={chosen?.id}
                  onChange={(e) => setApp(e.target.value as AiAppId)}
                >
                  {guide.apps.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              {chosen ? <Markdown key={chosen.id} text={chosen.markdown} /> : null}
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

// The article's markdown. An inline code span holding a web address is
// the server address: it gets a Copy button beside it.
function Markdown({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: ({ children }) => {
            const value = String(children);
            return /^https?:\/\/\S+$/.test(value) ? <CopyAddress value={value} /> : <code>{children}</code>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function CopyAddress({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className={styles.address}>
      <code className={styles.addressText}>{value}</code>
      <button
        type="button"
        className={styles.copy}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

// The button that opens it, for a card or a profile section.
export function HowToConnectButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className ?? styles.trigger} onClick={() => setOpen(true)}>
        How to connect
      </button>
      <ConnectAiAppsDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
