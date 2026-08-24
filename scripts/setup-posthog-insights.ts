// Creates (or updates) the starter set of PostHog insights for
// AiMS HQ product analytics.
//
// Prereqs — set in .env.local:
//   POSTHOG_PERSONAL_API_KEY   Personal API Key from PostHog →
//                              Settings → Personal API keys.
//                              Scope: insight:write, project:read.
//   POSTHOG_PROJECT_ID         Numeric project id, visible in the
//                              PostHog URL: us.posthog.com/project/12345
//   POSTHOG_HOST               Optional. Defaults to
//                              https://us.posthog.com. Set to
//                              https://eu.posthog.com for EU.
//
// Run:
//   node --env-file=.env.local --experimental-strip-types \
//     scripts/setup-posthog-insights.ts
//
// Idempotent: matches by exact name and updates if an insight
// with that name already exists. Safe to re-run whenever we
// want to iterate on the query definitions.

type Insight = {
  name: string;
  description: string;
  query: unknown;
};

const key = process.env.POSTHOG_PERSONAL_API_KEY;
const projectId = process.env.POSTHOG_PROJECT_ID;
const host = process.env.POSTHOG_HOST ?? "https://us.posthog.com";

if (!key) {
  console.error(
    "Missing POSTHOG_PERSONAL_API_KEY. Create one at PostHog → Settings → Personal API keys (scope: insight:write + project:read) and add it to .env.local."
  );
  process.exit(1);
}
if (!projectId) {
  console.error(
    "Missing POSTHOG_PROJECT_ID. Find it in the URL when you're inside your project (us.posthog.com/project/<id>/home) and add it to .env.local."
  );
  process.exit(1);
}

const baseUrl = `${host}/api/projects/${projectId}`;
const authHeaders = {
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

async function findExistingByName(name: string): Promise<number | null> {
  const url = `${baseUrl}/insights/?search=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: authHeaders });
  if (!res.ok) {
    throw new Error(
      `List insights failed (${res.status}): ${await res.text()}`
    );
  }
  const body = (await res.json()) as {
    results?: Array<{ id: number; name: string }>;
  };
  const match = body.results?.find((r) => r.name === name);
  return match ? match.id : null;
}

async function upsertInsight(insight: Insight): Promise<void> {
  const existingId = await findExistingByName(insight.name);
  const payload = JSON.stringify({
    name: insight.name,
    description: insight.description,
    query: insight.query,
    saved: true,
  });

  if (existingId) {
    const res = await fetch(`${baseUrl}/insights/${existingId}/`, {
      method: "PATCH",
      headers: authHeaders,
      body: payload,
    });
    if (!res.ok) {
      throw new Error(
        `Update failed (${res.status}): ${await res.text()}`
      );
    }
    console.log(`↻  Updated: ${insight.name}`);
  } else {
    const res = await fetch(`${baseUrl}/insights/`, {
      method: "POST",
      headers: authHeaders,
      body: payload,
    });
    if (!res.ok) {
      throw new Error(
        `Create failed (${res.status}): ${await res.text()}`
      );
    }
    console.log(`✨ Created: ${insight.name}`);
  }
}

// ---- Insight definitions ----------------------------------------
// Every insight uses the "AiMS · " prefix so they're easy to find
// in the PostHog Insights list and don't collide with user-created
// insights.

const insights: Insight[] = [
  {
    name: "AiMS · Commitments created (daily)",
    description:
      "Daily count of commitment.created events. The core adoption metric — flat or declining = product isn't sticking.",
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        dateRange: { date_from: "-30d" },
        interval: "day",
        series: [
          {
            kind: "EventsNode",
            event: "commitment.created",
            name: "Commitments created",
            math: "total",
          },
        ],
      },
    },
  },
  {
    name: "AiMS · Follow-through rate (weekly)",
    description:
      "Ratio of commitment.marked_kept to (kept + missed), weekly. The core value proposition, quantified.",
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        dateRange: { date_from: "-90d" },
        interval: "week",
        series: [
          {
            kind: "EventsNode",
            event: "commitment.marked_kept",
            name: "Kept",
            math: "total",
          },
          {
            kind: "EventsNode",
            event: "commitment.marked_missed",
            name: "Missed",
            math: "total",
          },
        ],
        trendsFilter: {
          formula: "A / (A + B)",
          display: "ActionsLineGraph",
        },
      },
    },
  },
  {
    name: "AiMS · Weekly active by feature",
    description:
      "Unique users touching each core feature each week. Divergence between curves is diagnostic — one feature falling while others hold means the falling one needs attention.",
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        dateRange: { date_from: "-84d" },
        interval: "week",
        series: [
          {
            kind: "EventsNode",
            event: "commitment.created",
            name: "Created commitment",
            math: "dau",
          },
          {
            kind: "EventsNode",
            event: "commitment.marked_kept",
            name: "Marked kept",
            math: "dau",
          },
          {
            kind: "EventsNode",
            event: "coach.message_sent",
            name: "Sent Aimee message",
            math: "dau",
          },
          {
            kind: "EventsNode",
            event: "plan.viewed",
            name: "Viewed plan",
            math: "dau",
          },
        ],
      },
    },
  },
  {
    name: "AiMS · Activation funnel (created → kept, 7 days)",
    description:
      "Of users who create their first commitment, what percent mark one kept within 7 days? The activation moment — if this is low, onboarding is broken.",
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "FunnelsQuery",
        dateRange: { date_from: "-90d" },
        series: [
          {
            kind: "EventsNode",
            event: "commitment.created",
            name: "Created a commitment",
          },
          {
            kind: "EventsNode",
            event: "commitment.marked_kept",
            name: "Marked one kept",
          },
        ],
        funnelsFilter: {
          funnelWindowInterval: 7,
          funnelWindowIntervalUnit: "day",
        },
      },
    },
  },
];

async function main(): Promise<void> {
  console.log(`Setting up ${insights.length} insights in project ${projectId}...\n`);
  let failed = 0;
  for (const insight of insights) {
    try {
      await upsertInsight(insight);
    } catch (err) {
      console.error(`✗  ${insight.name}:`, err);
      failed++;
    }
  }
  console.log(
    `\nDone. ${insights.length - failed} of ${insights.length} succeeded.`
  );
  console.log(
    `Open ${host}/project/${projectId}/insights to see them (filter by "AiMS ·").`
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
