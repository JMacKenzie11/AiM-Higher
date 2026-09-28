// THE THREE DIRECTIONS FOR AIMEE'S ICON (docs/investigations/aimee-panel.md,
// "The icon"). Drawn at 44px, the size of the "?" help button they
// would replace, from brand tokens only, so each works in light and
// dark mode. Jason picks one on /admin/agents/aimee-icons; the others
// are deleted then.
//
// Colours come from tokens: --primary (cobalt), --aims-sky,
// --aims-sky-tint, --aims-chartreuse, --aims-white, --aims-navy.

type IconProps = { size?: number };

// 1. A soft "A": a rounded capital on a sky-tint circle, with a small
//    chartreuse spark at its shoulder. Closest to the "?" it replaces.
export function AimeeIconA({ size = 44 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="22" fill="var(--aims-sky-tint)" />
      <path
        d="M14.5 31 L22 12.5 L29.5 31 M17.4 24.4 H26.6"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M31 9.5 l1.2 2.8 2.8 1.2 -2.8 1.2 -1.2 2.8 -1.2 -2.8 -2.8 -1.2 2.8 -1.2 z" fill="var(--aims-chartreuse)" />
    </svg>
  );
}

// 2. The logo's three rising bars inside a speech bubble: "a
//    conversation" and "AiMS" at once.
export function AimeeIconBubble({ size = 44 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="22" fill="var(--primary)" />
      <path
        d="M12 13.5 h20 a3 3 0 0 1 3 3 v11 a3 3 0 0 1 -3 3 h-10 l-5 4 v-4 h-5 a3 3 0 0 1 -3 -3 v-11 a3 3 0 0 1 3 -3 z"
        fill="var(--aims-white)"
      />
      <rect x="15.5" y="22" width="3.4" height="5.5" rx="1.2" fill="var(--aims-sky)" />
      <rect x="20.3" y="19" width="3.4" height="8.5" rx="1.2" fill="var(--primary)" />
      <rect x="25.1" y="16.5" width="3.4" height="11" rx="1.2" fill="var(--aims-chartreuse)" />
    </svg>
  );
}

// 3. A friendly face, kept abstract and calm: two dots and a short
//    curve in cobalt on white, with a sky ring.
export function AimeeIconFace({ size = 44 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="22" fill="var(--aims-sky)" />
      <circle cx="22" cy="22" r="18" fill="var(--aims-white)" />
      <circle cx="16.5" cy="19.5" r="2.1" fill="var(--primary)" />
      <circle cx="27.5" cy="19.5" r="2.1" fill="var(--primary)" />
      <path d="M15.5 25.5 q6.5 5.5 13 0" fill="none" stroke="var(--primary)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export const AIMEE_ICON_OPTIONS = [
  { key: "a", name: "A soft “A”", Icon: AimeeIconA },
  { key: "bubble", name: "Bars in a speech bubble", Icon: AimeeIconBubble },
  { key: "face", name: "A friendly face", Icon: AimeeIconFace },
] as const;
