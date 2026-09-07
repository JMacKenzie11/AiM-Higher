// Input and configuration validation for the provisioning CLI.
//
// Pure, so it carries unit tests and the CLI stays a thin shell around
// it. Everything here runs BEFORE anything is created: provisioning
// touches a Supabase project, Vercel environment variables and the
// instance registry, and half of a failed run is worse than none of
// one. Refuse early, by name, with the fix in the message.

// A subdomain becomes an env_prefix, and {PREFIX}_SUPABASE_URL has to
// be a legal environment variable name. Hyphens are legal in a
// hostname and not in a variable, so they become underscores.
export function envPrefixFor(subdomain: string): string {
  return subdomain.toUpperCase().replace(/-/g, "_");
}

// Names that must never be handed to a customer.
//
// "@" is the apex row (see APEX_SUBDOMAIN in lib/instances/resolve.ts):
// taking it would point the marketing site and every unscoped hostname
// at one customer's database. "www" collapses to the apex for the same
// reason. The rest are infrastructure hostnames people expect to
// behave a certain way, and a customer sitting on "api" or "admin" is
// a support ticket at best.
export const RESERVED_SUBDOMAINS: readonly string[] = [
  "@",
  "www",
  "api",
  "admin",
  "mail",
  "staging",
  "dev",
];

export const SUBDOMAIN_MIN = 3;
export const SUBDOMAIN_MAX = 30;

export type SubdomainCheck =
  | { ok: true; subdomain: string; envPrefix: string }
  | { ok: false; message: string };

export function validateSubdomain(raw: string): SubdomainCheck {
  const subdomain = raw.trim();

  if (subdomain.length === 0) {
    return { ok: false, message: "--subdomain is required." };
  }
  if (subdomain !== subdomain.toLowerCase()) {
    return {
      ok: false,
      message:
        `Subdomain "${subdomain}" must be lowercase. Hostnames are ` +
        "case-insensitive, so an uppercase one would resolve but never " +
        `match its own registry row. Try "${subdomain.toLowerCase()}".`,
    };
  }
  // Reserved names are checked BEFORE shape, so a reserved name always
  // reports itself as reserved. "@" is one character, so the length
  // rule would otherwise tell someone their apex attempt was too
  // short, which is true and useless.
  if (RESERVED_SUBDOMAINS.includes(subdomain)) {
    return {
      ok: false,
      message:
        `Subdomain "${subdomain}" is reserved. Reserved: ` +
        `${RESERVED_SUBDOMAINS.join(", ")}.`,
    };
  }

  if (subdomain.length < SUBDOMAIN_MIN || subdomain.length > SUBDOMAIN_MAX) {
    return {
      ok: false,
      message:
        `Subdomain "${subdomain}" is ${subdomain.length} characters. ` +
        `It must be ${SUBDOMAIN_MIN} to ${SUBDOMAIN_MAX}.`,
    };
  }
  if (!/^[a-z0-9-]+$/.test(subdomain)) {
    const bad = [...new Set(subdomain.split("").filter((c) => !/[a-z0-9-]/.test(c)))];
    return {
      ok: false,
      message:
        `Subdomain "${subdomain}" contains ${bad.map((c) => `"${c}"`).join(", ")}. ` +
        "Only lowercase letters, digits and hyphens are allowed.",
    };
  }
  if (subdomain.startsWith("-") || subdomain.endsWith("-")) {
    return {
      ok: false,
      message: `Subdomain "${subdomain}" must not start or end with a hyphen.`,
    };
  }

  // Belt and braces. The character rules above already guarantee this,
  // but the prefix is what actually names the variables holding a
  // customer's service-role key, so it gets checked rather than
  // assumed. A digit-leading prefix is legal in most shells and not in
  // all of them, which is exactly the kind of thing that fails in one
  // environment months later.
  const envPrefix = envPrefixFor(subdomain);
  if (!/^[A-Z][A-Z0-9_]*$/.test(envPrefix)) {
    return {
      ok: false,
      message:
        `Subdomain "${subdomain}" derives the env prefix "${envPrefix}", ` +
        "which is not a valid environment variable name. It must start " +
        "with a letter.",
    };
  }

  return { ok: true, subdomain, envPrefix };
}

export type EmailCheck = { ok: true; email: string } | { ok: false; message: string };

// Deliberately not RFC 5322. A full parser accepts addresses no mail
// provider will deliver to, and the real check is that an invitation
// arrives. This catches the typo class: missing @, missing domain, no
// dot in the domain, spaces.
export function validateAdminEmail(raw: string): EmailCheck {
  const email = raw.trim();
  if (email.length === 0) {
    return { ok: false, message: "--admin-email is required." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return {
      ok: false,
      message: `"${email}" is not a valid email address.`,
    };
  }
  return { ok: true, email };
}

// Everything provisioning needs before it starts. Each name is
// reported individually when missing, because "some config is
// missing" sends someone reading source and "VERCEL_PROJECT_ID is
// missing" does not.
export const REQUIRED_CONFIG: readonly string[] = [
  "SUPABASE_MANAGEMENT_TOKEN",
  "VERCEL_TOKEN",
  "VERCEL_PROJECT_ID",
  "CONTROL_PLANE_SUPABASE_URL",
  "CONTROL_PLANE_SUPABASE_SERVICE_KEY",
];

export function missingConfig(
  env: Record<string, string | undefined>
): string[] {
  return REQUIRED_CONFIG.filter((name) => {
    const value = env[name];
    return !value || value.trim().length === 0;
  });
}
