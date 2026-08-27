"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useRef, useState } from "react";
import styles from "./ImageEmbedNodeView.module.css";

// In-editor rendering of an image node. Shows the actual image plus
// a bottom-right drag handle for resizing. Width is stored as a
// percentage of the editor container so a resized image reads the
// same on the consumer side. Aspect ratio is preserved (height:auto).
//
// Only the corner handle is exposed. A single control is enough for
// the "make it smaller / bigger" use case authors care about; drag
// handles on all four sides would be over-engineered for a lesson
// body.

const MIN_WIDTH_PCT = 15;
const MAX_WIDTH_PCT = 100;

export function ImageEmbedNodeView({
  node,
  updateAttributes,
  selected,
}: NodeViewProps) {
  const src = (node.attrs.src as string) ?? "";
  const alt = (node.attrs.alt as string | null) ?? "";
  const width = (node.attrs.width as number | null) ?? 100;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  function onHandlePointerDown(e: React.PointerEvent<HTMLSpanElement>) {
    e.preventDefault();
    e.stopPropagation();
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    // Base measurements taken from the block that contains the
    // NodeView so we resolve "percent of container" correctly no
    // matter where the image lives.
    const containerEl = wrapper.parentElement;
    if (!containerEl) return;
    const containerRect = containerEl.getBoundingClientRect();
    const startX = e.clientX;
    const startWidthPx = wrapper.getBoundingClientRect().width;
    setDragging(true);

    function onMove(ev: PointerEvent) {
      const delta = ev.clientX - startX;
      const newWidthPx = Math.max(60, startWidthPx + delta);
      const pct = Math.round((newWidthPx / containerRect.width) * 100);
      const clamped = Math.min(
        MAX_WIDTH_PCT,
        Math.max(MIN_WIDTH_PCT, pct)
      );
      updateAttributes({ width: clamped });
    }

    function onUp() {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function setPreset(pct: number) {
    updateAttributes({ width: pct });
  }

  return (
    <NodeViewWrapper
      className={`${styles.wrap} ${selected ? styles.wrapSelected : ""} ${
        dragging ? styles.wrapDragging : ""
      }`}
      style={{ width: `${width}%` }}
      data-drag-handle
    >
      <div className={styles.imageBox} ref={wrapperRef}>
        {src ? (
          <img
            className={styles.image}
            src={src}
            alt={alt}
            draggable={false}
          />
        ) : (
          <div className={styles.placeholder}>Image missing src</div>
        )}
        {selected ? (
          <>
            <div className={styles.presetBar}>
              <button
                type="button"
                className={styles.presetButton}
                onClick={() => setPreset(33)}
                title="Small (33%)"
              >
                S
              </button>
              <button
                type="button"
                className={styles.presetButton}
                onClick={() => setPreset(66)}
                title="Medium (66%)"
              >
                M
              </button>
              <button
                type="button"
                className={styles.presetButton}
                onClick={() => setPreset(100)}
                title="Full width"
              >
                L
              </button>
            </div>
            <span
              className={styles.resizeHandle}
              onPointerDown={onHandlePointerDown}
              aria-label="Resize image"
              role="slider"
              aria-valuenow={width}
              aria-valuemin={MIN_WIDTH_PCT}
              aria-valuemax={MAX_WIDTH_PCT}
            />
          </>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}
