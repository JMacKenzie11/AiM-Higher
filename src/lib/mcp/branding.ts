// AiMS's own brand, for AI apps that make something in AiMS's name
// (aims_branding; Jason, 2026-11-18). AiMS HQ stores no client
// branding, so this is AiMS's alone. The colours are the brand palette
// in brand/tokens.css; the files are the ones under public/brand; the
// tagline is the site's own description (app/layout.tsx).

export const AIMS_TAGLINE = "Leadership simplified. Results amplified.";

export const AIMS_COLOURS = [
  { name: "Navy", hex: "#1F3352", use: "Primary brand colour: headlines and the logo" },
  { name: "Cobalt", hex: "#3551A4", use: "Primary action and interactive elements" },
  { name: "Sky", hex: "#8CC4DF", use: "Secondary accent: shapes and fills" },
  { name: "Chartreuse", hex: "#D6E264", use: "Primary accent: underlines and highlights" },
  { name: "Midnight", hex: "#11151A", use: "Body text and the darkest surface" },
  { name: "Sand", hex: "#F7F7F2", use: "Light background" },
  { name: "White", hex: "#FFFFFF", use: "Cards and surfaces" },
] as const;

const LOGOS = [
  { name: "AiMS Higher logo, colour", path: "/brand/aimshigher-logo-color.svg", for: "light backgrounds" },
  { name: "AiMS Higher logo, colour (PNG)", path: "/brand/aimshigher-logo-color.png", for: "light backgrounds" },
  { name: "AiMS Higher logo, white", path: "/brand/aimshigher-logo-white.svg", for: "dark backgrounds" },
  { name: "AiMS logo", path: "/brand/aims-logo.png", for: "light backgrounds" },
  { name: "AiMS HQ logo, white", path: "/brand/aims-hq-logo-white.png", for: "dark backgrounds" },
] as const;

export function aimsBranding(origin: string) {
  return {
    brand: "AiMS",
    tagline: AIMS_TAGLINE,
    typeface: "Inter",
    colours: AIMS_COLOURS,
    logos: LOGOS.map((l) => ({ name: l.name, url: `${origin}${l.path}`, for: l.for })),
    client_branding: "AiMS HQ doesn't hold client logos or colours.",
  };
}
