"use client";

import { useState } from "react";
import { HubSpotKeyForm } from "./HubSpotKeyForm";
import styles from "../admin.module.css";

// Replace the HubSpot key, behind a button so a connected HubSpot is
// one short row until someone needs to change it.
export function ReplaceHubSpotKey({ companyId }: { companyId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className={styles.ghostButton} onClick={() => setOpen(true)}>
        Replace key
      </button>
    );
  }
  return (
    <div style={{ flexBasis: "100%" }}>
      <HubSpotKeyForm companyId={companyId} replacing />
    </div>
  );
}
