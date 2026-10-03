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
export const STYLE_STORAGE_KEY = "raagam-style";
export const STYLE_ATTR = "data-style";

/**
 * A SURFACE STYLE, the fifth axis (user 2026-10-01: "the application is
 * missing that glossy look ... add more looks, I will test and can use one").
 *
 * Font and colour change the ink; a style changes the FRAME the ink sits in:
 * the canvas behind the navigation, the work panel's material, and the depth
 * of cards, menus and the sidebar dock. It never touches a table, a field, a
 * status colour or the brand, for the reason the colour options keep (skill
 * rule 2): operators read figures in the work, and the frame is where polish
 * costs nothing.
 *
 * NO GREEN, AND NO BRAND TINT ON A SURFACE. `globals.css` records the client
 * refusing a tinted ground five times (`--background`, `--surface-muted`). The
 * grounds below are cool neutral blue-greys; colour stays on the controls.
 *
 * `css(sel)` receives `html:root:root[data-style="..."]`, the same specificity
 * trick `appearanceCss` uses for accents, and writes its dark half under
 * `${sel}.dark` itself.
 */
export interface StyleOption {
  id: string;
  label: string;
  css: (sel: string) => string;
}

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

const blur = (px: number, sat = 1.2) =>
  `backdrop-filter:blur(${px}px) saturate(${sat});-webkit-backdrop-filter:blur(${px}px) saturate(${sat})`;

/**
 * PEARL: a white gloss on every shared building block (user 2026-10-01: "it
 * only applies to the sidebar ... I need it reflected in the whole
 * application, without colour, in white"). The first cut styled the FRAME
 * only, and screens are made of primitives, so it read as a sidebar change.
 * These rules reach the primitives through hooks they already carry —
 * `.ty-btn-*` (Button), `[data-input]` (Input, Textarea, Combobox, DataPicker), `[data-segmented]`, `.ty-badge`,
 * `[data-card]` (Card, Stat), `[data-table-frame]` (DataTable) and every
 * table header inside the work panel (DataTable and ChildGrid alike) — so no
 * screen file is edited and a new screen is covered without knowing.
 *
 * WHITE ONLY: sheen is white-to-pearl grey, highlights are white, shadows are
 * neutral. GLOSS ON CONTROLS AND HEADERS, NEVER BEHIND A FIGURE: table body
 * rows stay plain. STATES UNTOUCHED: a field's shadow stands down while it is
 * focused, invalid, held as required or showing a duplicate, and inside a
 * child-grid row, so the focus ring and every hold look exactly as before.
 */
