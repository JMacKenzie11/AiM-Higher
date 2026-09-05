// Which database does this request belong to?
//
// One function answers that, and it is pure: env and the registry
// lookup are both injected, so nothing here reads process.env, opens a
// Supabase client, or makes a network call. That is what makes the
// precedence testable.
//
// The rules, in order:
//
//   1. Local override. If the LOCAL_INSTANCE_* variables are set we
//      use them and ignore the hostname completely. This is how a
//      developer pins their machine to the dev database no matter what
//      host they browse to. A partial set throws.
//   2. Preview deployments. Anything on *.vercel.app gets the shared
//      preview database, because preview URLs are generated per
//      deployment and can never be registered as instances.
//   3. The registry. Normalize the hostname, take its subdomain, and
//      ask the injected lookup. The apex domain and www are the
//      marketing site, not an instance.
//   4. Otherwise null.
//
// There is no step 5. An unresolved request must not fall back to a
// default database: falling back is how one customer ends up reading
// another customer's rows.

import type { InstanceConfig } from "./types";

// The registry lookup, injected so this module stays pure.
//
// It receives the extracted subdomain ("acme"), not the full hostname:
// the registry is keyed by subdomain, and doing the parsing here means
// every caller gets the same normalization rules.
export type InstanceLookup = (
  subdomain: string,
) => Promise<InstanceConfig | null>;

const PREVIEW_SUFFIX = ".vercel.app";
const WWW_LABEL = "www";

// Lowercase, drop any :port, drop a trailing dot (a fully-qualified
// name is still the same host). Hostnames are case-insensitive, so
// ACME.Example.com and acme.example.com are one instance.
export function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

// The subdomain is the first label, and only when there is a domain
// left underneath it.
//
//   acme.example.com        -> "acme"
//   www.acme.example.com    -> "acme"   (www is decoration)
//   example.com             -> null     (apex: the marketing site)
//   www.example.com         -> null     (the same marketing site)
//   localhost               -> null
//
// The apex and www cases are the ones worth being explicit about. The
// marketing site and the app share a domain, so a naive "first label"
// rule would send a visitor to aimhigher.com looking for an instance
// called "www", and would send the apex itself to a lookup that can
// only ever miss. Neither names a customer, so neither resolves.
export function extractSubdomain(normalizedHostname: string): string | null {
  const labels = normalizedHostname.split(".").filter(Boolean);
  // Drop a leading www so www.acme.example.com is the same instance as
  // acme.example.com, and www.example.com collapses back to the apex.
  if (labels[0] === WWW_LABEL) labels.shift();
  if (labels.length < 3) return null;
  return labels[0];
}

export async function resolveInstance(
  hostname: string,
  env: Record<string, string | undefined>,
  lookup: InstanceLookup,
): Promise<InstanceConfig | null> {
  // 1. Local override. Set by a developer's .env.local, so its
  //    presence is the instruction: any one of the three variables
  //    means "pin me to this database".
  //
  //    A partial set throws rather than returning null. Null here
  //    would be indistinguishable from an unknown hostname, and the
  //    developer would spend the afternoon debugging their subdomain
  //    instead of the typo in their .env.local.
  const localUrl = env.LOCAL_INSTANCE_SUPABASE_URL;
  const localAnonKey = env.LOCAL_INSTANCE_SUPABASE_ANON_KEY;
  const localServiceKey = env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (localUrl || localAnonKey || localServiceKey) {
    if (!localUrl || !localAnonKey || !localServiceKey) {
      const missing = [
        ["LOCAL_INSTANCE_SUPABASE_URL", localUrl],
        ["LOCAL_INSTANCE_SUPABASE_ANON_KEY", localAnonKey],
        ["LOCAL_INSTANCE_SUPABASE_SERVICE_KEY", localServiceKey],
      ]
        .filter(([, value]) => !value)
        .map(([name]) => name);

      throw new Error(
        `Incomplete local instance override. Missing: ${missing.join(", ")}. ` +
          "Set all three LOCAL_INSTANCE_SUPABASE_* variables in .env.local, " +
          "or none of them.",
      );
    }

    return {
      subdomain: "local",
      displayName: "Local",
      supabaseUrl: localUrl,
      supabaseAnonKey: localAnonKey,
      supabaseServiceKey: localServiceKey,
      status: "active",
    };
  }

  const normalized = normalizeHostname(hostname);

  // 2. Preview deployments. All three variables are required here
  //    too, but a partial set returns null rather than throwing: a
  //    preview build is a deployed environment, and a missing variable
  //    there should fail closed on the request, not take the process
  //    down. The local override throws because a developer needs to
  //    see it immediately.
  if (normalized.endsWith(PREVIEW_SUFFIX)) {
    const previewUrl = env.PREVIEW_INSTANCE_SUPABASE_URL;
    const previewAnonKey = env.PREVIEW_INSTANCE_SUPABASE_ANON_KEY;
    const previewServiceKey = env.PREVIEW_INSTANCE_SUPABASE_SERVICE_KEY;
    if (!previewUrl || !previewAnonKey || !previewServiceKey) return null;
    return {
      subdomain: "preview",
      displayName: "Preview",
      supabaseUrl: previewUrl,
      supabaseAnonKey: previewAnonKey,
      supabaseServiceKey: previewServiceKey,
      status: "active",
    };
  }

  // 3. The registry. Suspended instances come back exactly as the
  //    lookup returned them; this function does not judge status.
  const subdomain = extractSubdomain(normalized);
  if (!subdomain) return null;
  return lookup(subdomain);
}
