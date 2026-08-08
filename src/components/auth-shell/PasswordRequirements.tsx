"use client";

import styles from "./PasswordRequirements.module.css";

// Live checklist under the password fields — each requirement
// turns green with a check when met, muted with a dot until then.
// Purely visual; validation still runs on submit. Shared between
// /accept-invite and /reset-password.

type Rule = {
  label: string;
  met: boolean;
};

export function PasswordRequirements({
  password,
  confirm,
}: {
  password: string;
  confirm: string;
}) {
  const rules: Rule[] = [
    { label: "At least 8 characters", met: password.length >= 8 },
    {
      label: "Passwords match",
      met: password.length > 0 && password === confirm,
    },
  ];

  return (
    <ul
      className={styles.list}
      aria-live="polite"
      aria-label="Password requirements"
    >
      {rules.map((rule) => (
        <li
          key={rule.label}
          className={styles.item}
          data-met={rule.met ? "true" : undefined}
        >
          <span className={styles.mark} aria-hidden="true">
            {rule.met ? (
              <svg viewBox="0 0 16 16" width={12} height={12}>
                <path
                  d="M3.5 8.5 L6.5 11.5 L12.5 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <span className={styles.dot} />
            )}
          </span>
          {rule.label}
        </li>
      ))}
    </ul>
  );
}
