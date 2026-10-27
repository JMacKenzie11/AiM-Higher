// Workers (0303): the rows, as the pages read them.

export type RunStatus = "queued" | "running" | "needs_you" | "done" | "failed" | "stopped" | "expired";

export type Worker = {
  id: string;
  name: string;
  instructions: string;
  allow_presses: boolean;
  browser_context_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkerRun = {
  id: string;
  worker_id: string;
  task: string;
  status: RunStatus;
  browser_session_id: string | null;
  result: string | null;
  error: string | null;
  step_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd_cents: number;
  last_url: string | null;
  pending: Pending | null;
  asked_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type WorkerStep = {
  id: string;
  run_id: string;
  seq: number;
  kind: "note" | "action";
  tool: string | null;
  summary: string;
  is_error: boolean;
  created_at: string;
};

export const WORKER_COLUMNS = "id, name, instructions, allow_presses, browser_context_id, archived_at, created_at, updated_at";
export const RUN_COLUMNS =
  "id, worker_id, task, status, browser_session_id, result, error, step_count, input_tokens, output_tokens, cost_usd_cents, last_url, pending, asked_at, started_at, finished_at, created_at";
export const STEP_COLUMNS = "id, run_id, seq, kind, tool, summary, is_error, created_at";

export const NAME_MAX = 120;
export const INSTRUCTIONS_MAX = 32768;
export const TASK_MAX = 4000;

export function isActive(status: RunStatus): boolean {
  return status === "queued" || status === "running";
}

// ---- Waiting on the owner (step 2) ----------------------------------
//
// A task stops to ask its owner something, or to ask before it presses
// a button that changes something on a website. It keeps the
// conversation so far (worker_runs.conversation) and what it is waiting
// for here, closes its browser, and carries on when the owner answers.
// A question waits 24 hours.

export const QUESTION_HOURS = 24;

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };

export type Pending =
  | {
      kind: "question";
      text: string;
      // Set when the worker asked for a password: the answer is saved
      // under this name and never reaches the conversation.
      password_for: string | null;
      tool_use_id: string;
      done: unknown[];
      rest: ToolCall[];
      answer?: { text: string } | { saved_password: string };
    }
  | {
      kind: "approval";
      action: string;
      domain: string;
      always_asks: boolean;
      call: ToolCall;
      done: unknown[];
      rest: ToolCall[];
      decision?: "once" | "always" | "deny";
    };

export function questionExpired(askedAt: string | null, now = Date.now()): boolean {
  if (!askedAt) return false;
  return now - new Date(askedAt).getTime() > QUESTION_HOURS * 3_600_000;
}

export type WorkerRule = { id: string; worker_id: string; kind: "press"; domain: string; decision: "allow" | "ask"; created_at: string };
export type WorkerMemory = { id: string; worker_id: string; title: string; body: string; created_at: string; updated_at: string };
export type WorkerSkill = { id: string; worker_id: string; title: string; body: string; source_run_id: string | null; created_at: string; updated_at: string };
export type WorkerSecret = { id: string; worker_id: string; label: string; created_at: string; updated_at: string };

export const RULE_COLUMNS = "id, worker_id, kind, domain, decision, created_at";
export const MEMORY_COLUMNS = "id, worker_id, title, body, created_at, updated_at";
export const SKILL_COLUMNS = "id, worker_id, title, body, source_run_id, created_at, updated_at";
export const SECRET_COLUMNS = "id, worker_id, label, created_at, updated_at";

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Starting",
  running: "Working",
  needs_you: "Needs you",
  done: "Done",
  failed: "Stopped with a problem",
  stopped: "Stopped",
  expired: "Question expired",
};

// The starting text for a new worker's instructions: the four parts the
// worker reads on every task.
export const INSTRUCTIONS_TEMPLATE = `## Job

What this worker does, in a sentence or two.

## Checklist

1. The first thing that must be true when it's finished.

## Rules

- Anything it can't find out by itself: which website, what to skip.

## Reply

How you want the answer: a short list, a table, a sentence.
`;
