import { ImageResponse } from "next/og";

// Dynamically generated OpenGraph image for the landing page.
// Rendered at build time (edge runtime) using next/og's
// ImageResponse — no external asset needed. Brand navy → cobalt
// gradient, headline in white, chartreuse rule underneath.

export const runtime = "edge";
export const alt =
  "AiMS Higher™ · The operating system for the AiMS Approach";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Footer host is derived from NEXT_PUBLIC_APP_URL so a domain
// migration is a Vercel env var change, not a code push. Fallback
// matches the current production domain.
function siteHost(): string {
  try {
    return new URL(
      process.env.NEXT_PUBLIC_APP_URL ?? "https://aims-hq.com"
    ).host;
  } catch {
    return "aims-hq.com";
  }
}

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          background:
            "linear-gradient(135deg, #1F3352 0%, #2A4478 55%, #3551A4 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            opacity: 0.8,
          }}
        >
          AiMS Higher™
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div
            style={{
              fontSize: 76,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.05,
              maxWidth: 900,
            }}
          >
            Leadership Simplified. Results Amplified.
          </div>
          <div
            style={{
              width: 120,
              height: 4,
              borderRadius: 4,
              background:
                "linear-gradient(90deg, #D6E264 0%, #D6E264 60%, rgba(214,226,100,0.3) 100%)",
            }}
          />
          <div
            style={{
              fontSize: 26,
              fontWeight: 400,
              opacity: 0.85,
              maxWidth: 900,
              lineHeight: 1.4,
            }}
          >
            Turn your strategic plan into weekly commitments, track whether
            they actually happen, and coach your leaders along the way.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 20,
            opacity: 0.7,
          }}
        >
          {siteHost()}
        </div>
      </div>
    ),
    { ...size }
  );
}
