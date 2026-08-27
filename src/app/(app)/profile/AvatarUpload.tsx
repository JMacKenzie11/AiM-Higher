"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  removeAvatarAction,
  uploadAvatarAction,
} from "@/lib/people/actions";
import styles from "./AvatarUpload.module.css";

// Avatar upload with Facebook-style pan+zoom inside a circular mask.
//
// Flow:
//   1. User clicks "Change photo" → hidden file input opens.
//   2. On file pick, we load the image into an offscreen <img>, open
//      the modal, and let the user drag/zoom to position within a
//      circular viewport.
//   3. On Save, we render the visible circle to a canvas at a fixed
//      output size (512x512) and hand the resulting Blob to the
//      server action. The server writes to storage + updates the
//      profile row + returns the public URL.
//
// Only the visible region ends up on the server — we crop client-side
// so the round-trip payload is a small square PNG, not the original
// 4000x3000 photo.

const OUTPUT_SIZE_PX = 512;
const VIEWPORT_SIZE_PX = 260;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

export function AvatarUpload({
  currentUrl,
  fullName,
}: {
  currentUrl: string | null;
  fullName: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [editing, setEditing] = useState<{
    imageEl: HTMLImageElement;
    src: string;
    naturalWidth: number;
    naturalHeight: number;
  } | null>(null);

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessage(null);
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setEditing({
        imageEl: img,
        src,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(src);
      setMessage({ ok: false, text: "Couldn't read that image." });
    };
    img.src = src;
    // Reset the input so choosing the same file again re-triggers.
    e.target.value = "";
  }

  function cancelEdit() {
    if (editing) URL.revokeObjectURL(editing.src);
    setEditing(null);
  }

  function saveCrop(blob: Blob) {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", new File([blob], "avatar.png", { type: "image/png" }));
      const result = await uploadAvatarAction(fd);
      if (result.ok) {
        if (editing) URL.revokeObjectURL(editing.src);
        setEditing(null);
        setMessage({ ok: true, text: "Photo updated." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  function remove() {
    setMessage(null);
    startTransition(async () => {
      const result = await removeAvatarAction();
      if (result.ok) {
        setMessage({ ok: true, text: "Photo removed." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.message });
      }
    });
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.previewRow}>
        <AvatarPreview url={currentUrl} fullName={fullName} />
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => inputRef.current?.click()}
            disabled={pending}
          >
            {currentUrl ? "Change photo" : "Add photo"}
          </button>
          {currentUrl ? (
            <button
              type="button"
              className={styles.ghostButton}
              onClick={remove}
              disabled={pending}
            >
              Remove photo
            </button>
          ) : null}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={onFilePicked}
          />
        </div>
      </div>

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={message.ok ? styles.successMessage : styles.errorMessage}
        >
          {message.text}
        </p>
      ) : null}

      {editing ? (
        <CropModal
          image={editing.imageEl}
          naturalWidth={editing.naturalWidth}
          naturalHeight={editing.naturalHeight}
          pending={pending}
          onCancel={cancelEdit}
          onSave={saveCrop}
        />
      ) : null}
    </div>
  );
}

function AvatarPreview({
  url,
  fullName,
}: {
  url: string | null;
  fullName: string;
}) {
  const initials = getInitials(fullName);
  return (
    <div className={styles.avatarCircle}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className={styles.avatarImage} />
      ) : (
        <span className={styles.avatarInitials}>{initials}</span>
      )}
    </div>
  );
}

