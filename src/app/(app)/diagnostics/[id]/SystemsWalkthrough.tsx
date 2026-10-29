"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { deleteLinkAction, deleteSystemAction, saveLinkAction, saveSystemAction, type LinkInput, type SystemInput } from "@/lib/diagnostics/actions";
import { LINK_HOWS, SYSTEM_KINDS, linkHowLabel, systemKindLabel, type SystemLinkRow, type SystemRow } from "@/lib/diagnostics/types";
import { useDxAction } from "../useDxAction";
import admin from "../../admin/companies/admin.module.css";
import styles from "../diagnostics.module.css";

// THE SYSTEMS WALKTHROUGH (phase 4), on Pre-flight: a 30-minute
// conversation with the client's IT or admin contact, entered as the
// systems the people in scope work in and the ways information moves
// between them. The four questions sit above the lists, read as
// written; question 4's answer is each link's notes. On the guided
// screens (part) the systems and the links are a screen each, with
// their own two questions.

export const WALKTHROUGH_QUESTIONS = [
  "What are the main systems the people in scope work in every week?",
  "What information lives in each one, and who looks after it?",
  "When information needs to get from one system to another, how does it get there: typed in again, exported and imported, or connected automatically?",
  "Which of those moves breaks or gets missed most often?",
] as const;

