"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Camera, Loader2, Trash2, Upload, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";
import { setChannelPhoto } from "@/lib/comms/channel-actions";
import { cn } from "@/lib/utils";

/**
 * A CHANNEL'S PROFILE PHOTO (user 2026-11-12, artifact "Channel Photo Upload").
 *
 * Pick a file → adjust it in a square (drag to move, slider to zoom) → it is
 * cropped in the browser to a 256 × 256 JPEG, so what is stored is small and
 * already square. Square with rounded corners everywhere, so a channel never
 * reads as a person's round photo.
 *
 * Bytes go straight from the browser to the `comm-channel-photos` bucket
 * (0839; the upload policy lets only someone who may edit the channel's info
 * write under its folder), then `setChannelPhoto` records the key and deletes
 * the previous file.
 */

export const CHANNEL_PHOTO_BUCKET = "comm-channel-photos";
/** The picked ORIGINAL may be large; it is cropped to a ~20 KB JPEG before upload (bucket cap 2 MB). */
const SOURCE_MAX = 10 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp";
const OUT = 256;
const VIEW = 224;

/** Upload a cropped photo for a channel and make it the channel's photo. */
export async function saveChannelPhoto(conversationId: string, blob: Blob): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = `${conversationId}/${crypto.randomUUID()}.jpg`;
  const { error } = await createClient().storage.from(CHANNEL_PHOTO_BUCKET).upload(key, blob, { contentType: "image/jpeg", upsert: false });
  if (error) return { ok: false, error: "The photo could not be uploaded. Try again." };
  const r = await setChannelPhoto(conversationId, key);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Check a picked file before it is shown in the cropper. */
export function photoFileProblem(f: File): string | null {
  if (!ACCEPT.split(",").includes(f.type)) return "Pick a JPG, PNG or WebP photo.";
  if (f.size > SOURCE_MAX) return "That photo is too large. Pick one under 10 MB.";
  return null;
}

/** A hidden file input plus a function that opens it. */
export function usePhotoFile(onPick: (f: File) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={ACCEPT}
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) onPick(f);
      }}
    />
  );
  return { input, open: () => ref.current?.click() };
}

/**
 * The square cropper. `file` open = the sheet shows; "Use photo" hands back a
 * 256 × 256 JPEG. The image is first scaled to COVER the square, so there is
 * never an empty edge; zoom goes up to 3×, and dragging is clamped to the image.
 */
