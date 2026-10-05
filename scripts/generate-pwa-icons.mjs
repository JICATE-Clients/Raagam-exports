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

  /*
   * THE MARK FOR AN OPAQUE ICON — every pixel that is not fully opaque takes
   * the brand green as its colour, keeping its alpha. The roundel's transparent
   * corners AND its anti-aliased rim carry WHITE colour channels; flattened
   * as-is, the corners came out white (a ring) and the rim a thin white arc.
   * Recoloured first, the rim fades green into green and no edge is left.
   * Fully opaque pixels — the white "Re" included — are untouched.
   */
  const { data: px, info } = await sharp(art).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 255) {
      px[i] = BRAND.r;
      px[i + 1] = BRAND.g;
      px[i + 2] = BRAND.b;
    }
  }
  /*
   * AND THE RIM'S LIGHT FRINGE. The roundel was cut out of a JPEG, and along
   * its top and right edge a 1-3px band of near-white survived the cut, fully
   * OPAQUE — invisible on white, a white arc on the green field. Everything
   * beyond 96% of the radius is set to the brand green: one rule for the whole
   * band, rather than guessing pixel by pixel which light pixel is fringe (that
   * was tried, and nicked the "R" and "e" where they meet the rim). The only
   * artwork in that band is the R's outer stroke, already cut by the circle.
   */
  const { width: W, height: H } = info;
  const cx = W / 2, cy = H / 2, keep = (Math.min(W, H) / 2) * 0.96;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (Math.hypot(x - cx, y - cy) <= keep) continue;
      const i = (y * W + x) * 4;
      px[i] = BRAND.r;
      px[i + 1] = BRAND.g;
      px[i + 2] = BRAND.b;
      px[i + 3] = 255;
    }
  }
  const opaqueArt = await sharp(px, { raw: info }).png().toBuffer();
  const opaqueSrc = () => sharp(opaqueArt).flatten({ background: BRAND });

  // Standard icons (purpose: any) — the roundel on transparency, so a launcher
  // that does not mask gets the circle rather than a square.
  for (const s of STD_SIZES) {
    await src()
      .resize(s, s, { fit: "contain", background: TRANSPARENT })
      .png()
      .toFile(path.join(OUT, `icon-${s}x${s}.png`));
  }

  // Maskable icons — opaque green edge-to-edge with the mark inside the safe zone.
  //
  // FLATTENED FIRST (client 2026-10-05: "in that app downloading thumbnail came
  // with one extra round ... remove the border"). The roundel is transparent
  // outside its circle, and `resize`'s `background` only fills the padding it
  // ADDS — the mark's own transparent corners stayed see-through and read as a
  // WHITE RING between the logo circle and the green field. Cropped to a circle
  // by the launcher, that was a circle inside a bordered circle. Flattening onto
  // the brand green (which IS the roundel's own green, #85c227 sampled) — see
  // `opaqueArt` — makes the field and the circle one colour, so the crop
  // shows ONE circle.
  for (const s of MASKABLE_SIZES) {
    const pad = Math.round(s * 0.12);
    await opaqueSrc()
      .resize(s - pad * 2, s - pad * 2, { fit: "contain", background: BRAND })
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: BRAND })
      .png()
      .toFile(path.join(OUT, `icon-maskable-${s}x${s}.png`));
  }

  // Apple touch icon — iOS dislikes transparency, so keep it opaque green.
  // Flattened for the same reason as the maskable set: without it the corners
  // stayed transparent and iOS filled them, ringing the circle.
  await opaqueSrc()
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
