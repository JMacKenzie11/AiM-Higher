"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
} from "react";
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
import { reorderSfasAction } from "@/lib/plan/actions";
import styles from "./plan.module.css";

// Drag-to-reorder for the focus areas on /plan (Jason, 2026-11-12:
// "with drag handles like in the rest of the app"). The same pattern
// as CompaniesTable and IssuesBoard: pointer and keyboard sensors,
// an optimistic order, and the server's order taken back whenever no
// drop is in flight.
//
// THE CARDS ARE RENDERED ON THE SERVER AND PASSED IN. Each one is a
// <details> full of server components and forms, and none of that
// can move into a client file. So the card arrives as a node, this
// wraps it in the sortable element, and the handle, which has to sit
// inside the card's <summary>, picks up its listeners through
// context (SfaDragHandle below).

type Item = { id: string; card: ReactNode };

type HandleProps = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

// Null outside a sortable list: a reader who cannot reorder, or a
// plan with one focus area, gets no handle at all.
const HandleContext = createContext<HandleProps | null>(null);

export function SortableSfaList({
  items,
  canReorder,
}: {
  items: Item[];
  canReorder: boolean;
}) {
  const [order, setOrder] = useState(items);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // The server's order and the server's cards, unless a drop is
  // still being saved.
  useEffect(() => {
    if (pending) return;
    setOrder(items);
  }, [items, pending]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.findIndex((item) => item.id === active.id);
    const newIndex = order.findIndex((item) => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(order, oldIndex, newIndex);
    const previous = order;
    setOrder(next);
    setError(null);
    startTransition(async () => {
      const result = await reorderSfasAction(next.map((item) => item.id));
      if (!result.ok) {
        setOrder(previous);
        setError(result.message);
      }
    });
  }

  // One focus area cannot be out of order.
  const sortable = canReorder && order.length > 1;
  if (!sortable) {
    return (
      <>
        {order.map((item) => (
          <div key={item.id}>{item.card}</div>
        ))}
      </>
    );
  }

  return (
    <>
      {error ? (
        <p role="alert" className={styles.reorderError}>
          {error}
        </p>
      ) : null}
      {/* A fixed id: dnd-kit numbers its screen-reader description
          per context, and the number differs between the server's
          render and the browser's. */}
      <DndContext
        id="plan-focus-area-order"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={order.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          {order.map((item) => (
            <SortableSfa key={item.id} item={item} />
          ))}
        </SortableContext>
      </DndContext>
    </>
  );
}

function SortableSfa({ item }: { item: Item }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        // Translate, not Transform: cards differ in height, and the
        // scale half of Transform would stretch one to its
        // neighbour's size while it travels.
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        position: "relative",
        zIndex: isDragging ? 1 : undefined,
      }}
      data-dragging={isDragging ? "true" : undefined}
    >
      <HandleContext.Provider
        value={{ attributes, listeners, setActivatorNodeRef }}
      >
        {item.card}
      </HandleContext.Provider>
    </div>
  );
}

// The ⠿ handle, placed by the server-rendered card at the start of
// its <summary>. A click on it must not fold the card it sits in.
export function SfaDragHandle({ title }: { title: string }) {
  const handle = useContext(HandleContext);
  if (!handle) return null;
  return (
    <button
      type="button"
      ref={handle.setActivatorNodeRef}
      className={styles.sfaDragHandle}
      aria-label={`Reorder ${title}`}
      {...handle.attributes}
      {...handle.listeners}
      onClick={(event) => event.preventDefault()}
    >
      <span aria-hidden="true">⠿</span>
    </button>
  );
}
