import type { LeadAnalysisStatus } from "@/lib/lead-analysis/types";
import styles from "../admin/companies/admin.module.css";

const LABEL: Record<LeadAnalysisStatus, string> = {
  pending: "Queued",
  analyzing: "Analyzing",
  complete: "Ready",
  failed: "Failed",
};

export function StatusChip({ status }: { status: LeadAnalysisStatus }) {
  const cls =
    status === "complete" ? styles.chipActive : status === "failed" ? styles.chipExpired : styles.chipPending;
  return <span className={cls}>{LABEL[status]}</span>;
}
