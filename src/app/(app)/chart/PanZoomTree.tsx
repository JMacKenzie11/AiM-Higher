"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  TransformWrapper,
  TransformComponent,
  useControls,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import styles from "./chart.module.css";

// Pan-and-zoom canvas for the org chart. Standard org-chart UX —
// scroll wheel or +/- to zoom, click-and-drag on empty space to
// pan, click the fit-to-view control to snap back to the full
// tree. Handles arbitrarily wide/deep trees without clipping and
// without shrinking cards past readability.
//
// dnd-kit vs pan interaction:
//   Card drag handles opt out of pan (see the `chart-no-pan` class
//   on the handle button in DraggableTree). That way clicking-and-
//   dragging the drag-handle triggers dnd-kit's PointerSensor for
//   reorder; dragging anywhere else on the canvas pans the whole
//   tree. Card body clicks still fire because pan requires
//   movement — a click without drag lets the underlying <Link>
//   navigate to the function detail page.

// Breathing room around the tree when we auto-fit so cards don't
// press against the pan/zoom controls or the card edges.
const FIT_PADDING = 32;

function fitToView(api: ReactZoomPanPinchRef) {
  const wrapper = api.instance.wrapperComponent;
  const content = api.instance.contentComponent;
  if (!wrapper || !content) return;
  const cW = wrapper.clientWidth;
  const cH = wrapper.clientHeight;
  // offsetWidth/Height report the layout box, unaffected by CSS
  // transform — so we get the tree's true (pre-scale) size even if
  // the user has already zoomed.
  const nW = content.offsetWidth;
  const nH = content.offsetHeight;
  if (!cW || !cH || !nW || !nH) return;
  const scale = Math.min(
    (cW - FIT_PADDING * 2) / nW,
    (cH - FIT_PADDING * 2) / nH,
    1
  );
  const x = (cW - nW * scale) / 2;
  const y = (cH - nH * scale) / 2;
  api.setTransform(x, y, scale, 0);
}

export function PanZoomTree({ children }: { children: ReactNode }) {
  const ref = useRef<ReactZoomPanPinchRef>(null);

  const doFit = useCallback(() => {
    if (ref.current) fitToView(ref.current);
  }, []);

  // Fit on mount and on container resize. The library's built-in
  // centerOnInit only centres — it doesn't scale — so a wide tree
  // lands clipped. Double rAF lets React commit and the browser
  // lay out before we measure.
  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(doFit);
    });
    const wrapper = ref.current?.instance.wrapperComponent;
    const observer = wrapper ? new ResizeObserver(() => doFit()) : null;
    if (wrapper && observer) observer.observe(wrapper);
    return () => {
      cancelAnimationFrame(raf1);
      observer?.disconnect();
    };
  }, [doFit]);

  return (
    <TransformWrapper
      ref={ref}
      minScale={0.15}
      maxScale={2}
      initialScale={1}
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
      <PanZoomInner onFit={doFit}>{children}</PanZoomInner>
    </TransformWrapper>
  );
}

function PanZoomInner({
  children,
  onFit,
}: {
  children: ReactNode;
  onFit: () => void;
}) {
  return (
    <div className={styles.panZoomFrame}>
      <PanZoomControls onFit={onFit} />
      <TransformComponent
        wrapperClass={styles.panZoomWrapper}
        contentClass={styles.panZoomContent}
      >
        {children}
      </TransformComponent>
    </div>
  );
}

function PanZoomControls({ onFit }: { onFit: () => void }) {
  // useControls only works inside TransformWrapper — this is the
  // library's way of exposing zoom actions to arbitrary sibling
  // components without prop-drilling refs.
  const { zoomIn, zoomOut } = useControls();
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
        onClick={onFit}
        aria-label="Fit to view"
        title="Fit to view"
        className={`${styles.panZoomButton} chart-no-pan`}
      >
        ⤢
      </button>
    </div>
  );
}
