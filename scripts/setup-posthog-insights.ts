// Creates (or updates) the starter set of PostHog dashboards and
// insights for AiMS HQ product analytics.
//
// Prereqs — set in .env.local:
//   POSTHOG_PERSONAL_API_KEY   Personal API Key from PostHog →
//                              Settings → Personal API keys.
//                              Scope: insight:write + dashboard:write
//                              + project:read.
//   POSTHOG_PROJECT_ID         Numeric project id, visible in the
//                              PostHog URL: us.posthog.com/project/12345
//   POSTHOG_HOST               Optional. Defaults to
//                              https://us.posthog.com. Set to
//                              https://eu.posthog.com for EU.
//
// Run:
//   npm run posthog:insights
//
// Idempotent: matches dashboards and insights by exact name and
// updates in place if they already exist. Safe to re-run whenever
// we want to iterate on the query or dashboard definitions.
//
// Assumption: the "company" group_type_index is 0. It becomes 0
// automatically when we call posthog.group("company", ...) for the
// first time (see src/lib/analytics/PostHogProvider.tsx). If a
// second group type gets added later, revisit the index literals in
// the account-health insights below.

type Insight = {
  name: string;
  description: string;
  query: unknown;
  dashboards?: string[]; // dashboard names to attach to
};

type Dashboard = {
  name: string;
  description: string;
};

const key = process.env.POSTHOG_PERSONAL_API_KEY;
const projectId = process.env.POSTHOG_PROJECT_ID;
const host = process.env.POSTHOG_HOST ?? "https://us.posthog.com";

