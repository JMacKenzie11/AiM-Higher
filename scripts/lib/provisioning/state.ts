import { randomBytes } from "node:crypto";

// What provisioning knows about an instance it has built, kept on disk
// under .provisioning-state/{subdomain}.json.
//
// This file exists for one reason: the database password is shown once
// by the Management API and can never be retrieved again, and the
// migration step needs it. Losing it means the project has to be
// recreated. So it is written before anything else can fail.
//
// It also makes a rerun cheap. Provisioning is a sequence of remote
// creations, and the thing that turns "step 5 failed" from a disaster
// into an inconvenience is knowing what steps 1 to 4 already made.
//
// The directory is gitignored. It holds a database password and
// service-role keys.

export type InstanceState = {
  subdomain: string;
  projectName?: string;
  projectRef?: string;
  region?: string;
  apiUrl?: string;
  dbPassword?: string;
  anonKey?: string;
  serviceKey?: string;
  // The highest migration version applied to this instance.
  migrationVersion?: string;
  seededAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export const STATE_DIR = ".provisioning-state";

export function stateFileFor(subdomain: string, dir: string = STATE_DIR): string {
  return `${dir}/${subdomain}.json`;
}

// Merge rather than replace, so a partial rerun cannot drop a value an
// earlier run recorded — losing dbPassword in particular is
// unrecoverable.
export function mergeState(
  previous: InstanceState | null,
  next: Partial<InstanceState>,
  nowIso: string
): InstanceState {
  const merged: InstanceState = {
    ...(previous ?? {}),
    ...stripUndefined(next),
    subdomain: next.subdomain ?? previous?.subdomain ?? "",
    updatedAt: nowIso,
  };
  if (!merged.createdAt) merged.createdAt = nowIso;
  return merged;
}

function stripUndefined(value: Partial<InstanceState>): Partial<InstanceState> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as Partial<InstanceState>;
}

// A password for the project's postgres role.
//
// base64url on purpose. The password ends up inside a connection URI
// for the migration step, and the base64 alphabet's "+" and "/" — plus
// the ":", "@", "?" and "#" a generic generator might produce — either
// need escaping or silently truncate the URI. base64url's alphabet is
// A-Z a-z 0-9 - _ and needs none of that.
export function generateDbPassword(bytes: number = 32): string {
  return randomBytes(bytes).toString("base64url");
}

// Which of a project's keys to record.
//
// A project created today exposes FOUR keys, not two, and the name
// does not tell them apart:
//
//   name=anon          type=legacy       eyJhbGci…  (JWT)
//   name=service_role  type=legacy       eyJhbGci…  (JWT)
//   name=default       type=publishable  sb_publishable_…
//   name=default       type=secret       sb_secret_…
//
// Both new keys are called "default", so `type` is the discriminator
// and matching on name cannot work. Measured against a real project
// (aims-higher-provtest1), not assumed — an earlier version of this
// function matched on name and quietly recorded the legacy JWTs.
//
// New format is preferred because that is what production already
// runs on and because the legacy JWT keys are on their way out. The
// name fallback is for older projects that predate the new format and
// expose only the two legacy keys.
export function pickApiKeys(
  keys: ReadonlyArray<{ name: string; api_key: string; type?: string }>
): { anonKey?: string; serviceKey?: string } {
  const byType = (type: string) =>
    keys.find((k) => k.type === type)?.api_key;
  const byName = (name: string) => keys.find((k) => k.name === name)?.api_key;

  return {
    anonKey: byType("publishable") ?? byName("anon"),
    serviceKey: byType("secret") ?? byName("service_role"),
  };
}
