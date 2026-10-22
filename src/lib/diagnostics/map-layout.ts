import type { MapPoint } from "./hours-back";

// Where each dot sits on the Capacity Map. Energy runs left to right
// (1 drains, 5 energizes), judgment bottom to top (1 routine, 5 needs
// experience). Dots on the same square are spread in a small ring, the
// same work kept next to itself, so the owner sees "quoting" as one
// cluster rather than nine specks on top of each other.

export const MAP = { width: 600, height: 440, left: 56, right: 16, top: 16, bottom: 48 } as const;

export type PlacedDot = MapPoint & { cx: number; cy: number; r: number };

const plotW = MAP.width - MAP.left - MAP.right;
const plotH = MAP.height - MAP.top - MAP.bottom;

export function xFor(energy: number): number {
  return MAP.left + ((energy - 0.5) / 5) * plotW;
}

export function yFor(judgment: number): number {
  return MAP.top + plotH - ((judgment - 0.5) / 5) * plotH;
}

export function radiusFor(hours: number): number {
  return Math.min(22, 4 + Math.sqrt(Math.max(0, hours)) * 3);
}

export function layoutMap(points: readonly MapPoint[]): PlacedDot[] {
  const bySquare = new Map<string, MapPoint[]>();
  for (const p of points) {
    const k = `${p.energy}:${p.judgment}`;
    bySquare.set(k, [...(bySquare.get(k) ?? []), p]);
  }
  const out: PlacedDot[] = [];
  for (const list of bySquare.values()) {
    // Same work together: the points arrive sorted by canonical title.
    list.forEach((p, i) => {
      const angle = (i / Math.max(1, list.length)) * Math.PI * 2;
      const ring = list.length === 1 ? 0 : Math.min(30, 10 + list.length * 2);
      out.push({ ...p, cx: xFor(p.energy) + Math.cos(angle) * ring, cy: yFor(p.judgment) + Math.sin(angle) * ring, r: radiusFor(p.hours) });
    });
  }
  // Big dots first, so small ones are drawn on top and stay visible.
  return out.sort((a, b) => b.r - a.r);
}
