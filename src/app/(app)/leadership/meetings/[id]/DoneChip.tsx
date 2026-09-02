// Shared "done state" chip for the meeting-summary extraction
// sections. Icon + short label, replacing the pickers/buttons once an
// extracted item has been acted on.
//
// Colour: uses --text-heading, NOT --aims-navy directly. In light mode
// that token resolves to the brand navy (#1F3352), which is what the
// section headings use, so the chip sits in the same brand voice. In
// dark mode --surface IS navy, so a hardcoded navy chip would be
// invisible against the card; --text-heading flips to white there and
// stays legible. Never hardcode a brand colour for text that sits on a
// themed surface.
//
// Icons: the two issue outcomes are semantically different actions and
// now read differently at a glance. "Resolved in meeting" closes the
// loop, so it gets a check in a circle. "Added as issue" puts the item
// on a list to work later, so it gets a plus in a circle. They share
// the circle so they read as a pair rather than two unrelated marks.
// Everything else keeps the plain check.

import styles from "./extracted.module.css";

export type DoneChipVariant = "check" | "resolved" | "added";

function ChipIcon({ variant }: { variant: DoneChipVariant }) {
  const common = {
    viewBox: "0 0 16 16",
    width: 15,
    height: 15,
    "aria-hidden": true as const,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (variant === "resolved") {
    // Closed loop: the question was settled in the room.
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6.35" strokeWidth={1.6} />
        <path d="M5.35 8.15 L7.15 9.95 L10.75 6.3" strokeWidth={1.9} />
      </svg>
    );
  }

  if (variant === "added") {
    // Open loop: the item was put on the issues list to work later.
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6.35" strokeWidth={1.6} />
        <path d="M8 5.15 V10.85" strokeWidth={1.9} />
        <path d="M5.15 8 H10.85" strokeWidth={1.9} />
      </svg>
    );
  }

  return (
    <svg {...common} width={14} height={14}>
      <path d="M3 8.5 L6.5 12 L13 4.5" strokeWidth={2.2} />
    </svg>
  );
}

export function DoneChip({
  label,
  variant = "check",
}: {
  label: string;
  variant?: DoneChipVariant;
}) {
  return (
    <span className={styles.doneChip} aria-live="polite">
      <ChipIcon variant={variant} />
      {label}
    </span>
  );
}
