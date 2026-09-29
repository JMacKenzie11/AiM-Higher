type IconProps = { size?: number };

// AIMEE'S ICON: Jason's mark (brand/aimee/aimee-icon-white-128.png,
// 2026-09-29), white with a chartreuse smile, on a cobalt circle. It is
// the corner button that opens her panel.
//
// The PNG is 128px, so it stays sharp at the 44px button on a 3x
// screen. Decorative: the button carries the name ("Aimee").
export function AimeeIcon({ size = 44 }: IconProps) {
  const mark = Math.round(size * 0.7);
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--primary)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/aimee/aimee-icon-white-128.png" alt="" width={mark} height={mark} />
    </span>
  );
}
