"use client";

import { useState, useTransition } from "react";
import { reviseRoleDescriptionAction } from "@/lib/role-descriptions/revise-action";
import { RoleDescriptionView } from "./RoleDescriptionView";
import type { RoleDescriptionDoc } from "@/lib/role-descriptions/parse-document";
import styles from "./RoleDescriptionsCard.module.css";

// Saved role descriptions, on the Team page.
//
// It has no page of its own and no nav entry, deliberately: a role
// description is about a seat and the people are here, so a reader
// who wants one is already on this page rather than hunting a
// twelfth item in the sidebar for a list that is usually short.
//
// EXPANDS IN PLACE rather than linking out. An off-chart role has
// no function page to link to, and a list where half the rows open
// and half do not is a list that looks broken. Expanding works the
// same for both, and the renderer is the one the card in the
// conversation uses, so the saved thing reads as what was agreed.

export type SavedRole = {
  roleId: string;
  title: string;
  functionId: string | null;
  supportsFunctions: string[];
  versionNumber: number;
  updatedAt: string;
  authorName: string | null;
  doc: RoleDescriptionDoc | null;
};

export function RoleDescriptionsCard({
  roles,
  canRevise,
}: {
  roles: SavedRole[];
  // Whether this reader may revise. Computed on the server, and one
  // answer for the page: heading up a function admits you to the
  // company's role descriptions rather than to one row of them.
  canRevise: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startRevising] = useTransition();

  if (roles.length === 0) {
    return (
      <p className={styles.empty}>
        None yet. Ask Aimee for the <strong>Role Description Creator</strong>,
        under People in the agent list, and save what she writes.
      </p>
    );
  }

  return (
    <ul className={styles.list}>
      {roles.map((role) => {
        const open = openId === role.roleId;
        return (
          <li key={role.roleId} className={styles.row}>
            <button
              type="button"
              className={styles.rowButton}
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : role.roleId)}
            >
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>{role.title}</span>
                {/* Whether a role sits on the Functional Chart is
                    not something a reader of this list can act on,
                    so it is not here. What a role SUPPORTS is real
                    information and stays. A row with neither says
                    nothing rather than saying "Not on the chart",
                    which was a fact about our data model wearing a
                    sentence. */}
                {role.supportsFunctions.length > 0 ? (
                  <span className={styles.rowPlacement}>
                    Supports {role.supportsFunctions.join(", ")}
                  </span>
                ) : null}
              </span>
              <span className={styles.rowMeta}>
                <span className={styles.version}>v{role.versionNumber}</span>
                <span className={styles.metaLine}>
                  {formatDay(role.updatedAt)}
                  {role.authorName ? ` · ${role.authorName}` : ""}
                </span>
              </span>
              <span className={styles.chevron} aria-hidden="true">
                {open ? "▾" : "▸"}
              </span>
            </button>

            {open ? (
              <div className={styles.body}>
                {role.doc ? (
                  <RoleDescriptionView doc={role.doc} />
                ) : (
                  <p className={styles.broken}>
                    This version can&rsquo;t be read. Ask Aimee for a fresh one.
                  </p>
                )}
                {canRevise ? (
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.revise}
                      disabled={pending}
                      onClick={() =>
                        startRevising(async () => {
                          setError(null);
                          // Redirects on success, so anything that
                          // comes back is a refusal.
                          const result = await reviseRoleDescriptionAction(
                            role.roleId
                          );
                          if (result && !result.ok) setError(result.message);
                        })
                      }
                    >
                      {pending ? "Opening…" : "Revise with Aimee"}
                    </button>
                    <span className={styles.reviseHint}>
                      Opens a new conversation. Saving writes version{" "}
                      {role.versionNumber + 1}; this one is kept.
                    </span>
                  </div>
                ) : null}
                {error ? (
                  <p role="alert" className={styles.broken}>
                    {error}
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
