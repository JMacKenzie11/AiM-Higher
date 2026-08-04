import styles from "./PrivacyNote.module.css";

// Small, subtle line of copy that tells the user who can see the
// surrounding content. Modelled after Ask Aimee's "Your Ask Aimee
// conversations are visible only to you" line, which is the trust-
// building move the rest of the app should mirror.
//
// Tones:
//   * private — user's own private content (only-you framing)
//   * managerial — content visible to a specific role or set of roles
//   * shared — content visible to the whole company or a wide audience
// Tone only shifts the leading glyph + color; the copy still lives
// with the caller so the wording matches its context exactly.

export type PrivacyTone = "private" | "managerial" | "shared";

export function PrivacyNote({
  tone = "managerial",
  children,
}: {
  tone?: PrivacyTone;
  children: React.ReactNode;
}) {
  return (
    <p className={styles.note} data-tone={tone}>
      <span className={styles.icon} aria-hidden="true">
        {tone === "private" ? (
          <LockIcon />
        ) : tone === "shared" ? (
          <UsersIcon />
        ) : (
          <EyeIcon />
        )}
      </span>
      <span>{children}</span>
    </p>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 14 14" width={12} height={12}>
      <path
        d="M4 7 V5.2 a3 3 0 0 1 6 0 V7"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
      <rect
        x={3}
        y={7}
        width={8}
        height={5.5}
        rx={1.2}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 14 14" width={12} height={12}>
      <path
        d="M1.5 7 Q4 3.2 7 3.2 Q10 3.2 12.5 7 Q10 10.8 7 10.8 Q4 10.8 1.5 7 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
      />
      <circle cx={7} cy={7} r={1.6} fill="currentColor" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 14 14" width={12} height={12}>
      <circle cx={5} cy={5.2} r={2} fill="none" stroke="currentColor" strokeWidth={1.3} />
      <path
        d="M1.5 11.5 Q1.5 8.5 5 8.5 Q8.5 8.5 8.5 11.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
      />
      <circle cx={10} cy={5.8} r={1.5} fill="none" stroke="currentColor" strokeWidth={1.3} />
      <path
        d="M8.5 9.5 Q9 8.6 10 8.6 Q12.5 8.6 12.5 11.2"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
      />
    </svg>
  );
}
