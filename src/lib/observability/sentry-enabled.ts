// Where Sentry is allowed to send anything.
//
// Sentry runs on Vercel deployments only. Local dev, local production
// builds and e2e runs talk to the dev database, which holds copies of
// client data, so an error, trace, log or session replay from any of
// them would carry that data into the same Sentry project production
// reports to. Off outside Vercel, and labelled by environment inside
// it, so dev can never mix with production.
//
// Pure functions, no imports: the three Sentry configs (server, edge,
// browser) all load this before Sentry.init, and the edge and browser
// bundles should not pull anything else in with it.

/**
 * Server and edge runtimes. Vercel sets VERCEL=1 on every build and
 * function it runs. `vercel env pull` also writes VERCEL_ENV=
 * "development" into a local .env file, so a pulled file must not
 * switch Sentry on for a laptop: development is refused explicitly.
 */
export function sentryEnabledOnServer(env: {
  VERCEL?: string;
  VERCEL_ENV?: string;
}): boolean {
  return env.VERCEL === "1" && env.VERCEL_ENV !== "development";
}

/**
 * Browser runtime. The browser cannot see VERCEL, so it decides from
 * the hostname the page was served on. Off for loopback, *.local
 * (mDNS names like jasons-mac.local) and private LAN addresses, which
 * is how the dev server is reached from a phone on the same network
 * (e.g. 192.168.127.141:3200).
 */
export function sentryEnabledForHostname(hostname: string): boolean {
  // URL.hostname brackets IPv6 ("[::1]"); location.hostname does too.
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

  if (host === "") return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "::1" || host === "0.0.0.0") return false;
  if (host.endsWith(".local")) return false;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127) return false; // loopback, all of 127/8
    if (a === 10) return false; // 10/8
    if (a === 172 && b >= 16 && b <= 31) return false; // 172.16/12
    if (a === 192 && b === 168) return false; // 192.168/16
    if (a === 169 && b === 254) return false; // link-local
  }

  return true;
}

/**
 * The environment label for browser events. NEXT_PUBLIC_VERCEL_ENV is
 * inlined at build time when Vercel exposes system variables; when it
 * is missing, an enabled browser is on a real host and is labelled
 * production, which is Sentry's own default.
 */
export function browserSentryEnvironment(
  vercelEnv: string | undefined
): string {
  return vercelEnv && vercelEnv.trim() !== "" ? vercelEnv : "production";
}
