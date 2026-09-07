// A thin typed client over the Vercel REST API.
//
// fetch is injected, so every branch is testable without a network or
// a token.

export const VERCEL_BASE_URL = "https://api.vercel.com";

// Vercel's own vocabulary, kept verbatim rather than renamed:
//   encrypted — stored encrypted, readable back with ?decrypt=true
//   sensitive — write-only; the API will never return the value
//   plain     — stored and returned as-is
export type VercelEnvType = "encrypted" | "sensitive" | "plain";

export type VercelEnvVar = {
  id: string;
  key: string;
  value?: string;
  type: VercelEnvType;
  target?: string[];
};

export type VercelDeployment = {
  uid?: string;
  id?: string;
  url?: string;
  readyState?: string;
  state?: string;
  created?: number;
  createdAt?: number;
  target?: string | null;
};

export class VercelApiError extends Error {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly body: string;

  constructor(method: string, path: string, status: number, body: string) {
    super(`Vercel API ${method} ${path} failed: ${status}\n${body}`);
    this.name = "VercelApiError";
    this.method = method;
    this.path = path;
    this.status = status;
    this.body = body;
  }
}

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export type VercelClient = {
  getProject: () => Promise<{ id: string; name: string }>;
  // Values come back for encrypted vars; a sensitive var's value is
  // never returned, by design.
  listEnv: () => Promise<VercelEnvVar[]>;
  createEnv: (input: {
    key: string;
    value: string;
    type: VercelEnvType;
    target: string[];
  }) => Promise<unknown>;
  updateEnv: (
    id: string,
    input: { value: string; type: VercelEnvType; target: string[] }
  ) => Promise<unknown>;
  latestProductionDeployment: () => Promise<VercelDeployment | null>;
  redeploy: (input: {
    name: string;
    deploymentId: string;
  }) => Promise<VercelDeployment>;
  getDeployment: (id: string) => Promise<VercelDeployment>;
};

