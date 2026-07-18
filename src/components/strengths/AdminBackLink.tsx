import Link from "next/link";
import styles from "@/app/(app)/strengths/strengths.module.css";

// Small "← Back to X" link rendered at the top of Strengths sub-pages.
// The bare SVG used to render at viewport size because the legacy
// admin-nav-* classes it relied on never existed here — width/height
// on the SVG element itself keeps it bounded regardless of CSS.

export default function AdminBackLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link href={href} className={styles.backLink}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
      </svg>
      <span>{label}</span>
    </Link>
  );
}
