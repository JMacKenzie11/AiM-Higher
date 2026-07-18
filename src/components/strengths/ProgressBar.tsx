export default function ProgressBar({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  const pct = total === 0 ? 0 : Math.min(100, (current / total) * 100);
  return (
    <div className="stack-2">
      <div className="progress" aria-label={`Progress: ${current} of ${total}`}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="caption tabular">{current} of {total}</div>
    </div>
  );
}
