// Generates the PWA icon set from public/icon-source.svg (the "R" brand mark).
// Run once (and whenever the source changes):  node scripts/generate-pwa-icons.mjs
import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const SRC = "public/icon-source.svg";
const OUT = "public/icons";

const INDIGO = { r: 0x4f, g: 0x46, b: 0xe5, alpha: 1 }; // brand --primary
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const STD_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const MASKABLE_SIZES = [192, 512];

async function run() {
  await mkdir(OUT, { recursive: true });
  const svg = await readFile(SRC);
  // High render density so upscales stay crisp.
  const src = () => sharp(svg, { density: 512 });

  // Standard icons (purpose: any) — full-bleed indigo square with the R.
  for (const s of STD_SIZES) {
    await src()
      .resize(s, s, { fit: "contain", background: TRANSPARENT })
      .png()
      .toFile(path.join(OUT, `icon-${s}x${s}.png`));
  }

  // Maskable icons — opaque indigo edge-to-edge with the mark inside the safe zone.
  for (const s of MASKABLE_SIZES) {
    const pad = Math.round(s * 0.12);
    await src()
      .resize(s - pad * 2, s - pad * 2, { fit: "contain", background: INDIGO })
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: INDIGO })
      .png()
      .toFile(path.join(OUT, `icon-maskable-${s}x${s}.png`));
  }

  // Apple touch icon — iOS dislikes transparency, so keep it opaque indigo.
  await src()
    .resize(180, 180, { fit: "contain", background: INDIGO })
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
