"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useModalGuard } from "@/lib/reload-guard";

/** Lets a surface that draws its own preview open the full photo (the HR
 *  profile card's avatar). */
export type PhotoUploadHandle = { view: () => void };

type Props = {
  ref?: Ref<PhotoUploadHandle>;
  /**
   * Draw the 80px thumbnail beside the button. Default true.
   *
   * Off where the SURFACE already shows the photo — the HR profile column puts
   * a 112px avatar above this control, and two previews of one value is the
   * "No photo" box sitting under a picture of the person (client 2026-09-16,
   * "fix the cards alignment"). The buttons and the size hint stay either way.
   *
   * It also CENTRES the controls, because the only surface that turns the
   * preview off is a centred profile card (client 2026-09-18: "make the upload
   * button at center").
   */
  showPreview?: boolean;
  value: string | null;
  onChange: (url: string | null) => void;
  bucket?: string;
  folder?: string;
  disabled?: boolean;
  /** How the preview draws the image. `cover` (default) crops to the square —
   *  right for a face; `contain` shows the whole image — right for a logo,
   *  which is usually wide and must not lose its ends (2026-09-19). */
  fit?: "cover" | "contain";
  /** The empty preview's text. Default "No photo". */
  emptyLabel?: string;
};

const ACCEPTED = "image/jpeg,image/png,image/webp";
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB

/** The longest edge a captured frame is scaled to before it is encoded. */
const CAPTURE_MAX_EDGE = 1280;

/**
 * A PHOTOGRAPH, TAKEN OR CHOSEN (client 2026-09-18: "when i click the upload
 * button i can both click a photo with camera and can upload my image also").
 *
 * ONE BUTTON, TWO WAYS IN. Pressing it opens the camera and offers the file
 * picker beside it, rather than making the operator decide which kind of
 * photograph they are about to supply before anything is on screen. A new
 * joiner standing at the HR desk is photographed; a record being completed
 * later gets a file.
 *
 * THE CAMERA IS `getUserMedia`, NOT `<input capture>`. The capture attribute
 * is honoured on phones and ignored on every desktop browser — on the office
 * machines where staff records are actually typed it would silently be an
 * ordinary file picker, which is the half-working shape this replaces. It
 * needs a secure context (https, or localhost), so if it is refused — no
 * camera, permission denied, an http deployment — the panel says so and the
 * file picker is right there. Never a dead end.
 */
