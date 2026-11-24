"use client";

import type { MouseEvent } from "react";
import { RowMenu, type RowMenuItem } from "@/components/ui/RowMenu";
import { PlusIcon } from "@/components/ui/PlusIcon";
import { addPanelId } from "./cascade-anchor";
import styles from "./plan.module.css";

// The one Add in a focus area's navy band (Jason, 2026-11-23). It
// replaced the two buttons at the foot of every card ("Add goal",
// "Add quarterly priority"), which made eight buttons the loudest
// thing on a page of four focus areas.
//
// IT OPENS, IT DOES NOT OWN. The forms are still the two <details>
// at the top of the card's body, rendered by the server exactly as
// before and closed by their own forms on success. This sets `open`
// on one of them and nothing else, for the reason MobileAddMenu
// gives: React state over these panels once swallowed a refresh.
//
// The band is the card's <summary>, so a click here would also fold
// the card. preventDefault on the wrapper cancels that; the menu
// itself is portalled, outside the summary.
export function SfaAddMenu({
  sfaId,
  sfaTitle,
  canAddPriority,
}: {
  sfaId: string;
  sfaTitle: string;
  canAddPriority: boolean;
}) {
  const items: RowMenuItem[] = [
    { label: "Goal", onSelect: () => openPanel(sfaId, "goal") },
  ];
  if (canAddPriority) {
    items.push({ label: "Quarterly priority", onSelect: () => openPanel(sfaId, "priority") });
  }

  const keepCardOpen = (e: MouseEvent) => {
    e.preventDefault();
  };

  return (
    <span className={styles.bandAddWrap} onClick={keepCardOpen}>
      <RowMenu
        label={
          <>
            <PlusIcon />
            Add
          </>
        }
        ariaLabel={`Add to ${sfaTitle}`}
        items={items}
        testId="sfa-add-menu"
        triggerClassName={styles.bandAdd}
      />
    </span>
  );
}

function openPanel(sfaId: string, kind: "goal" | "priority") {
  const panel = document.getElementById(addPanelId(sfaId, kind));
  if (!(panel instanceof HTMLDetailsElement)) return;
  // A folded card first, recorded as the reader's choice the way
  // Expand all records it (PlanCascadeController listens for toggle).
  const card = panel.closest<HTMLDetailsElement>("details[data-sfa-id]");
  if (card && !card.open) {
    card.open = true;
    card.dispatchEvent(new Event("toggle"));
  }
  // The two panels share a `name`, so opening one closes the other.
  panel.open = true;
  // Two frames: closing the menu hands focus back to its trigger
  // (useMenuButton), and the field should be where it ends up.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    panel.scrollIntoView({ block: "nearest" });
    panel.querySelector<HTMLInputElement>("input:not([type=hidden])")?.focus();
  }));
}