export function createVercelClient(opts: {
  token: string;
  projectId: string;
  teamId?: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}): VercelClient {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const baseUrl = opts.baseUrl ?? VERCEL_BASE_URL;

  // Every endpoint takes teamId the same way when the token belongs to
  // a team, so append it in one place.
  const withTeam = (path: string) => {
    if (!opts.teamId) return path;
    return `${path}${path.includes("?") ? "&" : "?"}teamId=${opts.teamId}`;
  };

  async function request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${withTeam(path)}`, {
      method,
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new VercelApiError(method, path, response.status, text);
    }
    return (text.length > 0 ? JSON.parse(text) : null) as T;
  }

  return {
    getProject: () =>
      request<{ id: string; name: string }>(
        "GET",
        `/v9/projects/${opts.projectId}`
      ),

    async listEnv() {
      const result = await request<{ envs: VercelEnvVar[] }>(
        "GET",
        `/v9/projects/${opts.projectId}/env?decrypt=true`
      );
      return result.envs ?? [];
    },

    createEnv: (input) =>
      request("POST", `/v10/projects/${opts.projectId}/env`, input),

    updateEnv: (id, input) =>
      request("PATCH", `/v9/projects/${opts.projectId}/env/${id}`, input),

    async latestProductionDeployment() {
      const result = await request<{ deployments: VercelDeployment[] }>(
        "GET",
        `/v6/deployments?projectId=${opts.projectId}&target=production&limit=1`
      );
      return result.deployments?.[0] ?? null;
    },

    redeploy: (input) =>
      request<VercelDeployment>("POST", "/v13/deployments", {
        name: input.name,
        deploymentId: input.deploymentId,
        target: "production",
        meta: { action: "redeploy" },
      }),

    getDeployment: (id) =>
      request<VercelDeployment>("GET", `/v13/deployments/${id}`),
  };
}

// ---- Waiting for a deployment ---------------------------------

export const DEPLOYMENT_READY = "READY";
// Vercel's terminal failure states. Anything else is still in flight.
export const DEPLOYMENT_FAILED = ["ERROR", "CANCELED", "DELETED"];

export const DEFAULT_DEPLOY_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_DEPLOY_INTERVAL_MS = 10 * 1000;

export class DeploymentFailedError extends Error {
  readonly id: string;
  readonly state: string;

  constructor(id: string, state: string) {
    super(`Deployment ${id} ended in state ${state}.`);
    this.name = "DeploymentFailedError";
    this.id = id;
    this.state = state;
  }
}

export class DeploymentTimeoutError extends Error {
  readonly id: string;
  readonly lastState: string;

  constructor(id: string, lastState: string, waitedMs: number) {
    super(
      `Deployment ${id} was still "${lastState}" after ` +
        `${Math.round(waitedMs / 1000)}s.`
    );
    this.name = "DeploymentTimeoutError";
    this.id = id;
    this.lastState = lastState;
  }
}

// Polls until READY, or fails fast on a terminal failure state rather
// than waiting out the timeout for a deployment that is already dead.
export async function waitForDeployment(opts: {
  id: string;
  getState: () => Promise<string>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  onTick?: (state: string, elapsedMs: number) => void;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_DEPLOY_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_DEPLOY_INTERVAL_MS;
  const started = opts.now();

  for (;;) {
    const state = await opts.getState();
    const elapsed = opts.now() - started;
    opts.onTick?.(state, elapsed);
    if (state === DEPLOYMENT_READY) return state;
    if (DEPLOYMENT_FAILED.includes(state)) {
      throw new DeploymentFailedError(opts.id, state);
    }
    if (elapsed >= timeoutMs) {
      throw new DeploymentTimeoutError(opts.id, state, elapsed);
    }
    await opts.sleep(intervalMs);
  }
}

// ---- The env-var comparison -----------------------------------

export type EnvPlanEntry = {
  key: string;
  type: VercelEnvType;
  // "create" | "update" | "skip"
  action: "create" | "update" | "skip";
  existingId?: string;
  reason: string;
};

// Decide what to do with one variable.
//
// COMPARISON IS BY FINGERPRINT, NOT BY VALUE, and that is forced.
// Vercel does not hand back a readable value for anything:
//
//   type=sensitive  → value is ""      (by design; that is the point)
//   type=encrypted  → value is the CIPHERTEXT, a ~1100 character
//                     base64 blob, and ?decrypt=true does not change
//                     that
//
// Measured against the real project, after an earlier version of this
// function compared plaintext against that ciphertext, never matched,
// and would therefore have rewritten production config on every single
// run — the opposite of idempotent, and silent about it.
//
// So the fingerprint of what we last wrote, recorded in the
// provisioning state file, is the only thing there is to compare.
//
// Worth being precise about what that does and does not prove. It says
// the value has not changed SINCE WE WROTE IT. It does not say the
// value currently in Vercel is the one we think: someone editing it in
// the dashboard is invisible here. The alternative — rewriting all
// three on every run — is worse, because it is a write to production
// config that learns nothing and makes every run look like a change.
export function planEnvVar(args: {
  key: string;
  desiredValue: string;
  type: VercelEnvType;
  existing?: VercelEnvVar;
  // The fingerprint recorded when we last wrote THIS key.
  recordedFingerprint?: string;
  fingerprintOf: (value: string) => string;
}): EnvPlanEntry {
  const { key, existing, type } = args;

  if (!existing) {
    return { key, type, action: "create", reason: "not set" };
  }

  const desired = args.fingerprintOf(args.desiredValue);
  if (args.recordedFingerprint === desired) {
    return {
      key,
      type,
      action: "skip",
      existingId: existing.id,
      reason: "unchanged since we wrote it",
    };
  }

  return {
    key,
    type,
    action: "update",
    existingId: existing.id,
    reason: args.recordedFingerprint
      ? "value changed"
      : "set outside provisioning — rewriting to be certain",
  };
}
