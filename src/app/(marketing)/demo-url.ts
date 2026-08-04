// Single source of truth for the "Book a demo" URL used across the
// marketing page. NEXT_PUBLIC_DEMO_URL wins when set; otherwise a
// mailto opens the visitor's mail client pre-filled with a subject
// so no anchor click sends them into a broken void.

export function demoUrl(): string {
  const configured = process.env.NEXT_PUBLIC_DEMO_URL?.trim();
  if (configured) return configured;
  return "mailto:hello@aimshigher.tools?subject=AiM%20Higher%20demo";
}
