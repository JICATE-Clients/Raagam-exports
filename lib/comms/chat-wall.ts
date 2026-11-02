/**
 * PULSE'S CHAT WALLPAPER (user 2026-11-02, the "Garment Doodle Background"
 * artifact): fourteen garment-trade line drawings — T-shirt, shirt, dress,
 * trousers, hanger, scissors, button, thread spool, needle and thread, tape
 * measure, iron, zipper, fabric roll, safety pin — each slightly turned, as
 * WhatsApp's doodles are, staggered over one 300px tile with small stitches
 * and dots between them.
 *
 * IT FOLLOWS THE THEME COLOUR (user 2026-11-02, "when the theme colour changes
 * the chat colour and background also change automatically"). The tile is
 * drawn in plain black and used as a CSS MASK over a layer filled with
 * `--primary` (conversation-view.tsx), so the topbar's colour menu repaints the
 * drawings with no new image. Kept faint — 11% light, 9% dark, the artifact's
 * "Subtle" (screenshot 161231) — and tiled at 240px ("Small"). Built once at module load into two data: URLs; nothing
 * is fetched.
 */

/** Each drawing in a 36 × 36 box, one stroke weight. */
const ICONS: Record<string, string> = {
  tshirt:
    '<path d="M12 4l5-2.5c.6 2.4 2.5 3.5 4 3.5s3.4-1.1 4-3.5L30 4l5 7-5 3.5-2-1.6V33H14V12.9l-2 1.6L7 11z" transform="translate(-3 0)"/>',
  shirt:
    '<path d="M12 3.5l5-1.5 1 4 1-4 5 1.5 6 6-4 4.5-2-1.5V33H12V12l-2 1.5-4-4.5z"/><path d="M17 2l1.5 4.5L20 2M18.5 6.5V33"/><circle cx="18.5" cy="13" r=".9"/><circle cx="18.5" cy="19" r=".9"/><circle cx="18.5" cy="25" r=".9"/><path d="M23 15h4"/>',
  dress: '<path d="M14 2h8l-1 7 2 3-1 3 8 18H6l8-18-1-3 2-3z"/><path d="M13.5 15h9M11 26c3 1.5 11 1.5 14 0"/>',
  trousers: '<path d="M8 3h20l3 30h-9l-4-19-4 19H5z"/><path d="M8 7.5h20M18 3v4.5M12 7.5l-1 5M24 7.5l1 5"/>',
  hanger: '<path d="M15 7.5a3.2 3.2 0 1 1 3.5 3.2V13L33 23.5a1.8 1.8 0 0 1-1 3.2H4a1.8 1.8 0 0 1-1-3.2L18 13"/>',
  scissors: '<circle cx="9" cy="28" r="4.5"/><circle cx="25" cy="28" r="4.5"/><path d="M12 24.5 29 3M22 24.5 5 3"/><circle cx="17" cy="16.3" r=".8"/>',
  button:
    '<circle cx="18" cy="18" r="13"/><circle cx="18" cy="18" r="9.5" stroke-dasharray="2 2.4"/><circle cx="15" cy="15" r="1.4"/><circle cx="21" cy="15" r="1.4"/><circle cx="15" cy="21" r="1.4"/><circle cx="21" cy="21" r="1.4"/>',
  spool:
    '<rect x="8" y="3" width="20" height="4" rx="1.5"/><rect x="8" y="29" width="20" height="4" rx="1.5"/><path d="M11 7v22M25 7v22M11 11l14 2.5M11 16l14 2.5M11 21l14 2.5M25 26c4 0 7 2 6 6"/>',
  needle: '<path d="M5 33 28.5 7.5"/><path d="M27 6.5l3 2.5" stroke-width="2.6"/><path d="M30 6c5 1 5 7 0 9s-5 9 1 11"/>',
  tape: '<circle cx="15" cy="15" r="11"/><circle cx="15" cy="15" r="3.5"/><path d="M15 26h18v-6H24"/><path d="M28 26v-3M31 26v-3"/>',
  iron: '<path d="M3 27h30v-3a11 11 0 0 0-11-11H12a9 9 0 0 0-9 9z"/><path d="M12 13c0-4 3-6 7-6h8M8 22h.01M13 22h.01M18 22h.01"/>',
  zipper: '<path d="M18 2v32"/><path d="M14 6h4M18 10h4M14 14h4M18 18h4M14 22h4M18 26h4"/><rect x="15" y="27" width="6" height="7" rx="2"/>',
  fabric:
    '<ellipse cx="9" cy="17" rx="5" ry="11"/><path d="M9 6h17M9 28h4"/><path d="M26 6c3 0 5 5 5 11s-2 11-5 11H13"/><path d="M13 28c2 3 6 5 12 5"/>',
  pin: '<path d="M8 30c-3-3-1-7 2-7l15-15"/><path d="M8 30c3 3 7 1 7-2l15-15"/><circle cx="27.5" cy="10.5" r="3.5"/><path d="M10 26l2 2"/>',
};

/** [drawing, x, y, turn°, scale] on the 300 × 300 tile — staggered so no two neighbours line up. */
const PLACES: [string, number, number, number, number][] = [
  ["tshirt", 14, 12, -8, 1], ["button", 104, 8, 0, 0.9], ["scissors", 184, 14, 12, 1], ["spool", 252, 52, -6, 0.95],
  ["hanger", 52, 80, 6, 1.05], ["needle", 140, 76, -4, 1], ["dress", 214, 118, -8, 1],
  ["tape", 10, 158, 8, 0.95], ["shirt", 96, 150, 4, 1.05], ["iron", 170, 196, -10, 0.95],
  ["trousers", 252, 222, 6, 0.95], ["zipper", 40, 238, -12, 0.95], ["fabric", 120, 240, 4, 0.95], ["pin", 206, 262, 18, 0.85],
];

/** Stitches and dots between the drawings, so the wall reads as an even texture. */
const FILL =
  '<path d="M84 60h7M232 96h7M150 132h7M30 208h7M188 246h7M270 172h7" stroke-dasharray="2 2.5"/>' +
  '<circle cx="76" cy="40" r="1.4"/><circle cx="174" cy="58" r="1.4"/><circle cx="34" cy="130" r="1.4"/><circle cx="200" cy="166" r="1.4"/>' +
  '<circle cx="84" cy="214" r="1.4"/><circle cx="160" cy="286" r="1.4"/><circle cx="286" cy="290" r="1.4"/><circle cx="286" cy="20" r="1.4"/>';

function wall(color: string): string {
  const drawings = PLACES.map(([k, x, y, r, s]) => `<g transform="translate(${x} ${y}) rotate(${r} 18 18) scale(${s})">${ICONS[k]}</g>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${drawings}${FILL}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** The doodle tile as a mask: only its shape counts; the colour is `--primary`. */
export const CHAT_WALL_MASK = wall("#000");
