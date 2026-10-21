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
