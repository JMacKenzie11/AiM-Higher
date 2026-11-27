import localFont from "next/font/local";

// THE FONTS ARE IN THE REPO, not fetched from Google at build time.
//
// next/font/google downloaded both families on every build, and now
// and then the download failed: "An error occurred in `next/font`.
// TypeError: Cannot read properties of null (reading '1')", which
// failed CI and Vercel for reasons nothing to do with the change
// (Jason, 2026-11-27: it should not be able to fail a build). With the
// files here, a build never reaches Google. Pages already served the
// fonts from our own domain; that is unchanged.
//
// The files are Google Fonts' own Latin variable fonts, the same ones
// next/font/google was fetching (Inter v20, wght 400..800; Figtree v9,
// wght 300..700), both under the SIL Open Font License, which allows
// this. To update one, fetch the css2 URL for the family and range
// with a woff2 browser user agent and save its latin file here.

// Inter: headings, ALL CAPS labels, buttons, stats/numeric.
// Maps to --font-sans (see tokens.css).
export const inter = localFont({
  src: "./fonts/inter-latin-wght.woff2",
  weight: "400 800",
  style: "normal",
  display: "swap",
  variable: "--next-font-inter",
});

// Figtree: body copy, descriptions, nav, table text, form values.
// Maps to --font-body (see tokens.css).
export const figtree = localFont({
  src: "./fonts/figtree-latin-wght.woff2",
  weight: "300 700",
  style: "normal",
  display: "swap",
  variable: "--next-font-figtree",
});