function CropModal({
  image,
  naturalWidth,
  naturalHeight,
  pending,
  onCancel,
  onSave,
}: {
  image: HTMLImageElement;
  naturalWidth: number;
  naturalHeight: number;
  pending: boolean;
  onCancel: () => void;
  onSave: (blob: Blob) => void;
}) {
  // The smallest side of the image, scaled to fit exactly into the
  // circular viewport at zoom=1. Zoom multiplies from there. Larger
  // zoom = larger displayed image = smaller region ends up in the
  // final crop.
  const baseScale = useMemo(() => {
    const w = VIEWPORT_SIZE_PX / naturalWidth;
    const h = VIEWPORT_SIZE_PX / naturalHeight;
    return Math.max(w, h);
  }, [naturalWidth, naturalHeight]);

  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);

  // Clamp so the image always covers the circular viewport — no
  // white margins allowed to sneak in.
  function clampOffset(next: { x: number; y: number }, zoomVal: number) {
    const scale = baseScale * zoomVal;
    const scaledW = naturalWidth * scale;
    const scaledH = naturalHeight * scale;
    const maxX = Math.max(0, (scaledW - VIEWPORT_SIZE_PX) / 2);
    const maxY = Math.max(0, (scaledH - VIEWPORT_SIZE_PX) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }

  useEffect(() => {
    // Re-clamp when zoom changes so the offset stays valid.
    setOffset((cur) => clampOffset(cur, zoom));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (pending) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    const startOffset = offset;
    (e.target as Element).setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      const next = {
        x: startOffset.x + (ev.clientX - start.x),
        y: startOffset.y + (ev.clientY - start.y),
      };
      setOffset(clampOffset(next, zoom));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (pending) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)));
  }

  function commit() {
    // Render the currently visible circular region to a canvas.
    // The image is drawn at scale = baseScale * zoom, translated so
    // the viewport centre aligns with (image centre + offset).
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE_PX;
    canvas.height = OUTPUT_SIZE_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scale = baseScale * zoom;
    const scaledW = naturalWidth * scale;
    const scaledH = naturalHeight * scale;
    // Top-left of the displayed image within the viewport frame.
    const displayLeft = (VIEWPORT_SIZE_PX - scaledW) / 2 + offset.x;
    const displayTop = (VIEWPORT_SIZE_PX - scaledH) / 2 + offset.y;
    // The corresponding source (natural) rectangle to sample.
    const sx = -displayLeft / scale;
    const sy = -displayTop / scale;
    const sSize = VIEWPORT_SIZE_PX / scale;

    ctx.imageSmoothingQuality = "high";
    // Draw the source rectangle to the full output square. No round
    // mask on the canvas — the img element on the reader side is
    // wrapped in a circular container, so a square crop is what we
    // need (also lets a caller reuse the same file if they want the
    // square version).
    ctx.drawImage(
      image,
      sx,
      sy,
      sSize,
      sSize,
      0,
      0,
      OUTPUT_SIZE_PX,
      OUTPUT_SIZE_PX
    );

    canvas.toBlob(
      (blob) => {
        if (blob) onSave(blob);
      },
      "image/png",
      0.92
    );
  }

  return (
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-label="Position your photo"
    >
      <div className={styles.modal}>
        <h3 className={styles.modalTitle}>Position your photo</h3>
        <p className={styles.modalHint}>
          Drag to reposition. Use the slider or scroll to zoom.
        </p>
        <div
          ref={stageRef}
          className={styles.cropStage}
          style={{
            width: VIEWPORT_SIZE_PX,
            height: VIEWPORT_SIZE_PX,
          }}
          onPointerDown={onPointerDown}
          onWheel={onWheel}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.src}
            alt=""
            draggable={false}
            className={styles.cropImage}
            style={{
              width: naturalWidth * baseScale * zoom,
              height: naturalHeight * baseScale * zoom,
              transform: `translate(${offset.x}px, ${offset.y}px)`,
            }}
          />
          <div className={styles.circleMask} aria-hidden="true" />
        </div>

        <div className={styles.zoomRow}>
          <span className={styles.zoomLabel}>Zoom</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            disabled={pending}
            className={styles.zoomSlider}
            aria-label="Zoom"
          />
        </div>

        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={commit}
            disabled={pending}
          >
            {pending ? "Saving…" : "Save photo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