export function PhotoUpload({
  ref,
  value,
  onChange,
  bucket = "employee-photos",
  folder = "photos",
  disabled,
  showPreview = true,
  fit = "cover",
  emptyLabel = "No photo",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);

  useImperativeHandle(ref, () => ({ view: () => setViewing(!!value) }), [value]);

  /* A hand-rolled overlay is invisible to the reload guard's DOM scan, so it
     declares itself — otherwise a deploy landing while the camera is open
     reloads the tab mid-capture (AGENTS.md, "Auto-reload guard"). */
  useModalGuard(picking);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  /* The stream outlives React's tree unless it is told not to: a component
     unmounted with the panel open leaves the camera light on. */
  useEffect(() => stopCamera, []);

  async function openPicker() {
    setError(null);
    setCamError(null);
    setPicking(true);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError("This browser cannot reach a camera. Choose a file instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch {
      setCamError("No camera available. Choose a file instead.");
    }
  }

  function closePicker() {
    stopCamera();
    setPicking(false);
  }

  /** The current frame, scaled down and encoded as a JPEG under the size cap. */
  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const scale = Math.min(
      1,
      CAPTURE_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCamError("Could not take the photo. Try again.");
          return;
        }
        closePicker();
        void handleFile(
          new File([blob], "photo.jpg", { type: "image/jpeg" }),
        );
      },
      "image/jpeg",
      0.85,
    );
  }

  async function handleFile(file: File) {
    if (!ACCEPTED.split(",").includes(file.type)) {
      setError("Only JPG, PNG, or WebP images allowed.");
      return;
    }
    if (file.size > MAX_SIZE) {
      setError("Image must be under 2 MB.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${folder}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from(bucket)
        .upload(path, file, { upsert: true });
      if (uploadErr) {
        setError(uploadErr.message);
        return;
      }
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      onChange(data.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    if (!value) return;
    onChange(null);
  }

  return (
    <div
      className={
        showPreview
          ? "flex items-start gap-4"
          : "flex w-full flex-col items-center"
      }
    >
      {showPreview && (
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-muted">
          {value ? (
            <button
              type="button"
              aria-label="View the full photo"
              onClick={() => setViewing(true)}
              className="block h-full w-full cursor-zoom-in"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a Supabase storage public URL. */}
              <img
                src={value}
                alt="Photo"
                className={`h-full w-full ${fit === "contain" ? "object-contain p-1" : "object-cover"}`}
              />
            </button>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
              {emptyLabel}
            </div>
          )}
        </div>
      )}
      <div className={showPreview ? "space-y-1.5" : "space-y-1.5 text-center"}>
        {/* The format and size line is gone (client 2026-09-18: "the wording
            jpg and all remove it"). Nothing is lost that the operator needs
            before acting — a wrong type or an oversized image is still
            refused, by name, in the error line below. */}
        <div className={showPreview ? "flex gap-2" : "flex justify-center gap-2"}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || uploading}
            onClick={openPicker}
          >
            {uploading ? "Uploading..." : value ? "Change" : "Upload"}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={handleRemove}
            >
              Remove
            </Button>
          )}
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            closePicker();
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <PhotoViewer
        src={viewing ? value : null}
        alt="Photo"
        onClose={() => setViewing(false)}
        onChange={
          disabled
            ? undefined
            : () => {
                setViewing(false);
                void openPicker();
              }
        }
        onRemove={
          disabled
            ? undefined
            : () => {
                setViewing(false);
                void handleRemove();
              }
        }
      />

      {picking && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Take a photo"
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          onClick={closePicker}
        >
          <div
            className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-surface p-4 text-left shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-foreground">Add a photo</p>

            {camError ? (
              <p className="text-xs text-muted-foreground">{camError}</p>
            ) : (
              <video
                ref={videoRef}
                playsInline
                muted
                className="aspect-[4/3] w-full rounded-lg bg-black object-cover"
              />
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={closePicker}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
              >
                Choose file
              </Button>
              {!camError && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={capture}
                >
                  Take photo
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * THE PHOTO, FULL SIZE (client 2026-11-06: "if i click the image it should pop
 * up in full image so that i can drop or change anything, like other apps do").
 *
 * Open while `src` is set. Change and Remove are offered only when passed: a
 * read-only profile shows the picture and Close. Esc, the backdrop and Close
 * all shut it; Esc is caught in the capture phase so it closes THIS layer and
 * does not also unwind the editor underneath (one layer per press).
 */
export function PhotoViewer({
  src,
  alt,
  onClose,
  onChange,
  onRemove,
}: {
  src: string | null | undefined;
  alt: string;
  onClose: () => void;
  onChange?: () => void;
  onRemove?: () => void;
}) {
  const open = !!src;
  // A hand-rolled overlay declares itself to the reload guard (AGENTS.md).
  useModalGuard(open);
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!src || typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/80 p-4"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a Supabase storage public URL. */}
      <img
        src={src}
        alt={alt}
        className="max-h-[78vh] max-w-full rounded-xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <div
        className="flex flex-wrap justify-center gap-2 rounded-xl bg-surface p-2 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {onChange && (
          <Button type="button" variant="outline" onClick={onChange}>
            Change
          </Button>
        )}
        {onRemove && (
          <Button type="button" variant="ghost" className="text-danger" onClick={onRemove}>
            Remove
          </Button>
        )}
        <Button type="button" variant="primary" autoFocus onClick={onClose}>
          Close
        </Button>
      </div>
    </div>,
    document.body,
  );
}