if (!key) {
  console.error(
    "Missing POSTHOG_PERSONAL_API_KEY. Create one at PostHog → Settings → Personal API keys (scope: insight:write + dashboard:write + project:read) and add it to .env.local."
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

// ---- API helpers ------------------------------------------------

async function findExistingByName(
  resource: "insights" | "dashboards",
  name: string
): Promise<number | null> {
  const url = `${baseUrl}/${resource}/?search=${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers: authHeaders });
  if (!res.ok) {
    throw new Error(
      `List ${resource} failed (${res.status}): ${await res.text()}`
    );
  }
  const body = (await res.json()) as {
    results?: Array<{ id: number; name: string }>;
  };
  const match = body.results?.find((r) => r.name === name);
  return match ? match.id : null;
}

async function upsertDashboard(dashboard: Dashboard): Promise<number> {
  const existingId = await findExistingByName("dashboards", dashboard.name);
  const payload = JSON.stringify({
    name: dashboard.name,
    description: dashboard.description,
  });
  if (existingId) {
    const res = await fetch(`${baseUrl}/dashboards/${existingId}/`, {
      method: "PATCH",
      headers: authHeaders,
      body: payload,
    });
    if (!res.ok) {
      throw new Error(
        `Dashboard update failed (${res.status}): ${await res.text()}`
      );
    }
    console.log(`↻  Dashboard: ${dashboard.name}`);
    return existingId;
  }
  const res = await fetch(`${baseUrl}/dashboards/`, {
    method: "POST",
    headers: authHeaders,
    body: payload,
  });
  if (!res.ok) {
    throw new Error(
      `Dashboard create failed (${res.status}): ${await res.text()}`
    );
  }
  const body = (await res.json()) as { id: number };
  console.log(`✨ Dashboard: ${dashboard.name}`);
  return body.id;
}

async function upsertInsight(
  insight: Insight,
  dashboardIds: number[]
): Promise<void> {
  const existingId = await findExistingByName("insights", insight.name);
  const payload = JSON.stringify({
    name: insight.name,
    description: insight.description,
    query: insight.query,
    saved: true,
    dashboards: dashboardIds,
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
    console.log(`   ↻  ${insight.name}`);
    return;
  }
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
  console.log(`   ✨ ${insight.name}`);
}

// ---- Dashboard definitions --------------------------------------

const DASH_WEEKLY = "AiMS · Weekly product health";
const DASH_ACCOUNTS = "AiMS · Account health";
const DASH_GROWTH = "AiMS · Growth & onboarding";

const dashboards: Dashboard[] = [
  {
    name: DASH_WEEKLY,
    description:
      "The one dashboard to check every Monday morning. Is the product working? Adoption, follow-through, retention. If a curve is falling, dig into the account or growth dashboards.",
  },
  {
    name: DASH_ACCOUNTS,
    description:
      "Per-company activity so at-risk customers surface before they churn. Bottom of each table = accounts that need coaching or a check-in.",
  },
  {
    name: DASH_GROWTH,
    description:
      "Top-of-funnel and onboarding health. Are new users converting into active users? Are invites converting? What's the time-to-first-commitment?",
  },
];

// ---- Insight definitions ----------------------------------------
//
// Every insight uses the "AiMS · " prefix so they cluster in the
// project's Insights list. Each insight declares which dashboards
// it belongs to via the `dashboards` array.

const insights: Insight[] = [
  // ================================================================
  // WEEKLY PRODUCT HEALTH
  // ================================================================
  {
    name: "AiMS · Commitments created (daily)",
    description:
      "Daily count of commitment.created events. The core adoption metric — flat or declining = product isn't sticking.",
    dashboards: [DASH_WEEKLY],
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
    dashboards: [DASH_WEEKLY],
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
    dashboards: [DASH_WEEKLY],
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
    name: "AiMS · Resolution mix (kept-on-time vs late vs missed)",
    description:
      "Weekly breakdown of how commitments actually landed. High kept-on-time = disciplined execution; rising kept-late = timelines miscalibrated; rising missed = accountability breaking down.",
    dashboards: [DASH_WEEKLY],
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        dateRange: { date_from: "-84d" },
        interval: "week",
        series: [
          {
            kind: "EventsNode",
            event: "commitment.marked_kept",
            name: "Kept on time",
            math: "total",
            properties: [
              {
                key: "was_late",
                value: ["false"],
                operator: "exact",
                type: "event",
              },
            ],
          },
          {
            kind: "EventsNode",
            event: "commitment.marked_kept",
            name: "Kept late",
            math: "total",
            properties: [
              {
                key: "was_late",
                value: ["true"],
                operator: "exact",
                type: "event",
              },
            ],
          },
          {
            kind: "EventsNode",
            event: "commitment.marked_missed",
            name: "Missed",
            math: "total",
          },
        ],
        trendsFilter: {
          display: "ActionsBar",
        },
      },
    },
  },
  {
    name: "AiMS · Reschedule pressure",
    description:
      "Ratio of commitment.rescheduled to commitment.created, weekly. A rising ratio means people are over-committing, priorities are unclear, or the week isn't matching reality.",
    dashboards: [DASH_WEEKLY],
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        dateRange: { date_from: "-84d" },
        interval: "week",
        series: [
          {
            kind: "EventsNode",
            event: "commitment.rescheduled",
            name: "Rescheduled",
            math: "total",
          },
          {
            kind: "EventsNode",
            event: "commitment.created",
            name: "Created",
            math: "total",
          },
        ],
        trendsFilter: {
          formula: "A / B",
          display: "ActionsLineGraph",
        },
      },
    },
  },
  {
    name: "AiMS · Activation funnel (created → kept, 7 days)",
    description:
      "Of users who create their first commitment, what percent mark one kept within 7 days? The activation moment — if this is low, onboarding is broken.",
    dashboards: [DASH_WEEKLY, DASH_GROWTH],
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

  // ================================================================
  // ACCOUNT HEALTH
  // ================================================================
  //
  // Every insight here breaks down by $group_0 (the "company" group
  // type we register in PostHogProvider). Sort the resulting table
  // ascending to find the accounts that need attention first.

  {
    name: "AiMS · Per-company commitment volume (weekly)",
    description:
      "Table: commitments created per company per week. Bottom of the list = companies going quiet. Sort ascending; anything with two consecutive low weeks is worth an outreach.",
    dashboards: [DASH_ACCOUNTS],
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        dateRange: { date_from: "-28d" },
        interval: "week",
        series: [
          {
            kind: "EventsNode",
            event: "commitment.created",
            name: "Commitments created",
            math: "total",
          },
        ],
        breakdownFilter: {
          breakdown: "$group_0",
          breakdown_type: "group",
          breakdown_group_type_index: 0,
        },
        trendsFilter: {
          display: "ActionsTable",
        },
      },
    },
  },
  {
    name: "AiMS · Per-company follow-through rate (weekly)",
    description:
      "Table: kept ÷ (kept + missed) per company, weekly. Sub-40% = the account isn't running the accountability loop and needs coaching before they conclude the product doesn't work.",
    dashboards: [DASH_ACCOUNTS],
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        dateRange: { date_from: "-28d" },
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
        breakdownFilter: {
          breakdown: "$group_0",
          breakdown_type: "group",
          breakdown_group_type_index: 0,
        },
        trendsFilter: {
          formula: "A / (A + B)",
          display: "ActionsTable",
        },
      },
    },
  },
  {
    name: "AiMS · Per-company Aimee usage (weekly)",
    description:
      "Table: coach.message_sent per company, weekly. Zero across weeks = untapped value; a paying customer not using the coach is leaving the differentiator on the table.",
    dashboards: [DASH_ACCOUNTS],
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        dateRange: { date_from: "-28d" },
        interval: "week",
        series: [
          {
            kind: "EventsNode",
            event: "coach.message_sent",
            name: "Aimee messages",
            math: "total",
          },
        ],
        breakdownFilter: {
          breakdown: "$group_0",
          breakdown_type: "group",
          breakdown_group_type_index: 0,
        },
        trendsFilter: {
          display: "ActionsTable",
        },
      },
    },
  },
  {
    name: "AiMS · Per-company meeting intelligence (weekly)",
    description:
      "Table: meeting.analyzed per company, weekly. Zero = the transcript source isn't producing (paused, disconnected, or nobody's dropping files in the folder). Follow up with the operator.",
    dashboards: [DASH_ACCOUNTS],
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        dateRange: { date_from: "-28d" },
        interval: "week",
        series: [
          {
            kind: "EventsNode",
            event: "meeting.analyzed",
            name: "Meetings analyzed",
            math: "total",
          },
        ],
        breakdownFilter: {
          breakdown: "$group_0",
          breakdown_type: "group",
          breakdown_group_type_index: 0,
        },
        trendsFilter: {
          display: "ActionsTable",
        },
      },
    },
  },
  {
    name: "AiMS · Per-company active users (weekly)",
    description:
      "Table: unique users per company per week. Rising = adoption spreading inside the account (good). Falling to 1-2 = only the champion is using it; they can't carry it alone forever.",
    dashboards: [DASH_ACCOUNTS],
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        dateRange: { date_from: "-28d" },
        interval: "week",
        series: [
          {
            kind: "EventsNode",
            event: "$pageview",
            name: "Weekly active users",
            math: "dau",
          },
        ],
        breakdownFilter: {
          breakdown: "$group_0",
          breakdown_type: "group",
          breakdown_group_type_index: 0,
        },
        trendsFilter: {
          display: "ActionsTable",
        },
      },
    },
  },

  // ================================================================
  // GROWTH & ONBOARDING
  // ================================================================

  {
    name: "AiMS · New user activation (signed_in → first commitment, 7d)",
    description:
      "Of users who sign in, what percent create their first commitment within 7 days? If this is below ~60%, the empty-state / first-run experience isn't converting curiosity into action.",
    dashboards: [DASH_GROWTH],
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "FunnelsQuery",
        dateRange: { date_from: "-90d" },
        series: [
          {
            kind: "EventsNode",
            event: "user.signed_in",
            name: "Signed in",
          },
          {
            kind: "EventsNode",
            event: "commitment.created",
            name: "Created a commitment",
          },
        ],
        funnelsFilter: {
          funnelWindowInterval: 7,
          funnelWindowIntervalUnit: "day",
        },
      },
    },
  },
  {
    name: "AiMS · Invite conversion rate",
    description:
      "Ratio of invite.accepted to invite.sent per week. Below 40% means the invite email isn't landing (deliverability, spam, or the value prop in the copy) or the accept flow is broken.",
    dashboards: [DASH_GROWTH],
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        dateRange: { date_from: "-90d" },
        interval: "week",
        series: [
          {
            kind: "EventsNode",
            event: "invite.accepted",
            name: "Accepted",
            math: "total",
          },
          {
            kind: "EventsNode",
            event: "invite.sent",
            name: "Sent",
            math: "total",
          },
        ],
        trendsFilter: {
          formula: "A / B",
          display: "ActionsLineGraph",
        },
      },
    },
  },
  {
    name: "AiMS · Invite volume (sent + accepted)",
    description:
      "Absolute counts of invite.sent and invite.accepted per week. Use alongside the conversion-rate insight to distinguish 'low volume, high rate' (fine) from 'low volume, low rate' (nobody's sending, and the few that go out don't convert).",
    dashboards: [DASH_GROWTH],
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        dateRange: { date_from: "-90d" },
        interval: "week",
        series: [
          {
            kind: "EventsNode",
            event: "invite.sent",
            name: "Sent",
            math: "total",
          },
          {
            kind: "EventsNode",
            event: "invite.accepted",
            name: "Accepted",
            math: "total",
          },
        ],
      },
    },
  },
  {
    name: "AiMS · Weekly sign-in retention",
    description:
      "Cohort retention: of users who signed in in a given week, how many came back in each subsequent week? Falling early rows = churn; flat later rows = a stable core of committed users.",
    dashboards: [DASH_GROWTH],
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "RetentionQuery",
        dateRange: { date_from: "-56d" },
        retentionFilter: {
          period: "Week",
          totalIntervals: 8,
          targetEntity: {
            id: "user.signed_in",
            type: "events",
            name: "user.signed_in",
          },
          returningEntity: {
            id: "user.signed_in",
            type: "events",
            name: "user.signed_in",
          },
          retentionType: "retention_first_time",
        },
      },
    },
  },
  {
    name: "AiMS · Help hotspots (top pages people open help on)",
    description:
      "Breakdown of help.opened by pathname property. The top of the list is the page that confused users the most this week — a strong signal for what to redesign or add better empty-state copy to.",
    dashboards: [DASH_GROWTH],
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        dateRange: { date_from: "-28d" },
        interval: "week",
        series: [
          {
            kind: "EventsNode",
            event: "help.opened",
            name: "Help opened",
            math: "total",
          },
        ],
        breakdownFilter: {
          breakdown: "pathname",
          breakdown_type: "event",
        },
        trendsFilter: {
          display: "ActionsTable",
        },
      },
    },
  },
];

// ---- Runner -----------------------------------------------------

async function main(): Promise<void> {
  console.log(
    `Setting up ${dashboards.length} dashboards and ${insights.length} insights in project ${projectId}...\n`
  );

  // Dashboards first — insight upserts need the ids to attach to.
  const dashIdByName = new Map<string, number>();
  for (const d of dashboards) {
    try {
      const id = await upsertDashboard(d);
      dashIdByName.set(d.name, id);
    } catch (err) {
      console.error(`✗  Dashboard ${d.name}:`, err);
    }
  }

  console.log("");

  let failed = 0;
  for (const insight of insights) {
    const targetIds = (insight.dashboards ?? [])
      .map((name) => dashIdByName.get(name))
      .filter((id): id is number => typeof id === "number");
    try {
      await upsertInsight(insight, targetIds);
    } catch (err) {
      console.error(`✗  ${insight.name}:`, err);
      failed++;
    }
  }

  console.log(
    `\nDone. ${insights.length - failed} of ${insights.length} insights succeeded.`
  );
  console.log(
    `Open ${host}/project/${projectId}/dashboard to see the three "AiMS ·" dashboards.`
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
