// The web address of one instance, for links built where there is no
// request to read a host from: background work such as the weekly
// meeting email, sent from the transcripts cron.
//
// One deployment serves every instance, by hostname (resolve.ts), and
// NEXT_PUBLIC_APP_URL names the primary one. An instance's address is
// its subdomain on the same domain: acme.aims-hq.com. The primary
// ("@") is APP_URL itself, and so is anything that is not a real
// domain (localhost, an IP, a vercel.app preview), where there are no
// subdomains to point at.
export function instanceOrigin(subdomain: string, appUrl: string): string {
  const base = new URL(appUrl);
  const host = base.hostname;
  const notADomain =
    host === "localhost" || /^[\d.]+$/.test(host) || host.endsWith(".vercel.app");
  if (subdomain === "@" || notADomain) return base.origin;
  const apex = host.replace(/^www\./, "");
  const port = base.port ? `:${base.port}` : "";
  return `${base.protocol}//${subdomain}.${apex}${port}`;
}