function pearlCss(sel: string): string {
  const d = `${sel}.dark`;
  // Raw buttons and links, matched by exact class token. The exclusions are
  // everything that wears a border or a fill without being a button: a
  // field's own ✕ / ▼ (`data-field-affordance`), tabs, switches, options,
  // a grid row's ✕, the segmented words and the sidebar rows.
  const notButton =
    ':not(.ty-btn-solid,.ty-btn-outline,.ty-btn-subtle,.ty-btn-ghost,.ty-sidebar,[role="tab"],[role="switch"],[role="option"],[role="combobox"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[data-field-affordance],[data-row-remove],[data-input],[data-segmented] *)';
  const rawSolid = `:is(a,button):is([class~="bg-primary"],[class~="bg-danger"],[class~="bg-success-solid"])${notButton}`;
  const rawOutline = `:is(a,button)[class~="border"]:is([class~="rounded-md"],[class~="rounded-lg"]):not([class~="bg-primary"],[class~="bg-danger"])${notButton}`;
  // Tripled class: out-ranks the Orders skin's outline-button selector.
  const ob = ".ty-btn-outline.ty-btn-outline.ty-btn-outline";
  const field =
    `[data-input]:not(:focus):not([aria-invalid="true"]):not([data-required-empty]):not([data-dup-error]):not([data-grid-row] *)`;
  return (
    // ── frame
    `${sel} [data-app-shell]{background:#fff}` +
    `${d} [data-app-shell]{background:linear-gradient(180deg,#0f1217,#0a0c10)}` +
    `${sel} aside[aria-label="Modules"]:not(.bg-surface){background-color:transparent}` +
    `${sel} [data-work-panel]{border-left-color:#fff;box-shadow:-10px 0 30px -16px rgb(15 20 30/.3)}` +
    `${d} [data-work-panel]{border-left-color:rgb(255 255 255/.05);box-shadow:-10px 0 30px -16px rgb(0 0 0/.8)}` +
    `${sel} [data-tab-strip]{background:linear-gradient(180deg,#fff,#f8f9fa);border-bottom-color:#e6e9ec}` +
    `${d} [data-tab-strip]{background:linear-gradient(180deg,#171b22,#12151b)}` +
    `${sel} [data-dock-card]{background:linear-gradient(180deg,#fff,#f5f6f8);box-shadow:inset 0 1px 0 #fff,0 0 0 1px rgb(15 20 30/.06),0 8px 20px -10px rgb(15 20 30/.28)}` +
    `${d} [data-dock-card]{background:linear-gradient(180deg,#1d222a,#171b22);box-shadow:inset 0 1px 0 rgb(255 255 255/.06),0 0 0 1px rgb(255 255 255/.05),0 8px 20px -10px rgb(0 0 0/.7)}` +
    // ── controls
    // THE GLOSS HAS TO BE SEEN, AND HAS TO WIN (user 2026-10-01, screenshot
    // 3222: "I used Frost but the buttons still look flat"). Two causes. The
    // first cut was a white-to-#f2f4f6 fade with a 1px highlight — real, and
    // invisible at arm's length. And the Orders skin (`[data-skin="raagam"]
    // button[class*=…]:not(…)×3`, globals.css) out-ranked it, repainting the
    // whole background on hover and on Save. So: a GLASS BAND (top half lit,
    // a crisp edge at the middle) drawn on a ::after layer BEHIND the label —
    // `isolation:isolate` makes `z-index:-1` land above the button's own fill
    // and below its text — which sits over ANY fill (an accent gradient, the
    // skin's light-blue Save) without replacing it; and outline selectors
    // tripled (`${ob}`) to out-rank the skin. The skin's green border and
    // text on outline buttons are left alone: brand on a control, approved.
    // NO HARD EDGE AT THE MIDDLE (user 2026-10-03, screenshot 3229: "why the
    // button top went half white, fix the color issue"). The band went from
    // 14% white to clear between 49% and 51%, a crisp line that on a blue
    // button read as the top half bleached. It now fades from 24% at the top
    // to nothing by 70%: the same light from above, no seam.
    // AND THE SEGMENTED PILL BELOW SKIPS A SOLID ONE. Its gloss is 95% white
    // to clear at 51%, made for a WHITE pill on a grey track; the Orders
    // Pending/Updated box (and every `[data-segmented]` group whose lit word
    // is `ty-btn-solid`) is BLUE, so that gloss bleached its top half — the
    // actual "half white" in 3229. A solid pill keeps the sheen above instead.
    `${sel} :is(.ty-btn-solid,.ty-btn-outline){position:relative;isolation:isolate}` +
    `${sel} .ty-btn-solid::after{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;pointer-events:none;background:linear-gradient(180deg,rgb(255 255 255/.24) 0%,rgb(255 255 255/.07) 50%,rgb(255 255 255/0) 70%,rgb(0 0 0/.06) 100%)}` +
    // The sidebar's active item is a solid pill too (`SidebarItem`, which
    // backs the rail, the module menu and its sub-rows): same glass band,
    // same lift (user 2026-10-01: "see the sidebar button?"). An idle row
    // gets a white raised sheen on hover only — never a tinted column.
    `${sel} .ty-sidebar[data-active]{position:relative;isolation:isolate;box-shadow:inset 0 1px 0 rgb(255 255 255/.4),inset 0 -1px 0 rgb(0 0 0/.12),0 2px 4px -1px rgb(15 20 30/.22),0 6px 14px -6px rgb(15 20 30/.3)}` +
    `${sel} .ty-sidebar[data-active]::after{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;pointer-events:none;background:linear-gradient(180deg,rgb(255 255 255/.22) 0%,rgb(255 255 255/.06) 50%,rgb(255 255 255/0) 70%,rgb(0 0 0/.05) 100%)}` +
    `${sel} .ty-sidebar:not([data-active]):hover{background-color:transparent;background-image:linear-gradient(180deg,#fff,#f1f3f6);box-shadow:inset 0 1px 0 #fff,0 0 0 1px rgb(15 20 30/.06),0 2px 6px -3px rgb(15 20 30/.18)}` +
    `${d} .ty-sidebar:not([data-active]):hover{background-image:linear-gradient(180deg,#262b34,#1d2129);box-shadow:inset 0 1px 0 rgb(255 255 255/.06),0 2px 6px -3px rgb(0 0 0/.6)}` +
    `${sel} .ty-btn-solid{box-shadow:inset 0 1px 0 rgb(255 255 255/.45),inset 0 -1px 0 rgb(0 0 0/.14),0 2px 4px -1px rgb(15 20 30/.25),0 6px 14px -6px rgb(15 20 30/.35)}` +
    `${sel} ${ob}{background-color:#fff;background-image:linear-gradient(180deg,#fff 0%,#fbfcfd 46%,#edf0f3 54%,#e6e9ed 100%);box-shadow:inset 0 1px 0 #fff,inset 0 -1px 0 rgb(15 20 30/.07),0 1px 2px rgb(15 20 30/.12),0 4px 10px -5px rgb(15 20 30/.18)}` +
    `${sel} ${ob}:hover:not(:disabled){background-image:linear-gradient(180deg,#fff 0%,#f6f8fa 46%,#e6eaee 54%,#dde2e7 100%)}` +
    `${sel} ${ob}:active:not(:disabled){background-image:linear-gradient(180deg,#e9ecf0,#f4f6f8);box-shadow:inset 0 1px 3px rgb(15 20 30/.16)}` +
    `${d} ${ob}{background-color:#1c2028;background-image:linear-gradient(180deg,#2a3039 0%,#232830 48%,#1b1f26 52%,#181c22 100%);box-shadow:inset 0 1px 0 rgb(255 255 255/.08),0 1px 2px rgb(0 0 0/.5),0 4px 10px -5px rgb(0 0 0/.6)}` +
    `${d} ${ob}:hover:not(:disabled){background-image:linear-gradient(180deg,#323943 0%,#2a3039 48%,#21262e 52%,#1d2128 100%)}` +
    // ── EVERY BUTTON, NOT ONLY `Button` (user 2026-10-01: "working for some
    // area buttons only, I need it for the whole application"). `Button`
    // backs ~1,400 call sites, but measured on 2026-10-01: `subtle` (37) and
    // `ghost` (181) carried no hook, 43 raw <a>/<Link>/<button> paint their
    // own solid `bg-primary`, and 38 more draw their own outline. Markers
    // were added to the two variants; the raw ones are matched by the exact
    // class TOKENS they use (`[class~=…]`), never by a substring, so
    // `bg-primary-soft` or `bg-primary/10` (tints, not buttons) stay out.
    `${sel} ${rawSolid}{position:relative;isolation:isolate;box-shadow:inset 0 1px 0 rgb(255 255 255/.45),inset 0 -1px 0 rgb(0 0 0/.14),0 2px 4px -1px rgb(15 20 30/.25),0 6px 14px -6px rgb(15 20 30/.35)}` +
    `${sel} ${rawSolid}::after{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;pointer-events:none;background:linear-gradient(180deg,rgb(255 255 255/.24) 0%,rgb(255 255 255/.07) 50%,rgb(255 255 255/0) 70%,rgb(0 0 0/.06) 100%)}` +
    `${sel} :is(.ty-btn-subtle,${rawOutline}){background-color:#fff;background-image:linear-gradient(180deg,#fff 0%,#fbfcfd 46%,#edf0f3 54%,#e6e9ed 100%);box-shadow:inset 0 1px 0 #fff,inset 0 -1px 0 rgb(15 20 30/.07),0 1px 2px rgb(15 20 30/.12),0 4px 10px -5px rgb(15 20 30/.18)}` +
    `${sel} :is(.ty-btn-subtle,${rawOutline}):hover:not(:disabled){background-image:linear-gradient(180deg,#fff 0%,#f6f8fa 46%,#e6eaee 54%,#dde2e7 100%)}` +
    `${d} :is(.ty-btn-subtle,${rawOutline}){background-color:#1c2028;background-image:linear-gradient(180deg,#2a3039 0%,#232830 48%,#1b1f26 52%,#181c22 100%);box-shadow:inset 0 1px 0 rgb(255 255 255/.08),0 1px 2px rgb(0 0 0/.5),0 4px 10px -5px rgb(0 0 0/.6)}` +
    // A ghost button has no face at rest (icon actions, toolbar text); it
    // shows a glossy white chip under the pointer, the same as a sidebar row.
    `${sel} .ty-btn-ghost:hover:not(:disabled){background-color:transparent;background-image:linear-gradient(180deg,#fff,#eef1f4);box-shadow:inset 0 1px 0 #fff,0 0 0 1px rgb(15 20 30/.07),0 2px 6px -3px rgb(15 20 30/.2)}` +
    `${d} .ty-btn-ghost:hover:not(:disabled){background-image:linear-gradient(180deg,#262b34,#1d2129);box-shadow:inset 0 1px 0 rgb(255 255 255/.06),0 2px 6px -3px rgb(0 0 0/.6)}` +
    `${sel} ${field}{box-shadow:inset 0 1px 2px rgb(15 20 30/.07)}` +
    `${d} ${field}{box-shadow:inset 0 1px 2px rgb(0 0 0/.45)}` +
    `${sel} [data-segmented]{background-image:linear-gradient(180deg,#eceef1,#f3f4f6);box-shadow:inset 0 1px 2px rgb(15 20 30/.07)}` +
    `${sel} [data-segmented] input:checked+[data-seg-pill],${sel} [data-segmented] button[aria-pressed="true"]:not(.ty-btn-solid){background-image:linear-gradient(180deg,rgb(255 255 255/.95),rgb(255 255 255/.55) 50%,rgb(255 255 255/0) 51%);box-shadow:inset 0 1px 0 #fff,0 1px 2px rgb(15 20 30/.14),0 3px 8px -3px rgb(15 20 30/.22)}` +
    `${d} [data-segmented]{background-image:none;box-shadow:inset 0 1px 2px rgb(0 0 0/.5)}` +
    `${d} [data-segmented] input:checked+[data-seg-pill],${d} [data-segmented] button[aria-pressed="true"]:not(.ty-btn-solid){background-image:linear-gradient(180deg,#262b34,#1e232b);box-shadow:inset 0 1px 0 rgb(255 255 255/.07),0 1px 3px rgb(0 0 0/.5)}` +
    `${sel} .ty-badge{box-shadow:inset 0 1px 0 rgb(255 255 255/.6),0 0 0 1px rgb(15 20 30/.05)}` +
    `${d} .ty-badge{box-shadow:inset 0 1px 0 rgb(255 255 255/.06)}` +
    // ── surfaces
    `${sel} [data-card]{background-image:linear-gradient(180deg,#fff,#f8f9fa);border-color:#e5e8eb;box-shadow:inset 0 1px 0 #fff,0 1px 2px rgb(15 20 30/.04),0 10px 24px -16px rgb(15 20 30/.26)}` +
    `${d} [data-card]{background-image:linear-gradient(180deg,#191d24,#15181e);box-shadow:inset 0 1px 0 rgb(255 255 255/.05),0 10px 24px -16px rgb(0 0 0/.7)}` +
    `${sel} [data-table-frame]{border-color:#e5e8eb;box-shadow:0 10px 24px -18px rgb(15 20 30/.3)}` +
    `${d} [data-table-frame]{box-shadow:0 10px 24px -18px rgb(0 0 0/.8)}` +
    `${sel} [data-work-panel] thead>tr{background-image:linear-gradient(180deg,#fdfdfe,#eef0f3)}` +
    `${d} [data-work-panel] thead>tr{background-image:linear-gradient(180deg,#1f242c,#1a1e25)}` +
    // ── overlays: solid, lifted
    `${sel} [role="menu"],${sel} [role="listbox"]{box-shadow:inset 0 1px 0 #fff,0 0 0 1px rgb(15 20 30/.06),0 18px 44px -14px rgb(15 20 30/.32)}` +
    `${d} [role="menu"],${d} [role="listbox"]{box-shadow:0 0 0 1px rgb(255 255 255/.06),0 18px 44px -14px rgb(0 0 0/.8)}`
  );
}

