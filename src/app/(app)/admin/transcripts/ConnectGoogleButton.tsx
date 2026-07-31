import styles from "./transcripts.module.css";

// Google-branded connect button. Uses the standard multicolor G
// mark inline (SVG, no asset dependency) with white background and
// dark text — matches Google's "Sign in with Google" guidelines
// closely enough for a "connect account" affordance. Rendered as an
// anchor so the OAuth flow can be a plain GET request.

export function ConnectGoogleButton({
  label,
  href,
}: {
  label: string;
  href: string;
}) {
  return (
    <a href={href} className={styles.googleButton}>
      <span className={styles.googleG} aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
          <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.909c1.702-1.567 2.683-3.874 2.683-6.615z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.909-2.259c-.806.54-1.837.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" />
          <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
          <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
        </svg>
      </span>
      <span>{label}</span>
    </a>
  );
}
