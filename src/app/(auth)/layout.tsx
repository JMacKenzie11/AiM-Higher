// Layout for unauthenticated flows (sign-in, forgot-password,
// reset-password, accept-invite). No nav band here — each page
// renders its own full-viewport --grad-brand composition per
// Section 8.1's quality bar.

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
