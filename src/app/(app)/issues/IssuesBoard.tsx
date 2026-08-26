"use client";

import { useEffect, useState, useTransition } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { reorderIssuesAction } from "@/lib/issues/actions";
import type { IssueWithCommitments } from "@/lib/issues/service";
import type { Priority, Profile } from "@/lib/types";
import { IssueCard } from "./IssueCard";
import styles from "./issues.module.css";

// Drag-to-reorder wrapper around the open issues list. Mirrors the
// pattern used by the Functional Chart's DraggableTree — pointer +
// keyboard sensors, closestCenter collision, verticalListSortingStrategy.
// After a drop, optimistically reorder locally then persist the full
// id sequence server-side. If persist fails, revert.

export function IssuesBoard({
  issues,
  roster,
  priorityOptions,
  functionalAreaOptions,
  todayIso,
  currentUserId,
  currentUserCompanyId,
  isAdmin,
}: {
  issues: IssueWithCommitments[];
  roster: Array<Pick<Profile, "id" | "full_name">>;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  functionalAreaOptions: Array<{ id: string; title: string }>;
  todayIso: string;
  currentUserId: string;
  currentUserCompanyId: string | null;
  isAdmin: boolean;
}) {
  const [order, setOrder] = useState(issues);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Resync the local order whenever the server hands us a new
  // issues array. Without this, useState(issues) only takes the
  // FIRST prop value; a newly-created issue arrives via
  // revalidatePath but the board stays showing the stale (empty)
  // list. Compare by the id sequence so drag-reorders don't trigger
  // a re-sync mid-drag from an incidental parent re-render.
  useEffect(() => {
    const localIds = order.map((i) => i.id).join(",");
    const serverIds = issues.map((i) => i.id).join(",");
    if (localIds !== serverIds) {
      setOrder(issues);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.findIndex((i) => i.id === active.id);
    const newIndex = order.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(order, oldIndex, newIndex);
    const previous = order;
    setOrder(next);
    setError(null);
    startTransition(async () => {
      const result = await reorderIssuesAction(next.map((i) => i.id));
      if (!result.ok) {
        setOrder(previous);
        setError(result.message);
      }
    });
  }

  if (order.length === 0) {
    return (
      <p className={styles.emptyLine}>
        No open issues. Add the first above.
      </p>
    );
  }

  return (
    <>
      {error ? (
        <p role="alert" className={styles.rowError}>
          {error}
        </p>
      ) : null}
      <div className={styles.columnHeader} role="row" aria-hidden="true">
        <span aria-hidden />
        <span>Issue</span>
        <span>What we want</span>
        <span>Commitment</span>
        <span>Assigned to</span>
        <span>Due date</span>
        <span aria-hidden />
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={order.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className={styles.issueList}>
            {order.map((issue) => (
              <SortableIssue
                key={issue.id}
                issue={issue}
                roster={roster}
                priorityOptions={priorityOptions}
                functionalAreaOptions={functionalAreaOptions}
                todayIso={todayIso}
                currentUserId={currentUserId}
                currentUserCompanyId={currentUserCompanyId}
                isAdmin={isAdmin}
                disabled={pending}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </>
  );
}

function SortableIssue({
  issue,
  roster,
  priorityOptions,
  functionalAreaOptions,
  todayIso,
  currentUserId,
  currentUserCompanyId,
  isAdmin,
  disabled,
}: {
  issue: IssueWithCommitments;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  functionalAreaOptions: Array<{ id: string; title: string }>;
  todayIso: string;
  currentUserId: string;
  currentUserCompanyId: string | null;
  isAdmin: boolean;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: issue.id, disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className={styles.issueListItem}>
      <IssueCard
        issue={issue}
        roster={roster}
        priorityOptions={priorityOptions}
        functionalAreaOptions={functionalAreaOptions}
        todayIso={todayIso}
        currentUserId={currentUserId}
        currentUserCompanyId={currentUserCompanyId}
        isAdmin={isAdmin}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </li>
  );
}
