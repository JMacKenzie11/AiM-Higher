"use client";

import { type ReactNode } from "react";
import {
  TransformWrapper,
  TransformComponent,
  useControls,
} from "react-zoom-pan-pinch";
import styles from "./chart.module.css";

// Pan-and-zoom canvas for the org chart. Standard org-chart UX —
// scroll wheel or +/- to zoom, click-and-drag on empty space to
// pan, click the fit-to-view control to snap back to the initial
// centred view. Handles arbitrarily wide/deep trees without
// clipping and without shrinking cards past readability.
//
// dnd-kit vs pan interaction:
//   Card drag handles opt out of pan (see the `chart-no-pan` class
//   on the handle button in DraggableTree). That way clicking-and-
//   dragging the drag-handle triggers dnd-kit's PointerSensor for
//   reorder; dragging anywhere else on the canvas pans the whole
//   tree. Card body clicks still fire because pan requires
//   movement — a click without drag lets the underlying <Link>
//   navigate to the function detail page.

export function PanZoomTree({ children }: { children: ReactNode }) {
  return (
    <TransformWrapper
      minScale={0.35}
      maxScale={2}
      initialScale={1}
      centerOnInit
      limitToBounds={false}
      wheel={{ step: 0.15 }}
      pinch={{ step: 5 }}
      doubleClick={{ disabled: true }}
      panning={{
        // Any element carrying `chart-no-pan` will not trigger a pan
        // on mousedown — used on the drag handle so dnd-kit gets a
        // clean pointer stream for reorder.
        excluded: ["chart-no-pan"],
      }}
    >
      <PanZoomInner>{children}</PanZoomInner>
    </TransformWrapper>
  );
}

function PanZoomInner({ children }: { children: ReactNode }) {
  return (
    <div className={styles.panZoomFrame}>
      <PanZoomControls />
      <TransformComponent
        wrapperClass={styles.panZoomWrapper}
        contentClass={styles.panZoomContent}
      >
        {children}
      </TransformComponent>
    </div>
  );
}

function PanZoomControls() {
  // useControls only works inside TransformWrapper — this is the
  // library's way of exposing zoom/pan actions to arbitrary
  // sibling components without prop-drilling refs.
  const { zoomIn, zoomOut, resetTransform, centerView } = useControls();
  return (
    <div className={styles.panZoomControls}>
      <button
        type="button"
        onClick={() => zoomIn()}
        aria-label="Zoom in"
        title="Zoom in"
        className={`${styles.panZoomButton} chart-no-pan`}
      >
        +
      </button>
      <button
        type="button"
        onClick={() => zoomOut()}
        aria-label="Zoom out"
        title="Zoom out"
        className={`${styles.panZoomButton} chart-no-pan`}
      >
        −
      </button>
      <button
        type="button"
        onClick={() => {
          resetTransform();
          centerView();
        }}
        aria-label="Reset view"
        title="Fit to view"
        className={`${styles.panZoomButton} chart-no-pan`}
      >
        ⤢
      </button>
    </div>
  );
}
