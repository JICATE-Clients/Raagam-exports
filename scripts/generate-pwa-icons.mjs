// Generates the PWA icon set from the Raagam Exports mark.
// Run once (and whenever the source changes):  node scripts/generate-pwa-icons.mjs
//
// THE SOURCE IS THE REAL LOGO NOW (client 2026-08-21). It used to be
// `public/icon-source.svg` — an indigo square with a hand-set letter "R", a
// placeholder from before there was artwork. `public/brand/raagam-mark.png` is
// the "Re" roundel from the client's own file, cut out of its JPEG background
// and masked to the circle (the JPEG carried a drop shadow that would otherwise
// have been baked into every icon).
//
// THE BACKGROUND COLOUR IS THE LOGO'S GREEN, NOT THE UI'S BRAND, and the two
// are deliberately different things: `--primary` is the accent the app is built
// in, while this is the brand mark's own field. A maskable icon is cropped to
// whatever shape the launcher likes, so its padding has to be the colour the
// mark sits on or the crop shows a coloured ring around it.
import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const SRC = "public/brand/raagam-mark.png";
const OUT = "public/icons";

const BRAND = { r: 0x85, g: 0xc2, b: 0x27, alpha: 1 }; // #85c227 — the client's stated brand green
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const STD_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const MASKABLE_SIZES = [192, 512];

async function run() {
  await mkdir(OUT, { recursive: true });
  const art = await readFile(SRC);
  // High render density so upscales stay crisp.
  const src = () => sharp(art, { density: 512 });

  // Standard icons (purpose: any) — the roundel on transparency, so a launcher
  // that does not mask gets the circle rather than a square.
  for (const s of STD_SIZES) {
    await src()
      .resize(s, s, { fit: "contain", background: TRANSPARENT })
      .png()
      .toFile(path.join(OUT, `icon-${s}x${s}.png`));
  }

  // Maskable icons — opaque green edge-to-edge with the mark inside the safe zone.
  for (const s of MASKABLE_SIZES) {
    const pad = Math.round(s * 0.12);
    await src()
      .resize(s - pad * 2, s - pad * 2, { fit: "contain", background: BRAND })
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: BRAND })
      .png()
      .toFile(path.join(OUT, `icon-maskable-${s}x${s}.png`));
  }

  // Apple touch icon — iOS dislikes transparency, so keep it opaque green.
  await src()
    .resize(180, 180, { fit: "contain", background: BRAND })
    .png()
    .toFile(path.join(OUT, "apple-touch-icon-180x180.png"));

  // Notification badge (monochrome-friendly small mark) — used later for push.
  await src()
    .resize(72, 72, { fit: "contain", background: TRANSPARENT })
    .png()
    .toFile(path.join(OUT, "badge-72x72.png"));

  console.log("✅ PWA icons generated in public/icons/");
}

run().catch((err) => {
  console.error("❌ Icon generation failed:", err);
  process.exit(1);
});
