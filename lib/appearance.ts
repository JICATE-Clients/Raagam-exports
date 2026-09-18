/**
 * Appearance — a TYPEFACE and a COLOUR, chosen separately from the topbar "T"
 * menu (client 2026-09-17: explore enterprise design-system typography and
 * colour combinations, with the T icon as the theme changer).
 *
 * TWO AXES, NOT ONE LIST OF BUNDLES. The first cut paired each design system's
 * face with that system's own blue — and five blues side by side read as "the
 * colour never changed" (client, same day: "the color still same … theme color
 * also suggest various"). Splitting them lets any face meet any colour, which is
 * what "explore the best combination" actually asks for, and the colour list is
 * free to offer real hues instead of five shades of one.
 *
 * INDEPENDENT OF THE OTHER TWO PREFERENCES:
 *   - `lib/theme.ts`       light / dark / system   (the sun/moon button)
 *   - `lib/type-scale.ts`  new look / classic       (sizes, weights, button sheen)
 *   - this file            which face (`data-font`) + which colour (`data-accent`)
 * Every colour carries a light AND a dark palette.
 *
 * ONE DECLARATION, THREE READERS. `appearanceCss()` turns these lists into the
 * stylesheet the root layout inlines, `AppearanceMenu` lists them, and
 * `.claude/skills/raagam-theme-presets/scripts/check-theme-contrast.mts`
 * (`npm run check:themes`) proves every colour readable. Adding an option is
 * one entry here (plus a `next/font` loader in app/layout.tsx for a new face) —
 * never a hand-written CSS block beside it.
 *
 * The first entry of each list is the default and writes NO CSS: it is exactly
 * globals.css, so the default screen cannot change because this file exists.
 *
 * NOT THEMEABLE: the logo colours (`--brand-blue`, `--brand-green`) and every
 * status colour. That is also why no SOLID colour here is green, amber or red —
 * a green primary button would read as "Approved", a red one as "Delete". The
 * Raagam Gradient ends in green only as the far stop of the logo's own pair.
 *
 * No "use client" and no `@/` imports: app/layout.tsx (a server component)
 * reads the CSS and init script, and the contrast check loads this file with
 * `node --experimental-strip-types`, which cannot resolve path aliases.
 */

export interface FontOption {
  id: string;
  /** Menu label — drawn in the face itself. */
  label: string;
  /** Which design system uses it, for the skill and the tooltip. */
  source: string;
  /** CSS value for `--font-app`: a next/font `var(--font-…)` or a system face. */
  family: string;
}

/** The colour tokens a colour option sets. All derive from one hue. */
export interface AccentPalette {
  /** Solid button fill, tab bar, link text, focus ring. White text sits on it. */
  primary: string;
  primaryHover: string;
  /** Pressed button; also the "informational" text colour under New look. */
  primaryActive: string;
  /** Selected-row / icon-well tint. `primary` text sits on it. */
  primarySoft: string;
  /** The focused grid cell's fill. */
  cellActive: string;
  info: string;
  infoSoft: string;
  /**
   * Makes this a GRADIENT option: the second stop, running from `primary`.
   * Painted on the two large solid surfaces only — the workspace tab bar
   * (`.ty-chrome`) and primary buttons (`.ty-btn-primary`). Text, tints and
   * rows stay solid: a gradient behind a table cell or a label only costs
   * legibility. White text sits on both stops, so the check tests both.
   */
  gradientTo?: string;
}

export interface AccentOption {
  id: string;
  label: string;
  source: string;
  light: AccentPalette;
  dark: AccentPalette;
}

export const FONT_STORAGE_KEY = "raagam-font";
export const ACCENT_STORAGE_KEY = "raagam-accent";
export const FONT_ATTR = "data-font";
export const ACCENT_ATTR = "data-accent";

