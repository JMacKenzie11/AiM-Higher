import Link from "next/link";

type CoachingSummary = {
  hasConversation: boolean;
  exchangeCount: number;
  lastActivity: string | null;
  lastAssistantMessage: string | null;
};

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

export default function CoachingSummaryCard({
  firstName,
  summary,
}: {
  firstName: string;
  summary: CoachingSummary;
}) {
  const relative = relativeTime(summary.lastActivity);
  const preview = summary.lastAssistantMessage?.trim();

  return (
    <section className="card stack-3">
      <div className="card-header">
        <h2 className="chartreuse-underline">Your coach</h2>
        <span className="caption">Private to you</span>
      </div>
      {summary.exchangeCount === 0 ? (
        <>
          <p style={{ margin: 0 }}>
            Talk anything through with your coach. What surprised you, what
            you want to build on, or where you'd like to spend your energy.
            No admin can read it.
          </p>
          <div>
            <Link href="/coach" className="btn btn-primary lg">
              Start a conversation
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            {summary.exchangeCount}{" "}
            {summary.exchangeCount === 1 ? "exchange" : "exchanges"} so far
            {relative ? ` · last activity ${relative}` : ""}.
          </p>
          {preview && (
            <blockquote
              style={{
                margin: 0,
                borderLeft: "3px solid var(--aims-chartreuse)",
                paddingLeft: 12,
                color: "var(--text-muted)",
                fontStyle: "italic",
              }}
            >
              {preview.length > 240
                ? preview.slice(0, 240).trim() + "…"
                : preview}
            </blockquote>
          )}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Link href="/coach" className="btn btn-primary lg">
              Continue the conversation
            </Link>
          </div>
          <p
            className="caption"
            style={{ margin: 0, marginTop: "var(--space-4)" }}
          >
            {firstName}, the thread stays open. Pick it up any time.
          </p>
        </>
      )}
    </section>
  );
}
