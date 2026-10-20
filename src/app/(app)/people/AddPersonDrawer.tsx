"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { PlusIcon } from "@/components/ui/PlusIcon";
import uiStyles from "@/components/ui/ui.module.css";
import { InviteForm } from "../admin/companies/[id]/InviteForm";
import styles from "./people.module.css";

// "Add a person" as the Team page's main action, opening the same form
// in a drawer instead of a card that is always open under the roster
// (simplification review, change 6, the "adds-on-top" switch). The form
// stays open after an add, as it does in the card, so several people
// can be added in a row.
export function AddPersonDrawer({ companyId }: { companyId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={styles.rosterHead}>
        <button
          type="button"
          className={uiStyles.btnSecondary}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <PlusIcon />
          Add a person
        </button>
      </div>
      <Drawer open={open} onClose={() => setOpen(false)} eyebrow="Team" title="Add a person">
        <InviteForm companyId={companyId} />
      </Drawer>
    </>
  );
}