export function SystemsWalkthrough({
  diagnosticId,
  systems,
  links,
  part = "all",
}: {
  diagnosticId: string;
  systems: SystemRow[];
  links: SystemLinkRow[];
  part?: "all" | "systems" | "links";
}) {
  const [system, setSystem] = useState<SystemRow | "new" | null>(null);
  const [link, setLink] = useState<SystemLinkRow | "new" | null>(null);
  const name = (id: string) => systems.find((s) => s.id === id)?.name ?? "Unknown system";

  return (
    <div className={styles.body}>
      {part === "all" ? (
        <div>
          <h3 className={styles.cardTitle}>Systems walkthrough</h3>
          <p className={styles.status}>Thirty minutes with the IT or admin contact.</p>
          <ol className={styles.guide}>
            {WALKTHROUGH_QUESTIONS.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </div>
      ) : (
        <p className={styles.askBox}>
          Ask: <em>{(part === "systems" ? WALKTHROUGH_QUESTIONS.slice(0, 2) : WALKTHROUGH_QUESTIONS.slice(2)).join(" ")}</em>
        </p>
      )}

      {part === "links" ? null : (
      <div>
        <div className={styles.cardHeader}>
          <h4 className={styles.cardTitle}>Systems</h4>
          <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setSystem("new")}>
            Add a system
          </button>
        </div>
        {systems.length === 0 ? (
          <p className={styles.empty}>No systems yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>System</th>
                  <th>Kind</th>
                  <th>What lives there</th>
                  <th>Looked after by</th>
                  <th aria-label="Edit" />
                </tr>
              </thead>
              <tbody>
                {systems.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{systemKindLabel(s.kind)}</td>
                    <td>{s.holds ?? ""}</td>
                    <td>{s.owner_name ?? ""}</td>
                    <td>
                      <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setSystem(s)} aria-label={`Edit ${s.name}`}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {part === "systems" ? null : (
      <div>
        <div className={styles.cardHeader}>
          <h4 className={styles.cardTitle}>How information moves</h4>
          <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setLink("new")} disabled={systems.length < 2}>
            Add a link
          </button>
        </div>
        {links.length === 0 ? (
          <p className={styles.empty}>{systems.length < 2 ? "Add two systems first." : "No links yet."}</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th>What moves</th>
                  <th>How</th>
                  <th>What breaks or gets missed</th>
                  <th aria-label="Edit" />
                </tr>
              </thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.id}>
                    <td>{name(l.from_system_id)}</td>
                    <td>{name(l.to_system_id)}</td>
                    <td>{l.what_moves}</td>
                    <td>{linkHowLabel(l.how)}</td>
                    <td>{l.notes ?? ""}</td>
                    <td>
                      <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setLink(l)} aria-label={`Edit ${l.what_moves}`}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {system ? <SystemDrawer diagnosticId={diagnosticId} system={system === "new" ? null : system} onClose={() => setSystem(null)} /> : null}
      {link ? <LinkDrawer diagnosticId={diagnosticId} link={link === "new" ? null : link} systems={systems} onClose={() => setLink(null)} /> : null}
    </div>
  );
}

function DrawerFooter({ pending, error, onSave, onClose, onDelete, deleteLabel }: { pending: boolean; error: string | null; onSave: () => void; onClose: () => void; onDelete?: () => void; deleteLabel: string }) {
  return (
    <>
      <button type="button" className={styles.primary} onClick={onSave} disabled={pending}>
        Save
      </button>
      <button type="button" className={styles.secondary} onClick={onClose} disabled={pending}>
        Cancel
      </button>
      {onDelete ? (
        <button type="button" className={styles.secondary} onClick={onDelete} disabled={pending}>
          {deleteLabel}
        </button>
      ) : null}
      {error ? <span className={styles.error} role="alert">{error}</span> : null}
    </>
  );
}

function SystemDrawer({ diagnosticId, system, onClose }: { diagnosticId: string; system: SystemRow | null; onClose: () => void }) {
  const [f, setF] = useState<SystemInput>({
    name: system?.name ?? "",
    kind: system?.kind ?? "other",
    holds: system?.holds ?? "",
    owner_name: system?.owner_name ?? "",
    notes: system?.notes ?? "",
  });
  const { pending, error, run } = useDxAction();
  const set = (k: keyof SystemInput) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Drawer
      open
      onClose={onClose}
      name="diagnostic-system"
      eyebrow={system ? "Edit system" : "Add a system"}
      title={system?.name ?? "New system"}
      footer={
        <DrawerFooter
          pending={pending}
          error={error}
          onSave={() => run(() => saveSystemAction(diagnosticId, system?.id ?? null, f), onClose)}
          onClose={onClose}
          onDelete={system ? () => run(() => deleteSystemAction(system.id), onClose) : undefined}
          deleteLabel="Delete system"
        />
      }
    >
      <div className={styles.body}>
        <div className={admin.field}>
          <label className={admin.label} htmlFor="system-name">
            System name
          </label>
          <input id="system-name" className={admin.input} value={f.name} onChange={set("name")} maxLength={200} autoFocus />
        </div>
        <div className={admin.field}>
          <label className={admin.label} htmlFor="system-kind">
            Kind
          </label>
          <select id="system-kind" className={admin.select} value={f.kind} onChange={set("kind")}>
            {SYSTEM_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className={admin.field}>
          <label className={admin.label} htmlFor="system-holds">
            What information lives there
          </label>
          <textarea id="system-holds" className={styles.textarea} value={f.holds} onChange={set("holds")} maxLength={2000} />
        </div>
        <div className={admin.field}>
          <label className={admin.label} htmlFor="system-owner">
            Who looks after it
          </label>
          <input id="system-owner" className={admin.input} value={f.owner_name} onChange={set("owner_name")} maxLength={200} />
        </div>
        <div className={admin.field}>
          <label className={admin.label} htmlFor="system-notes">
            Notes
          </label>
          <textarea id="system-notes" className={styles.textarea} value={f.notes} onChange={set("notes")} maxLength={4000} />
        </div>
      </div>
    </Drawer>
  );
}

function LinkDrawer({ diagnosticId, link, systems, onClose }: { diagnosticId: string; link: SystemLinkRow | null; systems: SystemRow[]; onClose: () => void }) {
  const [f, setF] = useState<LinkInput>({
    from_system_id: link?.from_system_id ?? "",
    to_system_id: link?.to_system_id ?? "",
    what_moves: link?.what_moves ?? "",
    how: link?.how ?? "unknown",
    notes: link?.notes ?? "",
  });
  const { pending, error, run } = useDxAction();
  const set = (k: keyof LinkInput) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const picker = (k: "from_system_id" | "to_system_id", label: string) => (
    <div className={admin.field}>
      <label className={admin.label} htmlFor={`link-${k}`}>
        {label}
      </label>
      <select id={`link-${k}`} className={admin.select} value={f[k]} onChange={set(k)}>
        <option value="">Choose a system</option>
        {systems.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
  return (
    <Drawer
      open
      onClose={onClose}
      name="diagnostic-link"
      eyebrow={link ? "Edit link" : "Add a link"}
      title={link?.what_moves ?? "New link"}
      footer={
        <DrawerFooter
          pending={pending}
          error={error}
          onSave={() => run(() => saveLinkAction(diagnosticId, link?.id ?? null, f), onClose)}
          onClose={onClose}
          onDelete={link ? () => run(() => deleteLinkAction(link.id), onClose) : undefined}
          deleteLabel="Delete link"
        />
      }
    >
      <div className={styles.body}>
        {picker("from_system_id", "From")}
        {picker("to_system_id", "To")}
        <div className={admin.field}>
          <label className={admin.label} htmlFor="link-what">
            What moves
          </label>
          <input id="link-what" className={admin.input} value={f.what_moves} onChange={set("what_moves")} maxLength={300} placeholder="Orders, invoices, customer changes" />
        </div>
        <div className={admin.field}>
          <label className={admin.label} htmlFor="link-how">
            How it gets there
          </label>
          <select id="link-how" className={admin.select} value={f.how} onChange={set("how")}>
            {LINK_HOWS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </div>
        <div className={admin.field}>
          <label className={admin.label} htmlFor="link-notes">
            What breaks or gets missed
          </label>
          <textarea id="link-notes" className={styles.textarea} value={f.notes} onChange={set("notes")} maxLength={4000} />
        </div>
      </div>
    </Drawer>
  );
}
