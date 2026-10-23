/**
 * A BUYER'S OWN COLOUR, FOR A QUEUE CARD (user 2026-10-21, "Card Glow Styles"
 * option 1: "a coloured shadow under the card, stronger on hover"). White
 * cards on a white page; the only colour is the buyer's, so the same buyer
 * wears the same hue on every card and every visit.
 *
 * Two shades per hue: `ink` for text and icons on white (the "Start costing"
 * link, the avatar's letters), `glow` — lighter — for the shadow, the avatar's
 * wash and the border tint. Stable by construction: a hash of the name picks
 * the pair. Decoration only — it carries no status.
 */
export type BuyerTint = { ink: string; glow: string };

const TINTS: readonly BuyerTint[] = [
  { ink: "#d0672a", glow: "#f0a35e" }, // orange
  { ink: "#2b6cb0", glow: "#5aa9e6" }, // blue
  { ink: "#1f8a5f", glow: "#58c49a" }, // green
  { ink: "#6a4fd6", glow: "#a58bf0" }, // violet
  { ink: "#b83c6e", glow: "#e67fa8" }, // rose
  { ink: "#0f7f88", glow: "#4fc1c9" }, // teal
  { ink: "#9a7410", glow: "#d9b84a" }, // amber
  { ink: "#4a56c2", glow: "#8f9ff0" }, // indigo
];

/** The neutral pair for a row with no buyer name. */
const NONE: BuyerTint = { ink: "#4b5b61", glow: "#98a4a9" };

export function buyerTint(name: string | null | undefined): BuyerTint {
  const key = (name ?? "").trim().toUpperCase();
  if (!key) return NONE;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

/** Two letters for the avatar: the first two words' initials, or a one-word name's first two. */
export function buyerInitials(name: string | null | undefined): string {
  const words = (name ?? "").trim().toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (words.length === 0) return "—";
  return words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
}

/**
 * THE GLOW CARD, FOR EVERY CARD LIST (user 2026-10-23, screenshot of the Sample
 * Costing queue: "ellam card um intha mari irukkanum … global aa"). The classes
 * Sample Costing's card wore alone, so `MobileCardList` and `CostingCard` draw
 * one card rather than two copies of it. Static literals (Tailwind scans text).
 *
 * Put `glowVars(name)` on the element's `style` — the classes read `--ink` and
 * `--glow` from it. Not `Card`: the Raagam skin clears a `[data-card]`'s border
 * and replaces its shadow, which is exactly the two things this card is.
 */
export const GLOW_CARD = [
  "group flex min-w-0 flex-col rounded-2xl border bg-surface",
  "border-[color-mix(in_srgb,var(--ink)_22%,var(--border))]",
  "shadow-[0_14px_30px_-14px_color-mix(in_srgb,var(--glow)_80%,transparent)]",
  "transition-[transform,box-shadow,border-color] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]",
  "hover:-translate-y-1 hover:border-[color-mix(in_srgb,var(--ink)_50%,var(--border))] hover:shadow-[0_22px_40px_-14px_var(--glow)]",
  "motion-reduce:transition-none motion-reduce:hover:translate-y-0 print:shadow-none",
].join(" ");

/** The initials tile beside the party's name. */
export const GLOW_AVATAR =
  "grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--glow)_18%,var(--surface))] text-[11.5px] font-bold text-[var(--ink)] dark:text-[color-mix(in_srgb,var(--ink)_55%,white)]";

/** The hairline above the card's action row. */
export const GLOW_RULE = "border-t border-[color-mix(in_srgb,var(--ink)_15%,var(--border))]";

export function glowVars(name: string | null | undefined): Record<"--ink" | "--glow", string> {
  const t = buyerTint(name);
  return { "--ink": t.ink, "--glow": t.glow };
}
