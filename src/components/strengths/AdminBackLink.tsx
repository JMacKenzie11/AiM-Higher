import Link from "next/link";

export default function AdminBackLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <nav className="admin-nav-bar" aria-label="Back">
      <Link href={href} className="admin-nav-back">
        <svg
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
    </nav>
  );
}
