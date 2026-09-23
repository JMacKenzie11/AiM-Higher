"use client";

import { useEffect, useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import {
  applyDistributionAction,
  distributionRowsAction,
  dryRunDistributionAction,
  retractDistributionAction,
} from "@/lib/practices/distribution-actions";
import type {
  DistributionPlan,
  InstanceDistributionRow,
} from "@/lib/practices/distribution-types";
import admin from "../companies/admin.module.css";
import styles from "./hub.module.css";

// Where an agent stands on every other instance, and how to move it.
//
// Two steps, never one. A dry run names every target and every change
// it would make; the apply executes THAT plan. There is no button
// that fans out to the fleet from a single press, because a push
// writes into live customer databases.

const STATUS_LABEL: Record<InstanceDistributionRow["status"], string> = {
  current: "Current",
  behind: "Behind",
  never: "Never sent",
  refused: "Refused",
  failed: "Failed",
  retracted: "Retracted",
};

export function AgentDistributionDrawer({
  agentRowId,
  title,
  onClose,
}: {
  agentRowId: string;
  title: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<InstanceDistributionRow[] | null>(null);
  const [applyEnabled, setApplyEnabled] = useState(false);
  const [liveVersion, setLiveVersion] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [plan, setPlan] = useState<DistributionPlan | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    distributionRowsAction(agentRowId).then((r) => {
      if (!live) return;
      if (r.ok) {
        setRows(r.rows);
        setApplyEnabled(r.applyEnabled);
        setLiveVersion(r.liveVersion);
      } else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [agentRowId, reloadKey]);

  function toggle(subdomain: string) {
    setSelected((s) =>
      s.includes(subdomain) ? s.filter((x) => x !== subdomain) : [...s, subdomain]
    );
    // The plan describes the targets it was built for. Changing them
    // makes it stale, and a stale plan is the one thing an apply must
    // never execute.
    setPlan(null);
    setApplied(false);
  }

  async function run(fn: () => Promise<{ ok: boolean; message?: string; plan?: DistributionPlan }>) {
    setBusy(true);
    setError(null);
    try {
      const r = (await fn()) as {
        ok: boolean;
        message?: string;
        plan?: DistributionPlan;
      };
      if (!r.ok) setError(r.message ?? "That did not work.");
      else if (r.plan) setPlan(r.plan);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      name="agent-distribution"
      eyebrow="Distribution"
      title={title}
      footer={
        <>
          <button
            type="button"
            className={admin.primaryButton}
            disabled={busy || selected.length === 0}
            data-testid="distribution-dry-run"
            onClick={() =>
              void run(async () => {
                setApplied(false);
                return dryRunDistributionAction(agentRowId, selected);
              })
            }
          >
            Dry run
          </button>
          <button
            type="button"
            className={admin.dangerButton}
            data-testid="distribution-apply"
            disabled={busy || !applyEnabled || !plan || !plan.pushable || applied}
            title={
              applyEnabled
                ? undefined
                : "Not yet verified against a live push"
            }
            onClick={() =>
              void run(async () => {
                const r = await applyDistributionAction(agentRowId, selected);
                if (r.ok) {
                  setApplied(true);
                  setReloadKey((k) => k + 1);
                }
                return r;
              })
            }
          >
            Apply this plan
          </button>
          <button
            type="button"
            className={admin.ghostButton}
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </>
      }
    >
      <div className={styles.drawerForm}>
        {error ? (
          <p className={admin.errorMessage} role="status" data-testid="distribution-error">
            {error}
          </p>
        ) : null}

        {!applyEnabled ? (
          <p className={admin.warningMessage} data-testid="distribution-gate-note">
            <strong>Pushing is switched off.</strong> It has not been verified
            against a live instance yet, so the apply button is disabled here
            and the server refuses it regardless. The dry run below works and
            is safe: it reads each target and writes nothing.
          </p>
        ) : null}

        <p className={styles.configSource}>
          {liveVersion === null
            ? "Nothing is published here, so there is nothing to send. Publish it first."
            : `Version ${liveVersion} is live here, and is what would be sent.`}
        </p>

        {rows === null ? (
          <p className={admin.emptyLine}>Loading instances…</p>
        ) : rows.length === 0 ? (
          <p className={admin.emptyLine} data-testid="distribution-no-targets">
            No instances to send this to. Either this is the only one in the
            registry, or this deployment is not a registered instance at all
            — which is what you see on a local dev server, and why nothing is
            offered there.
          </p>
        ) : (
          <div data-testid="distribution-rows">
            {rows.map((r) => (
              <div key={r.subdomain} className={styles.versionRow}>
                <label className={admin.checkOption}>
                  <input
                    type="checkbox"
                    checked={selected.includes(r.subdomain)}
                    onChange={() => toggle(r.subdomain)}
                    disabled={busy}
                  />
                  <span>
                    <strong>{r.displayName}</strong> ({r.subdomain})
                  </span>
                </label>
                <p className={styles.agentDescription}>
                  {STATUS_LABEL[r.status]}
                  {r.distributedVersion !== null
                    ? ` · has version ${r.distributedVersion}`
                    : ""}
                  {r.lastPushedAt
                    ? ` · ${new Date(r.lastPushedAt).toLocaleDateString()}`
                    : ""}
                </p>
                {r.lastDetail ? (
                  <p className={styles.agentDescription}>{r.lastDetail}</p>
                ) : null}
                {r.status !== "never" && r.status !== "retracted" ? (
                  <button
                    type="button"
                    className={admin.dangerGhost}
                    disabled={busy || !applyEnabled}
                    title={applyEnabled ? undefined : "Not yet verified against a live push"}
                    data-testid={`distribution-retract-${r.subdomain}`}
                    onClick={() =>
                      void run(async () => {
                        const res = await retractDistributionAction(
                          agentRowId,
                          r.subdomain
                        );
                        if (res.ok) setReloadKey((k) => k + 1);
                        return res;
                      })
                    }
                  >
                    Retract from this instance
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {plan ? (
          <div data-testid="distribution-plan">
            <h3 className={styles.categoryRowName}>
              {applied ? "What happened" : "What would happen"}
            </h3>
            {plan.blockedReason ? (
              <p className={admin.warningMessage}>{plan.blockedReason}</p>
            ) : null}
            {plan.steps.map((s) => (
              <div key={s.subdomain} className={styles.versionRow}>
                <p className={styles.agentTitle}>
                  {s.displayName} · {STATUS_LABEL[
                    s.outcome === "already_current" ? "current" : (s.outcome as never)
                  ] ?? s.outcome}
                </p>
                <p className={styles.agentDescription}>{s.detail}</p>
                {s.warnings.map((w) => (
                  <p key={w} className={admin.warningMessage}>
                    {w}
                  </p>
                ))}
              </div>
            ))}
            {!applied && plan.pushable ? (
              <p className={admin.fieldHint}>
                Apply executes exactly this plan. Changing the selected
                instances discards it.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
