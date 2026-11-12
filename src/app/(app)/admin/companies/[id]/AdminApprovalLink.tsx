"use client";

import { useState } from "react";
import styles from "../admin.module.css";

// The link a client's Microsoft 365 admin opens to approve AiMS HQ
// for their organisation, once. Shown with a Copy button because the
// person connecting is usually not that admin and has to send it on.

export function AdminApprovalLink({ href }: { href: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.rowActions} style={{ flexWrap: "wrap" }}>
      <button
        type="button"
        className={styles.ghostButton}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(href);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy the admin's link"}
      </button>
      <a href={href} className={styles.ghostButton} target="_blank" rel="noreferrer">
        I&rsquo;m the admin: approve now
      </a>
    </div>
  );
}
