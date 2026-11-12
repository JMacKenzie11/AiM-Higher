import styles from "./transcripts.module.css";

// Microsoft's sign-in button, beside Google's: the four-square mark
// inline, white background, dark text, as Microsoft's own sign-in
// branding asks. An anchor, so the sign-in is a plain GET.

export function ConnectMicrosoftButton({ label, href }: { label: string; href: string }) {
  return (
    <a href={href} className={styles.googleButton}>
      <span className={styles.googleG} aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width="9" height="9" fill="#F25022" />
          <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
          <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
          <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
        </svg>
      </span>
      <span>{label}</span>
    </a>
  );
}
