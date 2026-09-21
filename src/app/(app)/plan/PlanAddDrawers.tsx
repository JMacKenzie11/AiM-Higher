"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { PlusIcon } from "@/components/ui/PlusIcon";
import { AddSfaForm } from "./AddSfaForm";
import { AddGoalForm } from "./AddGoalForm";
import { AddPriorityForm } from "./AddPriorityForm";
import { AddCommitmentForm } from "./AddCommitmentForm";
import type { Profile } from "@/lib/types";
import styles from "./plan.module.css";

// The plan toolbar's four add buttons, and the drawer they open.
//
// ---- WHAT THIS REPLACES ----------------------------------------
//
// Four native <details>, each with a floating panel pinned under the
// toolbar, plus AddPanels — a component whose whole job was giving
// those panels the three dismissals a drawer has for free: click
// outside, Escape, and closing the other one when you open this one.
// A panel 560px wide hanging off the right edge of a card is also the
// shape that has produced sideways-scroll bugs on this page before.
//
// ---- keepMounted IS NOT OPTIONAL HERE --------------------------
//
// The <details> were native for a reason that is written down in
// AddPanels: an earlier attempt to own these panels in React state
// discarded an in-flight router.refresh() and the created row never
// appeared. useStayOpenForm calls router.refresh() in an effect on
// success; unmounting the form at the moment it succeeds is exactly
// that bug.
//
// So the drawer keeps its children mounted and only toggles `hidden`,
// which is what closing a <details> did. All four forms are rendered
// from the first paint and none of them is ever torn down. `which`
// decides what is on screen, not what exists.
//
// ---- ONE DRAWER, NOT FOUR --------------------------------------
//
// A single panel whose contents change, so "opening another closes
// the first" is not a rule anybody has to implement. It is the same
// element.

type Which = "sfa" | "goal" | "priority" | "commitment";

const TITLES: Record<Which, { eyebrow: string; title: string }> = {
  sfa: { eyebrow: "Plan", title: "Add focus area" },
  goal: { eyebrow: "Plan", title: "Add goal" },
  priority: { eyebrow: "Plan", title: "Add quarterly priority" },
  commitment: { eyebrow: "Plan", title: "Add commitment" },
};

export function PlanAddDrawers({
  roster,
  sfaOptions,
  goalOptions,
  priorityChoices,
  quarterId,
  noParentValue,
  defaultOwnerId,
  defaultDueDate,
}: {
  roster: Pick<Profile, "id" | "full_name">[];
  sfaOptions: React.ComponentProps<typeof AddGoalForm>["sfaOptions"];
  goalOptions: React.ComponentProps<typeof AddPriorityForm>["goalOptions"];
  priorityChoices: React.ComponentProps<typeof AddCommitmentForm>["priorities"];
  // null when no quarter is open — the priority button is not offered.
  quarterId: string | null;
  noParentValue: string;
  defaultOwnerId: string;
  defaultDueDate: string;
}) {
  const [which, setWhich] = useState<Which | null>(null);
  const close = () => setWhich(null);

  // Offered only when there is something to hang the row on. A picker
  // with nothing in it is a dead end, which is the rule the <details>
  // version followed too.
  const buttons: Array<{ key: Which; label: string; shown: boolean }> = [
    { key: "sfa", label: "Add focus area", shown: true },
    { key: "goal", label: "Add goal", shown: true },
    { key: "priority", label: "Add quarterly priority", shown: quarterId !== null },
    {
      key: "commitment",
      label: "Add commitment",
      shown: priorityChoices.length > 0,
    },
  ];

  return (
    <>
      {buttons
        .filter((b) => b.shown)
        .map((b) => (
          <button
            key={b.key}
            type="button"
            className={styles.toolbarAddButton}
            data-testid={`add-${b.key}-button`}
            aria-haspopup="dialog"
            aria-expanded={which === b.key}
            onClick={() => setWhich(b.key)}
          >
            <PlusIcon />
            {b.label}
          </button>
        ))}

      <Drawer
        open={which !== null}
        onClose={close}
        keepMounted
        eyebrow={which ? TITLES[which].eyebrow : "Plan"}
        title={which ? TITLES[which].title : "Add"}
      >
        {/* Every form, always mounted; `hidden` decides which one you
            can see. A form that is mid-refresh must not be torn down
            because somebody opened a different one.
 
            Each wrapper carries its own testid because all four share
            one panel: three of these hold a field labelled "Title" at
            any moment, and a locator scoped to the drawer alone would
            match the hidden ones too. */}
        <div hidden={which !== "sfa"} data-testid="add-sfa-form">
          <AddSfaForm people={roster} onAdded={close} />
        </div>
        <div hidden={which !== "goal"} data-testid="add-goal-form">
          <AddGoalForm
            defaultSfaId={null}
            sfaOptions={sfaOptions}
            people={roster}
            onAdded={close}
          />
        </div>
        {quarterId ? (
          <div hidden={which !== "priority"} data-testid="add-priority-form">
            <AddPriorityForm
              quarterId={quarterId}
              defaultParent={noParentValue}
              goalOptions={goalOptions}
              sfaOptions={sfaOptions}
              people={roster}
              onAdded={close}
            />
          </div>
        ) : null}
        {priorityChoices.length > 0 ? (
          <div hidden={which !== "commitment"} data-testid="add-commitment-form">
            <AddCommitmentForm
              priorities={priorityChoices}
              people={roster}
              defaultOwnerId={defaultOwnerId}
              defaultDueDate={defaultDueDate}
              onAdded={close}
            />
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
