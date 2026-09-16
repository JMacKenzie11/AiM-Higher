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
// THE CELLS ARRIVE AS RENDERED NODES, NOT AS A FUNCTION THAT MAKES
// THEM. The first version of this component took a `renderRow`
// callback so the server could keep owning the cells, and that is not
// a thing React allows: "Functions cannot be passed directly to
// Client Components unless you explicitly expose it by marking it
// with 'use server'." It typechecks, it lints, it builds, and it
// throws on every render of /admin/companies.
//
// A ReactNode crosses the boundary happily — it is already part of
// the RSC payload — so the server builds each row's cells and hands
// them over as data. The cells stay server-rendered, which was the
// point: they carry links, chips and a progress bar, and lifting
// them into this component to gain a drag handle would drag that
// whole subtree across with them.

export type CompanyRow = {
  id: string;
  name: string;
  /** The row's <td> cells, rendered on the server. */
  cells: ReactNode;
};

export function CompaniesTable({
  rows,
  canReorder,
  header,
}: {
  rows: CompanyRow[];
  canReorder: boolean;
  header: ReactNode;
}) {
  const [order, setOrder] = useState(rows);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Take the server's order verbatim unless a drop is still in
  // flight, in which case the optimistic order stands until it
  // returns. Same rule as IssuesBoard, and for the same reason:
  // props change on every unrelated edit to this page.
  useEffect(() => {
    if (pending) return;
    setOrder(rows);
  }, [rows, pending]);

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
        {order.map((row) =>
          sortable ? (
            <SortableCompanyRow key={row.id} row={row} />
          ) : (
            <tr key={row.id}>{row.cells}</tr>
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

function SortableCompanyRow({ row }: { row: CompanyRow }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.id });

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
      <td className={styles.dragCell}>
        <button
          type="button"
          className={styles.dragHandle}
          aria-label={`Reorder ${row.name}`}
          {...attributes}
          {...listeners}
        >
          <span aria-hidden="true">⠿</span>
        </button>
      </td>
      {row.cells}
    </tr>
  );
}
