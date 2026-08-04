import styles from "../marketing.module.css";

type Row = {
  status: "kept" | "open" | "missed";
  clarity: "clear" | "unclear";
  description: string;
  owner: string;
  due: string;
};

const ROWS: Row[] = [
  {
    status: "kept",
    clarity: "clear",
    description: "Send operational data on trucking costs by Wed morning.",
    owner: "Shawn Warman",
    due: "Aug 6",
  },
  {
    status: "open",
    clarity: "clear",
    description: "Draft the Q4 pricing memo and share with leadership.",
    owner: "Jen Kim",
    due: "Fri",
  },
  {
    status: "open",
    clarity: "unclear",
    description: "Look into the driver retention question.",
    owner: "Marcus Delaney",
    due: "Fri",
  },
  {
    status: "missed",
    clarity: "clear",
    description: "Publish the safety incident recap to the crew.",
    owner: "Anna Ruiz",
    due: "Jul 25",
  },
];

export function CommitmentsListMock() {
  return (
    <div className={styles.commitMock} aria-hidden="true">
      <div className={styles.commitMockHead}>
        <span className={styles.commitMockTitle}>This week</span>
        <span className={styles.commitMockMeta}>4 commitments · 84% follow-through</span>
      </div>
      <ul className={styles.commitMockList}>
        {ROWS.map((r, i) => (
          <li key={i} className={styles.commitMockRow}>
            <ResolveCircle status={r.status} />
            <ClarityDot clarity={r.clarity} />
            <div className={styles.commitMockText}>
              <div className={styles.commitMockDesc}>{r.description}</div>
              <div className={styles.commitMockOwner}>{r.owner}</div>
            </div>
            <div className={styles.commitMockDue}>{r.due}</div>
            <StatusChip status={r.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResolveCircle({ status }: { status: Row["status"] }) {
  if (status === "kept") {
    return (
      <span className={styles.mockCircleKept}>
        <svg viewBox="0 0 16 16" width={12} height={12}>
          <path
            d="M4 8.5 L7 11.5 L12 5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (status === "missed") {
    return (
      <span className={styles.mockCircleMissed}>
        <svg viewBox="0 0 16 16" width={10} height={10}>
          <path
            d="M4 4 L12 12 M12 4 L4 12"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  return <span className={styles.mockCircleOpen} />;
}

function ClarityDot({ clarity }: { clarity: Row["clarity"] }) {
  return (
    <span
      className={
        clarity === "clear" ? styles.mockClarityClear : styles.mockClarityUnclear
      }
    />
  );
}

function StatusChip({ status }: { status: Row["status"] }) {
  const label = status === "kept" ? "Kept" : status === "missed" ? "Missed" : "Open";
  const className =
    status === "kept"
      ? styles.mockChipKept
      : status === "missed"
        ? styles.mockChipMissed
        : styles.mockChipOpen;
  return <span className={className}>{label}</span>;
}
