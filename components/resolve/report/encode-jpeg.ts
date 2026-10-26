/*
 * A PHOTO LEAVES THE PHONE AS A SMALL JPEG WITH NOTHING BUT PIXELS IN IT.
 *
 * Every image the reporter supplies — a camera frame or a picked file — is
 * redrawn onto a canvas and encoded fresh. That one pass does three jobs:
 *
 * - **Size.** A phone photo is 3–8 MB at 4000px; the longest edge is scaled to
 *   1600px, which still shows a cracked tile, and the server caps uploads at 2 MB.
 * - **Format.** HEIC / PNG / WebP all come out as JPEG, the one type the server's
 *   magic-byte check (`lib/resolve/jpeg.ts`) accepts.
 * - **Privacy.** A canvas holds pixels only, so the camera's EXIF block — GPS
 *   included — does not survive the re-encode. The server strips APP segments
 *   again regardless; this is the first of two locks, not the only one.
 *
 * `createImageBitmap(…, { imageOrientation: "from-image" })` applies the EXIF
 * rotation BEFORE it is thrown away, so a portrait photo is not saved sideways.
 */

export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const QUALITIES = [0.82, 0.7, 0.55];

async function decode(source: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      // color-token: exempt -- a createImageBitmap option, not a Tailwind class.
      const bmp = await createImageBitmap(source, { imageOrientation: "from-image" });
      return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch {
      // Fall through to <img>, which some browsers decode where the bitmap API refuses.
    }
  }
  const url = URL.createObjectURL(source);
  try {
    const el = new Image();
    el.decoding = "async";
    el.src = url;
    await el.decode();
    return { img: el, w: el.naturalWidth, h: el.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Redraw any image (or a video frame already drawn by the caller) as a JPEG
 * under the size cap. Throws an Error whose message is the sentence to show.
 */
export async function encodePhoto(source: Blob | HTMLVideoElement): Promise<File> {
  let img: CanvasImageSource;
  let w: number;
  let h: number;
  let close = () => {};
  if (source instanceof Blob) {
    if (source.type && !source.type.startsWith("image/")) {
      throw new Error("That file is not a picture. Choose a photo.");
    }
    try {
      ({ img, w, h, close } = await decode(source));
    } catch {
      throw new Error("This picture could not be opened. Try taking it again, or choose a JPG.");
    }
  } else {
    img = source;
    w = source.videoWidth;
    h = source.videoHeight;
  }
  if (!w || !h) {
    close();
    throw new Error("The camera has not started yet. Try again in a moment.");
  }

  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    close();
    throw new Error("This browser cannot prepare the photo. Try another browser.");
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  close();

  for (const q of QUALITIES) {
    const blob = await toJpeg(canvas, q);
    if (blob && blob.size <= PHOTO_MAX_BYTES) {
      return new File([blob], "photo.jpg", { type: "image/jpeg" });
    }
  }
  throw new Error("The photo is still over 2 MB after shrinking. Take it again a little further back.");
}