export const FONTS: readonly FontOption[] = [
  {
    id: "inter",
    label: "Inter",
    source: "Raagam default (also Shopify Polaris)",
    family: "var(--font-inter)",
  },
  {
    id: "plex",
    label: "IBM Plex Sans",
    source: "IBM Carbon",
    family: "var(--font-plex)",
  },
  {
    id: "segoe",
    label: "Segoe UI",
    // A Windows system face: nothing to download on the PCs this runs on;
    // Inter stands in anywhere Segoe is absent.
    source: "Microsoft Fluent 2 (Windows system font)",
    family: '"Segoe UI Variable Text", "Segoe UI", var(--font-inter)',
  },
  {
    id: "source",
    label: "Source Sans 3",
    source: "Adobe Spectrum",
    family: "var(--font-source)",
  },
  {
    id: "roboto",
    label: "Roboto",
    source: "Google Material 3",
    family: "var(--font-roboto)",
  },
  /**
   * THE ONE SERIF, AND THE ONLY ONE ASKED FOR BY NAME (client 2026-09-18).
   *
   * A SYSTEM FACE, like Segoe above and for a stronger reason: Bookman Old
   * Style is Monotype's, shipped with Microsoft Office rather than licensed for
   * the web, so there is no `next/font` loader to add — it cannot be served
   * from Google Fonts or self-hosted without a licence. It costs nothing to
   * offer: a PC that has Office draws it, and one that does not falls through
   * the stack to URW Bookman (the free metric-compatible clone on Linux),
   * Georgia, and finally Inter — never an unstyled default.
   *
   * TWO THINGS TO WATCH, both of which are rules 7 and 8 of the skill and
   * neither of which is a reason to refuse an option the client named:
   *
   * - **Figures.** The face carries no `tnum` feature, so the `tabular-nums`
   *   class on every quantity and rate column has nothing to switch on. Its
   *   digits are near-uniform by design, so columns still line up closely, but
   *   they are not guaranteed to — look at a rate column before adopting it.
   * - **Width.** It is a wide old-style serif, wider than Inter and wider than
   *   Archivo, which was dropped on 2026-09-08 for overflowing fields. Field
   *   widths were tuned on Inter, so check the dense screens (Garment Orders,
   *   Fabric BOM, a report) before making it anyone's default.
   *
   * It stays LAST deliberately: the list is otherwise five sans faces, and the
   * one serif belongs at the end of them rather than in the middle.
   */
  {
    id: "bookman",
    label: "Bookman Old Style",
    source: "Microsoft Office serif (system font)",
    family: '"Bookman Old Style", "URW Bookman", Bookman, Georgia, var(--font-inter)',
  },
];

