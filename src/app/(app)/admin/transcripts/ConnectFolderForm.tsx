"use client";

import { useState, useTransition } from "react";
import { connectGoogleFolderAction } from "@/lib/transcripts/actions";
import type { Company } from "@/lib/types";
import styles from "../companies/admin.module.css";

export function ConnectFolderForm({
  companies,
}: {
  companies: Pick<Company, "id" | "name">[];
}) {
  const [scope, setScope] = useState<"company" | "shared">("company");
  const [companyId, setCompanyId] = useState<string>(companies[0]?.id ?? "");
  const [folderUrl, setFolderUrl] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    const fd = new FormData();
    fd.set("scope", scope);
    fd.set("company_id", companyId);
    fd.set("folder_url", folderUrl);
    startTransition(async () => {
      const res = await connectGoogleFolderAction(fd);
      if (!res.ok) {
        setMessage(res.message);
      } else {
        setFolderUrl("");
        setMessage("Connected. Watching this folder now.");
      }
    });
  }

  return (
    <form onSubmit={submit} className={styles.form}>
      <div className={styles.field}>
        <label className={styles.label}>This folder serves</label>
        <div style={{ display: "flex", gap: "var(--space-3)" }}>
          <label className={styles.checkOption}>
            <input
              type="radio"
              name="scope"
              value="company"
              checked={scope === "company"}
              onChange={() => setScope("company")}
              disabled={pending}
            />
            One company
          </label>
          <label className={styles.checkOption}>
            <input
              type="radio"
              name="scope"
              value="shared"
              checked={scope === "shared"}
              onChange={() => setScope("shared")}
              disabled={pending}
            />
            Multiple companies (routed by file name)
          </label>
        </div>
      </div>

      {scope === "company" ? (
        <div className={styles.field}>
          <label htmlFor="company-id" className={styles.label}>
            Company
          </label>
          <select
            id="company-id"
            className={styles.select}
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            disabled={pending}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className={`${styles.field} ${styles.formFull ?? ""}`}>
        <label htmlFor="folder-url" className={styles.label}>
          Folder link or ID
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
          role={message.startsWith("Connected") ? "status" : "alert"}
          className={
            message.startsWith("Connected")
              ? styles.successMessage
              : styles.errorMessage
          }
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
