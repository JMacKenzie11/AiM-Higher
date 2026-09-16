"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
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
import { reorderCompaniesAction } from "@/lib/admin/company-order-actions";
import type { CompanyOverviewRow } from "@/lib/admin/companies-service";
import styles from "./admin.module.css";

// Drag-to-reorder for the companies list. Mirrors IssuesBoard's
// pattern — pointer + keyboard sensors, closestCenter collision,
// verticalListSortingStrategy, optimistic local order, revert on
// failure — so there is one way this gesture works in the product
// rather than two.
//
// THE ORDER IS THE INSTANCE'S, NOT THE VIEWER'S. It persists to
// companies.sort_order (0203) and everyone who lists companies reads
// it. Alphabetical was an accident of spelling: "1 - Promise One"
// sorts first here because somebody prefixed it with a digit, which
// is what people do when the only ordering available is one they
// cannot change.
//
// The rows render as children rather than being built here. The cells
// are server-rendered — they carry links, chips and a progress bar —
// and lifting them into a client component to gain a drag handle
// would drag the whole subtree across the boundary with them.

export function CompaniesTable({
  companies,
  canReorder,
  header,
  renderRow,
}: {
  companies: CompanyOverviewRow[];
  canReorder: boolean;
  header: ReactNode;
  renderRow: (company: CompanyOverviewRow, handle: ReactNode) => ReactNode;
}) {
  const [order, setOrder] = useState(companies);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Take the server's order verbatim unless a drop is still in
  // flight, in which case the optimistic order stands until it
  // returns. Same rule as IssuesBoard, and for the same reason:
  // props change on every unrelated edit to this page.
  useEffect(() => {
    if (pending) return;
    setOrder(companies);
  }, [companies, pending]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.findIndex((c) => c.id === active.id);
    const newIndex = order.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(order, oldIndex, newIndex);
    const previous = order;
    setOrder(next);
    setError(null);
    startTransition(async () => {
      const result = await reorderCompaniesAction(next.map((c) => c.id));
      if (!result.ok) {
        setOrder(previous);
        setError(result.message);
      }
    });
  }

  // One company cannot be out of order, so it gets no handle and no
  // column. The user asked for this explicitly, and it is also the
  // honest rendering: a drag affordance on a list of one is a control
  // that cannot do anything.
  const sortable = canReorder && order.length > 1;

  const table = (
    <table className={styles.table}>
      <thead>
        <tr>
          {sortable ? (
            /* Empty and labelled, rather than carrying hidden text.
               This codebase has no visually-hidden utility, and
               inventing one for a single column header is a worse
               trade than an aria-label on an empty cell. Each handle
               below names the company it moves. */
            <th className={styles.dragHead} aria-label="Reorder" />
          ) : null}
          {header}
        </tr>
      </thead>
      <tbody>
        {order.map((company) =>
          sortable ? (
            <SortableCompanyRow key={company.id} company={company}>
              {renderRow}
            </SortableCompanyRow>
          ) : (
            <tr key={company.id}>{renderRow(company, null)}</tr>
          )
        )}
      </tbody>
    </table>
  );

  if (!sortable) return table;

  return (
    <>
      {error ? <p className={styles.errorMessage}>{error}</p> : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={order.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {table}
        </SortableContext>
      </DndContext>
    </>
  );
}

function SortableCompanyRow({
  company,
  children,
}: {
  company: CompanyOverviewRow;
  children: (
    company: CompanyOverviewRow,
    handle: ReactNode
  ) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: company.id });

  const handle = (
    <button
      type="button"
      className={styles.dragHandle}
      aria-label={`Reorder ${company.name}`}
      {...attributes}
      {...listeners}
    >
      <span aria-hidden="true">⠿</span>
    </button>
  );

  return (
    <tr
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      data-dragging={isDragging ? "true" : undefined}
    >
      <td className={styles.dragCell}>{handle}</td>
      {children(company, handle)}
    </tr>
  );
}