/**
 * FROST: Pearl, plus frosted white where something sits OVER something —
 * the work panel over the light-field, the open rail, the dock, menus and
 * pickers. Never on a dialog's body (forms) and never per row: blur is costly
 * on the shop-floor PCs, so it is spent on a handful of large surfaces.
 * An operator whose OS asks for reduced transparency gets Pearl's solids.
 */
function frostCss(sel: string): string {
  const d = `${sel}.dark`;
  const frost =
    `${sel} [data-app-shell]{background:#fff}` +
    `${d} [data-app-shell]{background:radial-gradient(900px 600px at 0% 0%,#1a1e25 0%,transparent 65%),linear-gradient(160deg,#0e1115,#08090c)}` +
    `${sel} [data-work-panel]{background:rgb(255 255 255/.74);${blur(20)};border-left-color:rgb(255 255 255/.85);box-shadow:inset 1px 0 0 #fff,-10px 0 30px -16px rgb(15 20 30/.3)}` +
    `${d} [data-work-panel]{background:rgb(14 16 21/.76)}` +
    `${sel} [data-tab-strip]{background:rgb(255 255 255/.45)}` +
    `${d} [data-tab-strip]{background:rgb(255 255 255/.02)}` +
    `${sel} aside[aria-label="Modules"].bg-surface{background-color:rgb(255 255 255/.7);${blur(24)}}` +
    `${d} aside[aria-label="Modules"].bg-surface{background-color:rgb(18 21 27/.8)}` +
    `${sel} [data-dock-card]{background:rgb(255 255 255/.6);${blur(14)};box-shadow:inset 0 1px 0 #fff,0 0 0 1px rgb(255 255 255/.7),0 10px 24px -12px rgb(15 20 30/.3)}` +
    `${d} [data-dock-card]{background:rgb(28 32 40/.6)}` +
    `${sel} [role="menu"],${sel} [role="listbox"]{background-color:rgb(255 255 255/.84);${blur(18, 1.4)}}` +
    `${d} [role="menu"],${d} [role="listbox"]{background-color:rgb(20 23 29/.86)}`;
  // Frost applies everywhere; only an OS that ASKS for reduced transparency
  // turns the see-through surfaces solid. (Gating Frost on `not (...)` would
  // switch it off in every browser that does not know the query yet.)
  const solid =
    `${sel} [data-work-panel],${sel} [data-dock-card],${sel} aside[aria-label="Modules"].bg-surface,${sel} [role="menu"],${sel} [role="listbox"]{background-color:var(--surface);backdrop-filter:none;-webkit-backdrop-filter:none}` +
    `${sel} [data-work-panel]{background:var(--panel)}`;
  return pearlCss(sel) + frost + `@media (prefers-reduced-transparency:reduce){${solid}}`;
}

