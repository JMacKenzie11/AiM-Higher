"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { reorderFunctionsAction } from "@/lib/chart/actions";
import type { ChartFunction } from "@/lib/chart/service";
import { FunctionDrawer } from "./FunctionDrawer";
import styles from "./chart.module.css";

// Draggable chart tree. One SortableContext per parent (root list
// plus one per parent's children). Non-admins get a static tree —
// same visual, no drag handles, so the read view stays identical.
//
// It also owns the function drawer, because it owns the cards that
// open it. A card click opens the panel for anyone who can edit;
// everyone else keeps the link to the read-only detail page.

export function DraggableTree({
  roots,
  canReorder,
  canEdit,
}: {
  roots: ChartFunction[];
  canReorder: boolean;
  // Separate from canReorder on purpose. They are the same answer
  // today, and a chart that is readable-but-not-draggable is a
  // plausible next state; the card's behaviour should follow the
  // edit right, not the drag one.
  canEdit: boolean;
}) {
  const [tree, setTree] = useState(roots);
  const [openFunctionId, setOpenFunctionId] = useState<string | null>(null);

  // The tree lives in state so a drag can move a card before the
  // server has agreed. That state ignored `roots` forever after
  // mount, which was survivable while the only writer was a drag
  // (it already had the new order) and is not now: renaming a
  // function in the drawer refreshes the RSC tree behind it, and
  // without this the card underneath kept the old name until a
  // full reload.
  useEffect(() => {
    setTree(roots);
  }, [roots]);

  const setChildrenAtPath = (
    path: string[],
    reorder: (children: ChartFunction[]) => ChartFunction[]
  ) => {
    setTree((prev) => {
      const walk = (nodes: ChartFunction[], depth: number): ChartFunction[] => {
        if (depth === path.length) {
          return reorder(nodes);
        }
        return nodes.map((n) =>
          n.id === path[depth]
            ? { ...n, children: walk(n.children, depth + 1) }
            : n
        );
      };
      return walk(prev, 0);
    });
  };

  return (
    <>
      <ul className={`${styles.treeBranch} ${styles.treeBranchRoot}`}>
        <SortableSiblings
          siblings={tree}
          canReorder={canReorder}
          onReorder={(next) => setTree(next)}
        >
          {tree.map((fn) => (
            <FunctionBranch
              key={fn.id}
              fn={fn}
              canReorder={canReorder}
              canEdit={canEdit}
              onOpen={setOpenFunctionId}
              path={[fn.id]}
              setChildrenAtPath={setChildrenAtPath}
            />
          ))}
        </SortableSiblings>
      </ul>
      <FunctionDrawer
        functionId={openFunctionId}
        onClose={() => setOpenFunctionId(null)}
        onSwitch={setOpenFunctionId}
      />
    </>
  );
}

function FunctionBranch({
  fn,
  canReorder,
  canEdit,
  onOpen,
  path,
  setChildrenAtPath,
}: {
  fn: ChartFunction;
  canReorder: boolean;
  canEdit: boolean;
  onOpen: (id: string) => void;
  path: string[];
  setChildrenAtPath: (
    path: string[],
    reorder: (children: ChartFunction[]) => ChartFunction[]
  ) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: fn.id, disabled: !canReorder });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className={styles.treeNode}>
      <FunctionBox
        fn={fn}
        canReorder={canReorder}
        canEdit={canEdit}
        onOpen={onOpen}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
      {fn.children.length > 0 ? (
        <ul className={styles.treeBranch}>
          <SortableSiblings
            siblings={fn.children}
            canReorder={canReorder}
            onReorder={(next) =>
              setChildrenAtPath(path, () => next)
            }
          >
            {fn.children.map((child) => (
              <FunctionBranch
                key={child.id}
                fn={child}
                canReorder={canReorder}
                canEdit={canEdit}
                onOpen={onOpen}
                path={[...path, child.id]}
                setChildrenAtPath={setChildrenAtPath}
              />
            ))}
          </SortableSiblings>
        </ul>
      ) : null}
    </li>
  );
}

// A DnD context + SortableContext that wraps one row of siblings and
// fires the reorder server action on drop. Rendered whether or not
// the caller is an admin — when disabled the sensors never fire, so
// nothing moves and no network call goes out.
function SortableSiblings({
  siblings,
  canReorder,
  onReorder,
  children,
}: {
  siblings: ChartFunction[];
  canReorder: boolean;
  onReorder: (next: ChartFunction[]) => void;
  children: React.ReactNode;
}) {
  const [, startTransition] = useTransition();
  const items = useMemo(() => siblings.map((s) => s.id), [siblings]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = siblings.findIndex((s) => s.id === active.id);
    const newIndex = siblings.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(siblings, oldIndex, newIndex);
    onReorder(next);

    startTransition(() => {
      void reorderFunctionsAction(
        next.map((n, i) => ({ id: n.id, sort_order: i }))
      );
    });
  };

  if (!canReorder) return <>{children}</>;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={items} strategy={horizontalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

function FunctionBox({
  fn,
  canReorder,
  canEdit,
  onOpen,
  dragHandleProps,
}: {
  fn: ChartFunction;
  canReorder: boolean;
  canEdit: boolean;
  onOpen: (id: string) => void;
  dragHandleProps: Record<string, unknown>;
}) {
  const body = <FunctionCardBody fn={fn} />;

  return (
    <div className={styles.fnCardShell}>
      {canReorder ? (
        <button
          type="button"
          // `chart-no-pan` opts the button out of the PanZoomTree
          // wrapper's pan trigger — otherwise dnd-kit's reorder
          // drag and react-zoom-pan-pinch's pan drag would fight
          // for the same pointer stream.
          className={`${styles.fnDragHandle} chart-no-pan`}
          aria-label={`Drag to reorder ${fn.title}`}
          title="Drag to reorder"
          {...dragHandleProps}
        >
          ⋮⋮
        </button>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          // `chart-no-pan` for the same reason the drag handle
          // carries it: a click that opens a panel and a drag that
          // pans the canvas are one pointer stream until something
          // says otherwise.
          className={`${styles.fnCardButton} chart-no-pan`}
          onClick={() => onOpen(fn.id)}
          aria-haspopup="dialog"
          aria-label={`Edit ${fn.title}`}
          data-testid="function-card-button"
        >
          {body}
        </button>
      ) : (
        <Link href={`/chart/function/${fn.id}`} className={styles.fnCardLink}>
          {body}
        </Link>
      )}
    </div>
  );
}

function FunctionCardBody({ fn }: { fn: ChartFunction }) {
  return (
    <article className={styles.fnCard}>
      <header className={styles.fnHeader}>
        <h3 className={styles.fnTitle}>{fn.title}</h3>
      </header>
      <div className={styles.fnSeat}>
        <span className={styles.fnSeatLabel}>Seat</span>
        <span
          className={
            fn.seatHolder
              ? styles.fnSeatName
              : `${styles.fnSeatName} ${styles.fnSeatEmpty}`
          }
        >
          {fn.seatHolder?.full_name ?? "Unassigned"}
        </span>
      </div>
      {fn.roles.length > 0 ? (
        <div className={styles.outcomeBlock}>
          <p className={styles.outcomeLabel}>Roles & Responsibilities</p>
          <ul className={styles.outcomeList}>
            {fn.roles.map((r) => (
              <li key={r.id} className={styles.outcomeItem}>
                {r.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
