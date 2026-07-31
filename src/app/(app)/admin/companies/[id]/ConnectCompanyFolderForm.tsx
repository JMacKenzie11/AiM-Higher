"use client";

import { useState, useTransition } from "react";
import { connectGoogleFolderAction } from "@/lib/transcripts/actions";
import styles from "../admin.module.css";

// Simpler than the platform-wide ConnectFolderForm: scope is
// always "company" and companyId is fixed by the surrounding page.
// The user only supplies the Drive folder URL.

export function ConnectCompanyFolderForm({ companyId }: { companyId: string }) {
  const [folderUrl, setFolderUrl] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    setOk(false);
    const fd = new FormData();
    fd.set("scope", "company");
    fd.set("company_id", companyId);
    fd.set("folder_url", folderUrl);
    startTransition(async () => {
      const res = await connectGoogleFolderAction(fd);
      if (!res.ok) {
        setMessage(res.message);
      } else {
        setFolderUrl("");
        setOk(true);
        setMessage("Connected. Watching this folder now.");
      }
    });
  }

  return (
    <form onSubmit={submit} className={styles.form}>
      <div className={`${styles.field} ${styles.formFull ?? ""}`}>
        <label htmlFor="folder-url" className={styles.label}>
          Add a Google Drive folder
        </label>
        <input
          id="folder-url"
          type="text"
          className={styles.input}
          value={folderUrl}
          onChange={(e) => setFolderUrl(e.target.value)}
          placeholder="https://drive.google.com/drive/folders/…"
          disabled={pending}
          required
        />
      </div>

      {message ? (
        <p
          role={ok ? "status" : "alert"}
          className={ok ? styles.successMessage : styles.errorMessage}
        >
          {message}
        </p>
      ) : null}

      <div className={styles.submitRow}>
        <button type="submit" className={styles.primaryButton} disabled={pending}>
          {pending ? "Connecting…" : "Connect folder"}
        </button>
      </div>
    </form>
  );
}
