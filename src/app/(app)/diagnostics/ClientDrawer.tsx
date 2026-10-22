"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Drawer } from "@/components/ui/Drawer";
import { saveClientAction, type ClientInput } from "@/lib/diagnostics/actions";
import { CLIENT_SOURCES, type ClientRow } from "@/lib/diagnostics/types";
import { useDxAction } from "./useDxAction";
import admin from "../admin/companies/admin.module.css";
import styles from "./diagnostics.module.css";

// Add a client, or edit one: the diagnostic_clients fields in the
// house drawer. Unmounts on close, so every open seeds from props.

function seed(c: ClientRow | null): ClientInput {
  return {
    name: c?.name ?? "",
    owner_name: c?.owner_name ?? "",
    owner_email: c?.owner_email ?? "",
    industry: c?.industry ?? "",
    employee_count: c?.employee_count ?? "",
    city: c?.city ?? "",
    country: c?.country ?? "",
    source: c?.source ?? "",
    notes: c?.notes ?? "",
  };
}

export function ClientButton({ client, label }: { client: ClientRow | null; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? <ClientDrawer client={client} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ClientDrawer({ client, onClose }: { client: ClientRow | null; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState<ClientInput>(() => seed(client));
  const { pending, error, run } = useDxAction();
  const set = (k: keyof ClientInput) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function save() {
    run(
      () => saveClientAction(client?.id ?? null, form),
      (r) => {
        onClose();
        if (!client && r.id) router.push(`/diagnostics/clients/${r.id}`);
      }
    );
  }

  const field = (k: keyof ClientInput, label: string, props: Record<string, unknown> = {}) => (
    <div className={admin.field}>
      <label className={admin.label} htmlFor={`client-${k}`}>
        {label}
      </label>
      <input id={`client-${k}`} className={admin.input} value={String(form[k] ?? "")} onChange={set(k)} {...props} />
    </div>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      name="diagnostic-client"
      eyebrow={client ? "Edit client" : "Add a client"}
      title={client?.name ?? "New client"}
      footer={
        <>
          <button type="button" className={styles.primary} onClick={save} disabled={pending}>
            Save
          </button>
          <button type="button" className={styles.secondary} onClick={onClose} disabled={pending}>
            Cancel
          </button>
          {error ? <span className={styles.error} role="alert">{error}</span> : null}
        </>
      }
    >
      <div className={styles.body}>
        {field("name", "Business name", { maxLength: 200, autoFocus: true })}
        {field("owner_name", "Owner", { maxLength: 200 })}
        {field("owner_email", "Owner email", { type: "email", maxLength: 320 })}
        {field("industry", "Industry", { maxLength: 200 })}
        {field("employee_count", "Employees", { inputMode: "numeric" })}
        {field("city", "City", { maxLength: 200 })}
        <div className={admin.field}>
          <label className={admin.label} htmlFor="client-country">
            Country
          </label>
          <select id="client-country" className={admin.select} value={form.country} onChange={set("country")}>
            <option value="">Not set</option>
            <option value="CA">Canada</option>
            <option value="US">United States</option>
          </select>
        </div>
        <div className={admin.field}>
          <label className={admin.label} htmlFor="client-source">
            How they came
          </label>
          <select id="client-source" className={admin.select} value={form.source} onChange={set("source")}>
            <option value="">Not set</option>
            {CLIENT_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className={admin.field}>
          <label className={admin.label} htmlFor="client-notes">
            Notes
          </label>
          <textarea id="client-notes" className={styles.textarea} value={form.notes} onChange={set("notes")} maxLength={8000} />
        </div>
      </div>
    </Drawer>
  );
}
