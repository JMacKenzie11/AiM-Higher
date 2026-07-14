# AiMS Institute — Brand & UI System

Instructions for building any page of the AiMS assessment platform. Follow these on every screen: dashboards, forms, tables, admin views, course content, and PDF reports.

## Setup
- Import `tokens.css` at the app root. Use the CSS custom properties — never hardcode hex values in components.
- Load Inter (weights 400, 500, 600, 700, 800) and Figtree (300, 400, 500, 600) from Google Fonts. **Inter** (`--font-sans`) is for headings, ALL-CAPS labels, buttons, and stat/numeric displays. **Figtree** (`--font-body`) is for everything you read: body copy, descriptions, nav, table text, form values.
- Light mode is default. Dark mode = `data-theme="dark"` on `<html>`. Always style with semantic tokens (`--bg`, `--surface`, `--text`, `--primary`…) so both modes work automatically.

## Name usage
- Formal: **the AiMS Institute**. Short: **AiMS**. Always all caps with a lowercase i — never "AIMS", "Aims", or "aims".

## Voice & copy
Friendly, approachable, enlightening, life-giving. In UI copy that means:
- Positive and affirming — celebrate progress ("Nice work — 3 of 5 sections complete"), never scold.
- Simple and clear — no jargon; write for busy business leaders.
- Punchy and concise — short sentences. Buttons are verbs: "Start Assessment", "Save Changes".
- Errors are non-confrontational: say what happened and how to fix it, never blame the user.

## Color rules
- `--aims-sand` (#F7F7F2) is the app background; `--aims-white` for cards/surfaces on top of it.
- `--aims-navy` (#1F3352) for headings and the logo; `--aims-midnight` (#11151A) for body text.
- `--aims-cobalt` (#3551A4) is THE interactive color: primary buttons, links, active nav, focus.
- `--aims-sky` (#8CC4DF) is secondary: soft fills, organic shapes, chart series 2, dark-mode primary.
- `--aims-chartreuse` (#D6E264) is the accent: tapered underlines, highlights, small markers. Never use it as a large background or as button fill; never set text in it on light backgrounds.
- Functional colors (`--aims-success/warning/danger`) are extensions — use sparingly, mostly as tints with dark text.

## Typography rules
- Headlines: Inter Bold, Title Case, navy (`--text-heading`), breathable line-height (1.3).
- Subheads/callouts/labels: Inter Bold 11px, ALL CAPS, `letter-spacing: .15em`, tight line-height.
- Body: Figtree 400 (300 for large display body), sentence case, line-height 1.6. Set `font-family: var(--font-body)` on `body` and re-assert `var(--font-sans)` on headings, caps labels, buttons, and numbers.
- Compact app scale: body 14px, secondary 13px, captions 12px. Never below 12px.
- Big moments go BIG: hero statements use `--text-display` (800, -0.02em, white on gradient); stat numbers use `--text-stat` (800, 40px, tabular-nums). Strong size contrast between display and body is intentional.

## Motion
- Hover: buttons and cards lift (`translateY(-1px..-2px)` + deeper shadow, `--duration-fast`).
- On load: progress bars and rings animate their fill once (`--duration-slow`, ease-out; `@keyframes` from width 0 / full dash offset). Keep it to fills and lifts — no bouncing, no continuous animation.

## Depth & surfaces (the "Bold Expressive" look)
- **No decorative blob/bubble background images.** Depth comes from three things instead: the brand gradient, glass, and elevation.
- `--grad-brand` (navy → cobalt, 135deg) is the signature surface: top nav bands, page heroes, report covers, empty states. This is the ONLY permitted gradient.
- On gradient/dark surfaces, cards are **glass**: `background: var(--glass-bg); border: 1px solid var(--glass-border); backdrop-filter: blur(var(--glass-blur)); border-radius: 16px`. Let content cards overlap the hero band bottom (negative margin) so the page feels layered.
- On light surfaces, cards are white with layered shadows (`--shadow-sm` at rest, `--shadow-md` + `translateY(-2px)` on hover, `--duration-fast`).
- Opaque dark panels (tables/charts on dark): `--surface-dark-card`.

## Shape & radius
- The brand is round and friendly. Buttons, badges, chips, avatars: pill (`--radius-pill`). Inputs: 6px. Cards: 12px. Glass cards & modals: 16px.
- Chartreuse tapered underline: a short 3px rounded bar (wider at left, tapering) under key headings — signature brand accent.
- Rules/dividers: thin (1px), rounded ends.

## Components (see the style guide for reference renders)
- **Buttons**: pill; primary = cobalt fill/white text on light surfaces; on gradient/dark surfaces the hero CTA is **chartreuse fill + navy text** with `--shadow-cta` glow. Secondary = navy 1.5px outline (white outline on dark); ghost = text-only cobalt. Heights 28/34/42px. Hover darkens + lifts.
- **Links**: cobalt, no underline at rest, underline on hover.
- **Inputs**: white surface, 1px `--border`, 6px radius, 34px height; focus = cobalt border + 3px `--focus-ring` halo. Labels use the subhead style. Errors: danger border + 12px danger message below.
- **Cards**: white, 10px radius, 1px border, `--shadow-sm`; padding 16–24px. Stat cards may carry a sky shape accent in a corner.
- **Nav**: top bar navy (white logo) OR white with navy logo; sidebar white with pill-shaped active item in `--aims-cobalt-tint` + cobalt text.
- **Tables**: compact; header row = subhead style in `--text-muted`; 1px row hairlines; row hover `--aims-navy-tint`; numeric cells right-aligned, tabular-nums.
- **Modals**: 16px radius, `--shadow-lg`, navy headline, actions right-aligned (ghost cancel + primary confirm).
- **Toasts**: pill-ish (10px radius), dark navy surface with sand text in light mode; small colored dot for status.
- **Charts**: use `--chart-1..4` in order (cobalt, sky, chartreuse, navy); on dark surfaces lead with sky. Rounded bar ends, animated fill on load. No gridline clutter; label directly where possible.

## Logo
- Files: `logo-navy.png` (light backgrounds), `logo-white.png` (navy/midnight/photo backgrounds). Black only if one-color print demands it. Never recolor, distort, or place over busy imagery.
- The circle-i glyph may be used as a decorative graphic element but never replaces the full logo.

## PDF reports
- Report covers: `--grad-brand` background, white logo, chartreuse accent underline under the title.
- Report body: sand/white pages, same type scale (min 12px), charts in brand chart colors.

## Never
- No decorative blob/bubble images or shape PNGs in backgrounds. No gradients other than `--grad-brand`. No emoji in UI, no pure black (#000) or pure gray-blue defaults, no sharp corners on interactive elements, no chartreuse body text (chartreuse is fills/accents only), no fonts other than Inter and Figtree.
