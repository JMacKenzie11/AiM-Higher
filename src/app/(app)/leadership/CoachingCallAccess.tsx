"use client";

import { useState, useTransition } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { PrivacyNote } from "@/components/ui/PrivacyNote";
import { formatShortDate } from "@/lib/dates";
import {
  addCoachingCallViewerAction,
  removeCoachingCallViewerAction,
} from "@/lib/coaching-calls/access-actions";
import type { CoachingCallViewer } from "@/lib/coaching-calls/access";
import styles from "./access.module.css";

// WHO CAN SEE COACHING CALLS (0329; Jason, 2026-11-23).
//
// The line on the Coaching calls tab saying who sees the calls, and,
// for an assigned coach or a company admin, a Manage access button
// beside it. The panel lists coaches and admins first, who always see
// the calls and cannot be removed, then everyone added, each with
// Remove, then Add a person. A change takes effect at once; the page
// re-renders from the server action (revalidatePath), so the line
// above and the panel always say the same thing.

export function CoachingCallAccess({
  line,
  canManage,
  coaches,
  admins,
  viewers,
  candidates,
}: {
  line: string;
  canManage: boolean;
  coaches: string[];
  admins: string[];
  viewers: CoachingCallViewer[];
  candidates: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const run = (
    key: string,
    act: () => Promise<{ ok: true } | { ok: false; message: string }>,
    after?: () => void,
  ) => {
    setError(null);
    setBusy(key);
    start(async () => {
      const res = await act();
      setBusy(null);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      after?.();
    });
  };

  const fixed = [
    ...coaches.map((name) => ({ name, role: "Coach" })),
    ...admins
      .filter((n) => !coaches.includes(n))
      .map((name) => ({ name, role: "Admin" })),
  ];

  return (
    <div className={styles.bar}>
      <PrivacyNote tone="private">{line}</PrivacyNote>
      {canManage ? (
        <button
          type="button"
          className={styles.manage}
          onClick={() => setOpen(true)}
        >
          Manage access
        </button>
      ) : null}

      {canManage ? (
        <Drawer
          open={open}
          onClose={() => setOpen(false)}
          eyebrow="Coaching calls"
          title="Who can see coaching calls"
          name="coaching-access"
          footer={
            <button
              type="button"
              className={styles.done}
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          }
        >
          <p className={styles.intro}>
            Coaches and company admins always can. Add anyone else who should.
          </p>

          <h3 className={styles.groupHead}>Always</h3>
          <ul className={styles.list}>
            {fixed.map((p) => (
              <li key={`${p.role}-${p.name}`} className={styles.person}>
                <span className={styles.avatar} aria-hidden="true">
                  {initials(p.name)}
                </span>
                <span className={styles.name}>{p.name}</span>
                <span className={styles.chip}>{p.role}</span>
              </li>
            ))}
          </ul>

          <h3 className={styles.groupHead}>Also added</h3>
          {viewers.length === 0 ? (
            <p className={styles.empty}>Nobody else yet.</p>
          ) : (
            <ul className={styles.list}>
              {viewers.map((v) => (
                <li key={v.profileId} className={styles.person}>
                  <span
                    className={`${styles.avatar} ${styles.avatarAdded}`}
                    aria-hidden="true"
                  >
                    {initials(v.name)}
                  </span>
                  <span className={styles.nameBlock}>
                    <span className={styles.name}>{v.name}</span>
                    <span className={styles.note}>
                      {v.addedBy ? `Added by ${v.addedBy}, ` : "Added "}
                      {formatShortDate(v.addedAt.slice(0, 10))}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={`Remove ${v.name}`}
                    disabled={pending}
                    onClick={() =>
                      run(`remove-${v.profileId}`, () =>
                        removeCoachingCallViewerAction(v.profileId),
                      )
                    }
                  >
                    {busy === `remove-${v.profileId}` ? "Removing…" : "Remove"}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className={styles.add}>
            {candidates.length === 0 ? (
              <>
                <h3 className={styles.addLabel}>Add a person</h3>
                <p className={styles.empty}>
                  Everyone on the team can already see them.
                </p>
              </>
            ) : (
              <>
                <label
                  htmlFor="coaching-access-person"
                  className={styles.addLabel}
                >
                  Add a person
                </label>
                <div className={styles.addRow}>
                  <select
                    id="coaching-access-person"
                    className={styles.select}
                    value={pick}
                    onChange={(e) => setPick(e.target.value)}
                    disabled={pending}
                  >
                    <option value="">Choose someone</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={styles.addButton}
                    disabled={pending || !pick}
                    onClick={() =>
                      run(
                        "add",
                        () => addCoachingCallViewerAction(pick),
                        () => setPick(""),
                      )
                    }
                  >
                    {busy === "add" ? "Adding…" : "Add"}
                  </button>
                </div>
              </>
            )}
            <p className={styles.hint}>
              They can see every coaching call straight away, and get a
              notification with a link here.
            </p>
          </div>

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </Drawer>
      ) : null}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