export const ACCENTS: readonly AccentOption[] = [
  {
    id: "raagam",
    label: "Raagam Blue",
    source: "the brand blue (globals.css)",
    // Mirrors globals.css for the menu swatch and the contrast check; never emitted.
    light: {
      primary: "#037bb8",
      primaryHover: "#036ca1",
      primaryActive: "#045a86",
      primarySoft: "#eaf7fd",
      cellActive: "#e5f5fd",
      info: "#045a86",
      infoSoft: "#eaf7fd",
    },
    dark: {
      primary: "#0380be",
      primaryHover: "#049be6",
      primaryActive: "#036ca1",
      primarySoft: "#052c40",
      cellActive: "#143545",
      info: "#7cc8f0",
      infoSoft: "#052c40",
    },
  },
  {
    id: "navy",
    label: "Navy",
    source: "Tailwind blue 800 — the deep corporate blue",
    light: {
      primary: "#1e40af",
      primaryHover: "#1e3a8a",
      primaryActive: "#172554",
      primarySoft: "#eff6ff",
      cellActive: "#e6effe",
      info: "#1e3a8a",
      infoSoft: "#eff6ff",
    },
    dark: {
      primary: "#3b5fd0",
      primaryHover: "#5577dc",
      primaryActive: "#1e40af",
      primarySoft: "#172554",
      cellActive: "#1c2d63",
      info: "#93b4fd",
      infoSoft: "#172554",
    },
  },
  {
    id: "ocean",
    label: "Ocean",
    source: "Tailwind cyan 700",
    light: {
      primary: "#0e7490",
      primaryHover: "#155e75",
      primaryActive: "#164e63",
      primarySoft: "#ecfeff",
      cellActive: "#e3f8fb",
      info: "#155e75",
      infoSoft: "#ecfeff",
    },
    dark: {
      primary: "#0e7490",
      primaryHover: "#0891b2",
      primaryActive: "#155e75",
      primarySoft: "#083344",
      cellActive: "#0c3d4f",
      info: "#67e8f9",
      infoSoft: "#083344",
    },
  },
  {
    id: "teal",
    label: "Teal",
    // Darker than the app's own `--accent` teal (#0d9488), which stays as is.
    source: "Tailwind teal 700",
    light: {
      primary: "#0f766e",
      primaryHover: "#115e59",
      primaryActive: "#134e4a",
      primarySoft: "#f0fdfa",
      cellActive: "#e6faf5",
      info: "#115e59",
      infoSoft: "#f0fdfa",
    },
    dark: {
      primary: "#0f766e",
      primaryHover: "#14958a",
      primaryActive: "#115e59",
      primarySoft: "#042f2e",
      cellActive: "#0a3b39",
      info: "#5eead4",
      infoSoft: "#042f2e",
    },
  },
  {
    id: "graphite",
    label: "Graphite",
    source: "Tailwind slate — a neutral, colour-free chrome",
    light: {
      primary: "#334155",
      primaryHover: "#1e293b",
      primaryActive: "#0f172a",
      primarySoft: "#f1f5f9",
      cellActive: "#eef2f6",
      info: "#1e293b",
      infoSoft: "#f1f5f9",
    },
    dark: {
      primary: "#64748b",
      primaryHover: "#7c8aa0",
      primaryActive: "#475569",
      primarySoft: "#1e293b",
      cellActive: "#273449",
      info: "#cbd5e1",
      infoSoft: "#1e293b",
    },
  },
  {
    id: "raagam-gradient",
    label: "Raagam Gradient",
    // The logo's own pair: brand blue into the brand green. The green end is
    // `--success`'s value, not the raw lime (#85c227 manages 2.16:1 under
    // white text), and it only ever paints the bar and primary buttons.
    source: "the logo — brand blue to brand green",
    light: {
      primary: "#037bb8",
      primaryHover: "#036ca1",
      primaryActive: "#045a86",
      primarySoft: "#eaf7fd",
      cellActive: "#e5f5fd",
      info: "#045a86",
      infoSoft: "#eaf7fd",
      gradientTo: "#547b19",
    },
    dark: {
      primary: "#0380be",
      primaryHover: "#049be6",
      primaryActive: "#036ca1",
      primarySoft: "#052c40",
      cellActive: "#143545",
      info: "#7cc8f0",
      infoSoft: "#052c40",
      gradientTo: "#4f7518",
    },
  },
  {
    id: "deep-sea",
    label: "Deep Sea",
    source: "navy (blue 800) to teal (teal 700)",
    light: {
      primary: "#1e40af",
      primaryHover: "#1e3a8a",
      primaryActive: "#172554",
      primarySoft: "#eff6ff",
      cellActive: "#e6effe",
      info: "#1e3a8a",
      infoSoft: "#eff6ff",
      gradientTo: "#0f766e",
    },
    dark: {
      primary: "#3b5fd0",
      primaryHover: "#5577dc",
      primaryActive: "#1e40af",
      primarySoft: "#172554",
      cellActive: "#1c2d63",
      info: "#93b4fd",
      infoSoft: "#172554",
      gradientTo: "#0f766e",
    },
  },
  {
    id: "steel",
    label: "Steel",
    source: "graphite (slate 700) to the brand blue",
    light: {
      primary: "#334155",
      primaryHover: "#1e293b",
      primaryActive: "#0f172a",
      primarySoft: "#f1f5f9",
      cellActive: "#eef2f6",
      info: "#1e293b",
      infoSoft: "#f1f5f9",
      gradientTo: "#037bb8",
    },
    dark: {
      primary: "#64748b",
      primaryHover: "#7c8aa0",
      primaryActive: "#475569",
      primarySoft: "#1e293b",
      cellActive: "#273449",
      info: "#cbd5e1",
      infoSoft: "#1e293b",
      gradientTo: "#0380be",
    },
  },
];

