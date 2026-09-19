/**
 * THE REQUIREMENT REPORTS' COLOUR LANGUAGE — one palette, read by the PDF
 * (`./reports-export.ts`) and the on-screen report
 * (`components/orders/fabric-bom-reports-sheet.tsx`), so the page and the
 * printout cannot colour one section two ways.
 *
 * Client 2026-09-20: design A ("Clean RP layout") "with colourful
 * differentiation". The colour always SAYS something:
 *
 * - **A STAGE** — every section wears the stage its weight is booked to: yarn
 *   to buy, Greige (one lot per fabric), Dyed / Wash (per colourway), Print
 *   (printed colourways only), and the cutting table. That is the fact the
 *   report's grouping rules turn on, so the reader sees it before reading.
 * - **A COLOURWAY** — a swatch of the garment colour beside its name.
 *
 * PRINT-SAFE BY CONSTRUCTION: every tint is a pale fill under near-black ink
 * (4.5:1 or better), and the rule is a stronger line of the same hue, so a
 * grayscale printout still separates the sections by weight.
 *
 * Client-safe (no `server-only`): both renderers run in the browser.
 */
import { stageRank, isDyedStage, type FabricStageLike } from "./stage-routes";

export type StageKind = "yarn" | "greige" | "dyed" | "wash" | "print" | "cutting";

export type StageStyle = {
  /** The word printed on the section's tag. */
  label: string;
  /** Pale fill — table header, total row, tag background. */
  tint: string;
  /** Strong line — the rule over the table, the tag's border. */
  rule: string;
  /** Text on the tint. */
  ink: string;
};

export const STAGE_STYLES: Record<StageKind, StageStyle> = {
  yarn: { label: "YARN", tint: "#fdf1dc", rule: "#d98e04", ink: "#7a4b00" },
  greige: { label: "GREIGE", tint: "#eceff3", rule: "#6b7480", ink: "#37404a" },
  dyed: { label: "DYED", tint: "#e1eff9", rule: "#037bb8", ink: "#024f78" },
  wash: { label: "WASH", tint: "#dff3f0", rule: "#138a7e", ink: "#0b5a52" },
  print: { label: "PRINT", tint: "#eaf5dc", rule: "#6aa51f", ink: "#3d6410" },
  cutting: { label: "CUTTING", tint: "#efeaf6", rule: "#6d4fa3", ink: "#452c73" },
};

/** The band that groups one colourway's rows — neutral, so it never competes
 *  with the stage colour of the section it sits in. `#f5f7fa` was tried first
 *  and vanished on paper; this is the lightest that still shows. */
export const COLOURWAY_BAND = "#edf1f6";

/** The four-stage stripe across the top of a requirement document. */
export const STAGE_STRIPE: readonly string[] = [
  STAGE_STYLES.yarn.rule,
  STAGE_STYLES.greige.rule,
  STAGE_STYLES.dyed.rule,
  STAGE_STYLES.print.rule,
];

/** Which kind a `fabric_stage` lookup is — by MEANING (code or name), the way
 *  `stageRank` reads it, so an operator-renamed stage still colours right. An
 *  unrecognised stage is `null` and takes no stage colour. */
export function stageKindOf(stage: FabricStageLike): StageKind | null {
  const rank = stageRank(stage);
  if (rank === 0) return "greige";
  if (rank === 2) return "print";
  if (rank === 1) return isDyedStage(stage) ? "dyed" : "wash";
  return null;
}

/**
 * THE STYLE OF ONE PROCESS SECTION, from the stages its steps run in.
 *
 * A section is keyed by PROCESS, and one process may run in two stages —
 * COMPACTING after dyeing and again after printing. Then the tag names both
 * ("DYED · PRINT") and the colour is the EARLIER stage's, the one the section
 * opens in. No known stage at all → Greige's neutral slate, never a guess of
 * a coloured stage.
 */
export function sectionStyle(stages: readonly FabricStageLike[] | undefined, isPrint?: boolean): StageStyle {
  const kinds: StageKind[] = [];
  for (const st of stages ?? []) {
    const k = stageKindOf(st);
    if (k && !kinds.includes(k)) kinds.push(k);
  }
  if (!kinds.length && isPrint) kinds.push("print");
  const order: StageKind[] = ["greige", "dyed", "wash", "print"];
  kinds.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const base = STAGE_STYLES[kinds[0] ?? "greige"];
  return kinds.length > 1 ? { ...base, label: kinds.map((k) => STAGE_STYLES[k].label).join(" · ") } : base;
}

/**
 * GARMENT COLOUR NAMES → a swatch. Colourway names are typed by operators, so
 * this is a lookup, never a guess: a name with no recognised colour word
 * ("MELANGE 2", a buyer's code) returns null and draws no swatch, rather than
 * a wrong one that reads as the real colour.
 *
 * Multi-word names are tried first (OFF WHITE before WHITE), then single
 * words from the LAST backwards — the base colour is usually last ("DARK
 * NAVY", "LIGHT GREY").
 */
const SWATCHES: Record<string, string> = {
  "OFF WHITE": "#f4f1e8", "SKY BLUE": "#7fb8e0", "ROYAL BLUE": "#2b4fa8", "NAVY BLUE": "#1f2f5c",
  "BOTTLE GREEN": "#1f5b3a", "OLIVE GREEN": "#6b7a2a", "BABY PINK": "#f4c2d0",
  WHITE: "#ffffff", BLACK: "#1b1b1b", ECRU: "#efe6d2", CREAM: "#f3e9cf", IVORY: "#f6f0dc",
  GREY: "#8a8f96", GRAY: "#8a8f96", CHARCOAL: "#3b3f45", SILVER: "#c0c4c8", ANTHRA: "#3b3f45",
  NAVY: "#1f2f5c", BLUE: "#2f6fb5", SKY: "#7fb8e0", ROYAL: "#2b4fa8", DENIM: "#3d5a80",
  TEAL: "#1f8a8a", TURQUOISE: "#2bb5b0", AQUA: "#5fc9c9", GREEN: "#2e8b57", OLIVE: "#6b7a2a",
  KHAKI: "#b8a878", MINT: "#9fd8bf", LIME: "#9ccf3a", YELLOW: "#f2c230", MUSTARD: "#c9a227",
  GOLD: "#c8a24a", ORANGE: "#e8772e", RUST: "#a8481e", RED: "#c62828", MAROON: "#6d1a24",
  WINE: "#6b1f35", BURGUNDY: "#6a1b2e", PINK: "#e58fb0", ROSE: "#d86a8a", FUCHSIA: "#c2257a",
  PURPLE: "#6b3fa0", LILAC: "#b9a2d6", LAVENDER: "#b7a8dc", VIOLET: "#7a4fb0", BROWN: "#7b4a2a",
  TAN: "#c9a27a", BEIGE: "#d9c7a7", CAMEL: "#b98b55", COFFEE: "#5a3b25", CHOCOLATE: "#4e2f1d",
  PEACH: "#f2b48f", CORAL: "#ec7a63",
};

export function swatchFor(name: string | null | undefined): string | null {
  const n = (name ?? "").toUpperCase().replace(/[^A-Z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return null;
  if (SWATCHES[n]) return SWATCHES[n];
  for (const key of Object.keys(SWATCHES)) {
    if (key.includes(" ") && ` ${n} `.includes(` ${key} `)) return SWATCHES[key];
  }
  const words = n.split(" ");
  for (let i = words.length - 1; i >= 0; i--) {
    if (SWATCHES[words[i]]) return SWATCHES[words[i]];
  }
  return null;
}

/** `#rrggbb` → `[r, g, b]`, for jsPDF. */
export function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
