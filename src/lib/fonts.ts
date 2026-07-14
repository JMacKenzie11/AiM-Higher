import { Inter, Figtree } from "next/font/google";

// Inter — headings, ALL CAPS labels, buttons, stats/numeric.
// Maps to --font-sans (see tokens.css).
export const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--next-font-inter",
});

// Figtree — body copy, descriptions, nav, table text, form values.
// Maps to --font-body (see tokens.css).
export const figtree = Figtree({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
  variable: "--next-font-figtree",
});
