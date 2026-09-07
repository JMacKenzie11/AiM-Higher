// A thin typed client over the Supabase Management API.
//
// fetch is injected so the tests can drive every branch without a
// network, and so nothing here needs a live token to be exercised.

export const MANAGEMENT_BASE_URL = "https://api.supabase.com";

// The status a project reports once it is actually usable. Everything
// else — COMING_UP, INACTIVE, UNKNOWN, RESTORING — means "not yet, or
// not ever".
export const HEALTHY_STATUS = "ACTIVE_HEALTHY";

export type ManagementProject = {
  id: string;
  name: string;
  region: string;
  status: string;
  organization_id?: string;
};

export type ManagementApiKey = {
  name: string;
  api_key: string;
  // "legacy" | "publishable" | "secret". The discriminator that
  // matters: both new-format keys are named "default". See
  // pickApiKeys in state.ts.
  type?: string;
};

export type Organization = { id: string; name: string };

// Carries the status and body, because a Management API failure is
// almost always explained by its body and almost never by its status
// alone.
export class ManagementApiError extends Error {
  // Plain fields rather than TypeScript parameter properties: these
  // files run under node --experimental-strip-types, which removes
  // types without generating code and so cannot expand
  // `constructor(readonly x: string)`.
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly body: string;

  constructor(method: string, path: string, status: number, body: string) {
    super(
      `Supabase Management API ${method} ${path} failed: ${status}\n${body}`
    );
    this.name = "ManagementApiError";
    this.method = method;
    this.path = path;
    this.status = status;
    this.body = body;
  }
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export type ManagementClient = {
  listOrganizations: () => Promise<Organization[]>;
  listProjects: () => Promise<ManagementProject[]>;
  getProject: (ref: string) => Promise<ManagementProject | null>;
  createProject: (input: {
    name: string;
    organizationId: string;
    region: string;
    dbPass: string;
  }) => Promise<ManagementProject>;
  getApiKeys: (ref: string) => Promise<ManagementApiKey[]>;
};

export function createManagementClient(opts: {
  token: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}): ManagementClient {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const baseUrl = opts.baseUrl ?? MANAGEMENT_BASE_URL;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new ManagementApiError(method, path, response.status, text);
    }
    return (text.length > 0 ? JSON.parse(text) : null) as T;
  }

  return {
    listOrganizations: () => request<Organization[]>("GET", "/v1/organizations"),
    listProjects: () => request<ManagementProject[]>("GET", "/v1/projects"),

    async getProject(ref) {
      // A project that is not there yet reads as 404 while the
      // platform catches up; treat it as "not found", not as an error.
      try {
        return await request<ManagementProject>("GET", `/v1/projects/${ref}`);
      } catch (error) {
        if (error instanceof ManagementApiError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },

    createProject: (input) =>
      request<ManagementProject>("POST", "/v1/projects", {
        name: input.name,
        organization_id: input.organizationId,
        region: input.region,
        db_pass: input.dbPass,
      }),

    async getApiKeys(ref) {
      // reveal=true returns the secret values rather than metadata.
      // Older deployments of the API ignore the parameter rather than
      // rejecting it, so one call covers both.
      return request<ManagementApiKey[]>(
        "GET",
        `/v1/projects/${ref}/api-keys?reveal=true`
      );
    },
  };
}

// ---- Naming ---------------------------------------------------

// One convention, used both to create and to recognise. Idempotency
// depends on these being the same function.
export function projectNameFor(subdomain: string): string {
  return `aims-higher-${subdomain}`;
}

// ---- Waiting for a project to come up -------------------------

export class ProjectNotHealthyError extends Error {
  readonly ref: string;
  readonly lastStatus: string;
  readonly waitedMs: number;

  constructor(ref: string, lastStatus: string, waitedMs: number) {
    super(
      `Project ${ref} was still "${lastStatus}" after ` +
        `${Math.round(waitedMs / 1000)}s.`
    );
    this.name = "ProjectNotHealthyError";
    this.ref = ref;
    this.lastStatus = lastStatus;
    this.waitedMs = waitedMs;
  }
}

export const DEFAULT_HEALTH_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_HEALTH_INTERVAL_MS = 10 * 1000;

// Polls until the project reports ACTIVE_HEALTHY, or gives up.
//
// Clock and sleep are injected, so the tests run the real loop —
// including the timeout — in microseconds rather than ten minutes.
export async function waitForHealthy(opts: {
  ref: string;
  getStatus: () => Promise<string>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  onTick?: (status: string, elapsedMs: number) => void;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_HEALTH_INTERVAL_MS;
  const started = opts.now();

  // Checked before the first sleep: a project that is already healthy
  // (the resume case) must not wait an interval to say so.
  for (;;) {
    const status = await opts.getStatus();
    const elapsed = opts.now() - started;
    opts.onTick?.(status, elapsed);
    if (status === HEALTHY_STATUS) return status;
    if (elapsed >= timeoutMs) {
      throw new ProjectNotHealthyError(opts.ref, status, elapsed);
    }
    await opts.sleep(intervalMs);
  }
}