export function ChannelPhotoCrop({
  file,
  busy = false,
  onCancel,
  onUse,
}: {
  file: File | null;
  busy?: boolean;
  onCancel: () => void;
  onUse: (blob: Blob) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    const raf = requestAnimationFrame(() => {
      setUrl(u);
      setNat(null);
      setZoom(1);
      setOff({ x: 0, y: 0 });
    });
    return () => {
      cancelAnimationFrame(raf);
      URL.revokeObjectURL(u);
    };
  }, [file]);

  const base = nat ? VIEW / Math.min(nat.w, nat.h) : 1;
  const scale = base * zoom;
  function clamp(o: { x: number; y: number }, z = zoom) {
    if (!nat) return o;
    const s = base * z;
    const mx = Math.max(0, (nat.w * s - VIEW) / 2);
    const my = Math.max(0, (nat.h * s - VIEW) / 2);
    return { x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
  }

  function onDown(e: ReactPointerEvent<HTMLDivElement>) {
    drag.current = { x: e.clientX - off.x, y: e.clientY - off.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setOff(clamp({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }));
  }

  function use() {
    const img = imgRef.current;
    if (!img || !nat) return;
    const c = document.createElement("canvas");
    c.width = c.height = OUT;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const k = OUT / VIEW;
    const dw = nat.w * scale * k;
    const dh = nat.h * scale * k;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, (OUT - dw) / 2 + off.x * k, (OUT - dh) / 2 + off.y * k, dw, dh);
    c.toBlob((b) => b && onUse(b), "image/jpeg", 0.88);
  }

  return (
    <Sheet
      open={!!file}
      onClose={onCancel}
      title="Adjust channel photo"
      size="sm"
      alignToPane
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={use} disabled={busy || !nat}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Use photo
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-3 py-1">
        <div
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          className="relative cursor-grab touch-none overflow-hidden rounded-2xl bg-neutral-900 ring-2 ring-inset ring-white/80 active:cursor-grabbing"
          style={{ width: VIEW, height: VIEW }}
        >
          {url && (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL being cropped.
            <img
              ref={imgRef}
              src={url}
              alt="Photo being adjusted"
              draggable={false}
              onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
              style={
                nat
                  ? { width: nat.w * scale, height: nat.h * scale, transform: `translate(calc(-50% + ${off.x}px), calc(-50% + ${off.y}px))` }
                  : { opacity: 0 }
              }
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground">Drag to move · slide to zoom</p>
        <label className="flex w-full max-w-[224px] items-center gap-2 text-muted-foreground">
          <ZoomOut className="h-4 w-4 shrink-0" aria-hidden />
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            aria-label="Zoom"
            onChange={(e) => {
              const z = Number(e.target.value);
              setZoom(z);
              setOff((o) => clamp(o, z));
            }}
            className="flex-1 accent-(--primary)"
          />
          <ZoomIn className="h-4 w-4 shrink-0" aria-hidden />
        </label>
      </div>
    </Sheet>
  );
}

/**
 * The photo slot on the New channel form: a 56px rounded square showing the
 * picked photo, or the channel's first letter with a camera badge. Nothing is
 * uploaded here — the channel does not exist yet; the form saves the blob
 * after `createChannel` returns the id.
 */
export function ChannelPhotoSlot({
  letter,
  blob,
  onChange,
  disabled = false,
}: {
  letter: string;
  blob: Blob | null;
  onChange: (next: Blob | null) => void;
  disabled?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const picker = usePhotoFile((f) => {
    const why = photoFileProblem(f);
    setError(why);
    if (!why) setFile(f);
  });

  useEffect(() => {
    if (!blob) {
      const raf = requestAnimationFrame(() => setPreview(null));
      return () => cancelAnimationFrame(raf);
    }
    const u = URL.createObjectURL(blob);
    const raf = requestAnimationFrame(() => setPreview(u));
    return () => {
      cancelAnimationFrame(raf);
      URL.revokeObjectURL(u);
    };
  }, [blob]);

  return (
    <div className="relative shrink-0">
      {picker.input}
      {/* button-shape: exempt -- a 56px photo tile, not an action button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => (blob ? setMenu((m) => !m) : picker.open())}
        aria-label={blob ? "Channel photo options" : "Add channel photo"}
        title={blob ? "Change or remove photo" : "Add channel photo"}
        className={cn(
          "grid h-14 w-14 place-items-center overflow-hidden rounded-2xl text-lg font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          blob ? "" : "border-[1.5px] border-dashed border-border bg-surface-muted text-muted-foreground hover:border-primary hover:text-primary",
        )}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local object URL preview.
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          letter
        )}
      </button>
      <span aria-hidden className="pointer-events-none absolute -bottom-1 -right-1 grid h-[22px] w-[22px] place-items-center rounded-full border-2 border-surface bg-primary text-primary-foreground">
        <Camera className="h-3 w-3" />
      </span>
      {menu && (
        <div role="menu" className="absolute left-0 top-[62px] z-30 min-w-[170px] rounded-lg border border-border bg-surface p-1 shadow-lg">
          {/* button-shape: exempt -- menu items */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              picker.open();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-muted"
          >
            <Upload className="h-4 w-4" aria-hidden /> Change photo
          </button>
          {/* button-shape: exempt -- menu items */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              onChange(null);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-danger hover:bg-surface-muted"
          >
            <Trash2 className="h-4 w-4" aria-hidden /> Remove photo
          </button>
        </div>
      )}
      {error && <p className="absolute left-0 top-[62px] z-20 w-56 text-xs text-danger" role="alert">{error}</p>}
      <ChannelPhotoCrop
        file={file}
        onCancel={() => setFile(null)}
        onUse={(b) => {
          setFile(null);
          onChange(b);
        }}
      />
    </div>
  );
}