/**
 * The first entry is today's look and writes NO CSS (skill rule 1), so
 * removing this axis leaves the default screen unchanged. Glass and Aurora
 * (blue-tinted grounds) were replaced by Pearl and Frost the same day — the
 * user wants white; a stored id that no longer exists is ignored at boot.
 */
export const STYLES: readonly StyleOption[] = [
  { id: "flat", label: "Flat", css: () => "" },
  {
    // Depth without gloss: a cool grey ground and borderless, lifted cards.
    id: "soft",
    label: "Soft",
    css: (sel) => {
      const d = `${sel}.dark`;
      return (
        `${sel} [data-app-shell]{background:#fff}` +
        `${d} [data-app-shell]{background:#080a0e}` +
        `${sel} aside[aria-label="Modules"]:not(.bg-surface){background-color:transparent}` +
        `${sel} [data-work-panel]{border-left-color:transparent;box-shadow:-12px 0 36px -18px rgb(15 23 42/.28)}` +
        `${d} [data-work-panel]{box-shadow:-12px 0 36px -18px rgb(0 0 0/.8)}` +
        `${sel} [data-card]{border-color:transparent;box-shadow:0 1px 2px rgb(15 23 42/.05),0 6px 20px -8px rgb(15 23 42/.14)}` +
        `${d} [data-card]{border-color:rgb(255 255 255/.04);box-shadow:0 8px 24px -10px rgb(0 0 0/.6)}` +
        `${sel} [data-dock-card]{box-shadow:0 1px 2px rgb(15 23 42/.06),0 8px 22px -10px rgb(15 23 42/.25)}` +
        `${sel} [role="menu"]{border-color:transparent;box-shadow:0 2px 6px rgb(15 23 42/.06),0 18px 44px -14px rgb(15 23 42/.32)}`
      );
    },
  },
  { id: "pearl", label: "Pearl", css: pearlCss },
  { id: "frost", label: "Frost", css: frostCss },
];

export const DEFAULT_FONT = FONTS[0].id;
export const DEFAULT_ACCENT = ACCENTS[0].id;

export function isFontId(v: unknown): v is string {
  return FONTS.some((f) => f.id === v);
}

export function isStyleId(v: unknown): v is string {
  return STYLES.some((st) => st.id === v);
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
    // WHITE TEXT, STATED HERE (2026-10-01). The Raagam skin repaints primary
    // buttons as a LIGHT blue with dark #0b3a56 text, and this image out-ranks
    // that fill but not its text colour — so on every skinned screen the main
    // button came out dark-on-dark and read as disabled. The gradient is dark,
    // so it owns the text that goes on it.
    `${sel} .ty-btn-primary{background-image:linear-gradient(135deg,${a},${b});color:#fff;border-color:transparent}` +
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
  // `@media screen`: a printed report keeps the RP format whatever the style.
  const styles = STYLES.slice(1).map(
    (st) => `@media screen{${st.css(`html:root:root[${STYLE_ATTR}="${st.id}"]`)}}`,
  );
  return [...fonts, ...accents, ...styles].join("");
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
)}${applyStoredScript(
  STYLE_STORAGE_KEY,
  STYLE_ATTR,
  STYLES.map((st) => st.id),
)}})()`;