export const DEFAULT_FONT = FONTS[0].id;
export const DEFAULT_ACCENT = ACCENTS[0].id;

export function isFontId(v: unknown): v is string {
  return FONTS.some((f) => f.id === v);
}

export function isAccentId(v: unknown): v is string {
  return ACCENTS.some((a) => a.id === v);
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function paletteVars(p: AccentPalette, glow: string): string {
  return [
    `--primary:${p.primary}`,
    `--primary-hover:${p.primaryHover}`,
    `--primary-active:${p.primaryActive}`,
    `--primary-soft:${p.primarySoft}`,
    `--ring:${p.primary}`,
    `--cell-active:${p.cellActive}`,
    `--info:${p.info}`,
    `--info-soft:${p.infoSoft}`,
    `--btn-glow:${glow}`,
  ].join(";");
}

/**
 * A gradient option's paint. The bar runs left to right; a button runs on the
 * diagonal so a short one still shows both stops. A background-image hides the
 * hover/pressed background-COLOUR the button variants set, so those states
 * darken with `filter` instead — same direction, no second gradient to tune.
 */
function gradientCss(sel: string, p: AccentPalette): string {
  if (!p.gradientTo) return "";
  const a = p.primary;
  const b = p.gradientTo;
  return (
    `${sel} .ty-chrome{background-image:linear-gradient(90deg,${a},${b})}` +
    `${sel} .ty-btn-primary{background-image:linear-gradient(135deg,${a},${b})}` +
    `${sel} .ty-btn-primary:hover:not(:disabled){filter:brightness(.92)}` +
    `${sel} .ty-btn-primary:active:not(:disabled){filter:brightness(.84)}`
  );
}

/**
 * The stylesheet for every non-default option, inlined in <head> by the root
 * layout.
 *
 * `html:root:root[…]` — SPECIFICITY, NOT STYLE. globals.css re-sets
 * `--primary-active`, `--info` and `--btn-glow` under
 * `html[data-type-scale="compact"]` and `….dark` (0,2,1 at most), and this
 * sheet's position relative to the bundled CSS is not something the page
 * controls. Out-ranking those selectors makes the order irrelevant.
 */
export function appearanceCss(): string {
  const fonts = FONTS.slice(1).map(
    (f) => `html:root:root[${FONT_ATTR}="${f.id}"]{--font-app:${f.family}}`,
  );
  const accents = ACCENTS.slice(1).map((a) => {
    const sel = `html:root:root[${ACCENT_ATTR}="${a.id}"]`;
    const light = paletteVars(a.light, `rgb(${hexToRgb(a.light.primary)} / 0.28)`);
    const dark = paletteVars(a.dark, "rgb(0 0 0 / 0.45)");
    return (
      `${sel}{${light}}${sel}.dark{${dark}}` +
      gradientCss(sel, a.light) +
      gradientCss(`${sel}.dark`, a.dark)
    );
  });
  return [...fonts, ...accents].join("");
}

function applyStoredScript(key: string, attr: string, ids: string[]): string {
  return `try{var v=localStorage.getItem(${JSON.stringify(key)});if(v&&v!==${JSON.stringify(
    ids[0],
  )}&&${JSON.stringify(ids)}.indexOf(v)>=0)d.setAttribute(${JSON.stringify(attr)},v)}catch(e){}`;
}

/** Pre-paint, beside THEME_INIT_SCRIPT: only a known id is ever applied. */
export const APPEARANCE_INIT_SCRIPT = `(function(){var d=document.documentElement;${applyStoredScript(
  FONT_STORAGE_KEY,
  FONT_ATTR,
  FONTS.map((f) => f.id),
)}${applyStoredScript(
  ACCENT_STORAGE_KEY,
  ACCENT_ATTR,
  ACCENTS.map((a) => a.id),
)}})()`;
