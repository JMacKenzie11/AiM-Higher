import { STATUS_LABEL, type RunStatus } from "@/lib/workers/types";
import styles from "./workers.module.css";

export function RunStatusChip({ status }: { status: RunStatus }) {
  const tone =
    status === "done" ? styles.chipDone : status === "failed" ? styles.chipFailed : status === "stopped" ? "" : styles.chipWorking;
  return <span className={`${styles.chip} ${tone}`}>{STATUS_LABEL[status]}</span>;
}
