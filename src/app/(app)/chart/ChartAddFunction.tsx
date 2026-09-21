"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { PlusIcon } from "@/components/ui/PlusIcon";
import { AddFunctionForm } from "./InlineForms";
import type { Profile } from "@/lib/types";
import styles from "./chart.module.css";

// "Add function", in the house drawer.
//
// It was a <details> whose panel opened inside the chart card, above
// a pan-and-zoom tree. Two problems with that, and the drawer answers
// both: the panel pushed the tree down as it opened, and it lived
// inside a container that transforms — which is where a `position:
// fixed` child stops meaning the viewport.
//
// keepMounted, for the same reason /plan needs it: AddFunctionForm
// does router.push to the new function's page in an effect on
// success, and unmounting the form at the moment it succeeds is how
// that push gets discarded. The <details> this replaces never
// unmounted anything.
export function ChartAddFunction({
  people,
  parentOptions,
}: {
  people: Array<Pick<Profile, "id" | "full_name">>;
  parentOptions: Array<{ id: string; title: string }>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={styles.addButton}
        data-testid="add-function-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <PlusIcon />
        Add function
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        keepMounted
        eyebrow="Functional chart"
        title="Add function"
      >
        <div data-testid="add-function-form">
          <AddFunctionForm people={people} parentOptions={parentOptions} />
        </div>
      </Drawer>
    </>
  );
}
