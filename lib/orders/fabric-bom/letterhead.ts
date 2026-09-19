/**
 * THE DOCUMENT LETTERHEAD'S LOGO — one rule for the on-screen reports and the
 * PDF downloads (client 2026-09-19: "the report … with logo and more
 * professional look").
 *
 * Client-safe (no `server-only`): `reports.ts` resolves WHICH logo on the
 * server; the PDF exporter, which runs in the browser, loads the image bytes.
 *
 * ## WHERE THE LOGO COMES FROM, IN ORDER
 *
 * 1. `company_profile.logo_with_name`, then `.logo` — the Company Profile's own
 *    logo, once one is stored there.
 * 2. Otherwise the Raagam wordmark shipped in `public/brand/` — cut from the
 *    client's own logo file on 2026-08-21 for the app icons. It is the
 *    PLACEHOLDER until a logo is stored on the Company Profile (the live table
 *    holds no row at all today, so this is what prints).
 *
 * "Show logo on documents" (`with_logo`) is honoured ONLY when a profile row
 * exists: a profile saved with the box unticked prints no logo, as the box
 * says. With no profile at all there is nothing to honour, and the placeholder
 * shows.
 */

/** The placeholder — the client's own wordmark, already in the app. */
export const DEFAULT_LETTERHEAD_LOGO = "/brand/raagam-wordmark.png";

/** A stored value the page can actually load: a URL, a site path or a data
 *  URL. Anything else (a bare filename, an id) is not an image we can draw. */
const loadable = (v: string | null | undefined): v is string =>
  !!v && /^(https?:\/\/|\/|data:image\/)/i.test(v.trim());

/**
 * The logo a document should carry, or null for "no logo".
 * `profile` is the raw `company_profile` row (or null when there is none).
 */
export function letterheadLogoOf(profile: Record<string, unknown> | null): string | null {
  if (!profile) return DEFAULT_LETTERHEAD_LOGO;
  if (profile.with_logo === false) return null;
  const stored = [profile.logo_with_name, profile.logo].find(
    (v): v is string => typeof v === "string" && loadable(v),
  );
  return stored?.trim() ?? DEFAULT_LETTERHEAD_LOGO;
}

/** An image ready for `jsPDF.addImage` — a PNG data URL plus its natural
 *  size, so the PDF can keep the aspect ratio. */
export type LetterheadImage = { dataUrl: string; width: number; height: number };

const cache = new Map<string, Promise<LetterheadImage | null>>();

/**
 * Load a logo for a PDF (browser only). Drawn through a canvas so ANY image
 * the browser can show (PNG, JPEG, WebP, SVG) reaches jsPDF as a PNG, which it
 * always accepts. Resolves null — never throws — when the image cannot be
 * loaded: a missing logo must not stop a document from downloading. Cached per
 * source, so repeated downloads fetch once.
 */
export function loadLetterheadImage(src: string | null): Promise<LetterheadImage | null> {
  if (!src || typeof window === "undefined") return Promise.resolve(null);
  const held = cache.get(src);
  if (held) return held;
  const p = new Promise<LetterheadImage | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx || !canvas.width || !canvas.height) return resolve(null);
        ctx.drawImage(img, 0, 0);
        resolve({ dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height });
      } catch {
        // A cross-origin image without CORS headers taints the canvas.
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
  cache.set(src, p);
  return p;
}

/** Fit an image into a box, keeping its aspect ratio. */
export function fitLogo(img: LetterheadImage, maxW: number, maxH: number): { w: number; h: number } {
  const scale = Math.min(maxW / img.width, maxH / img.height);
  return { w: img.width * scale, h: img.height * scale };
}

/**
 * THE COMPANY'S ADDRESS, ONE LINE (2026-09-19). The Company Profile stores it
 * as `street1..3`, `city`, `state`, `pin_code` — there is no `address` column,
 * and every document letterhead was reading `address ?? address_line1`, so an
 * address typed on the profile could never print. One function for every
 * letterhead that shows it; null when the profile states none.
 */
export function companyAddressOf(profile: Record<string, unknown> | null): string | null {
  if (!profile) return null;
  const s = (k: string) => (typeof profile[k] === "string" ? (profile[k] as string).trim() : "");
  const cityPin = [s("city"), s("pin_code")].filter(Boolean).join(" - ");
  const parts = [s("street1"), s("street2"), s("street3"), cityPin, s("state")].filter(Boolean);
  /* A legacy single-column address, should a row ever carry one. */
  const legacy = s("address") || s("address_line1");
  return parts.length ? parts.join(", ") : legacy || null;
}
