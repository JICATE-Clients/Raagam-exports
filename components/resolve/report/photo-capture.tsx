"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImageUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { encodePhoto } from "./encode-jpeg";

export type CapturedPhoto = { file: File; url: string };

/**
 * A PHOTO OF THE PROBLEM — the REAR camera, or a file.
 *
 * Local rather than the shared `PhotoUpload`, deliberately: that one asks for
 * `facingMode: "user"` (it photographs a new joiner at the HR desk), uploads to
 * a public bucket straight from the browser, and hands back a public URL. A
 * report photo points AWAY from the reporter, goes to a PRIVATE bucket through
 * the server action (which verifies the bytes and strips metadata again), and
 * must not exist anywhere until the report is sent. So this only holds a
 * re-encoded `File` in memory; the form posts it.
 *
 * Two ways in, like `PhotoUpload`: the live camera (`getUserMedia`, works on a
 * desktop webcam too) and a file. Where the camera API is missing or refused,
 * "Take photo" falls back to `<input capture="environment">`, which a phone
 * answers by opening its own camera app.
 */
export function PhotoCapture({
  value,
  onChange,
  disabled = false,
  zIndexBase,
  takeLabel = "Take photo",
}: {
  value: CapturedPhoto | null;
  onChange: (next: CapturedPhoto | null) => void;
  disabled?: boolean;
  /** Raise when this sits inside another Sheet, so the camera stacks above it. */
  zIndexBase?: number;
  takeLabel?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraFileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /* True while the camera sheet is meant to be open — a stream that resolves
     after the operator already closed it is stopped instead of kept. */
  const wantCamRef = useRef(false);
  const [camOpen, setCamOpen] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }
  /* A component unmounted with the camera open would leave the light on. */
  useEffect(() => stopCamera, []);

  /* The preview's object URL is released when the photo is replaced or dropped. */
  useEffect(() => {
    const url = value?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [value?.url]);

  async function accept(source: Blob | HTMLVideoElement) {
    setBusy(true);
    setError(null);
    try {
      const file = await encodePhoto(source);
      onChange({ file, url: URL.createObjectURL(file) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The photo could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  async function openCamera() {
    setError(null);
    setCamError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      // No camera API (old browser, or plain http): let the phone's own camera answer.
      cameraFileRef.current?.click();
      return;
    }
    setCamOpen(true);
    wantCamRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!wantCamRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video && video.srcObject !== stream) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
    } catch {
      setCamError("The camera could not be opened. Choose a photo instead.");
    }
  }

  function closeCamera() {
    wantCamRef.current = false;
    stopCamera();
    setCamOpen(false);
  }

  async function snap() {
    const video = videoRef.current;
    if (!video) return;
    await accept(video);
    closeCamera();
  }

  function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    closeCamera();
    if (f) void accept(f);
  }

  return (
    <div className="space-y-2">
      {value ? (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not a remote image. */}
          <img
            src={value.url}
            alt="Photo of the problem"
            className="max-h-48 rounded-lg border border-border object-contain"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute right-1 top-1"
            aria-label="Remove photo"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={disabled || busy} onClick={openCamera}>
          <Camera className="h-4 w-4" aria-hidden />
          {busy ? "Preparing…" : value ? "Retake" : takeLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy}
          onClick={() => fileRef.current?.click()}
        >
          <ImageUp className="h-4 w-4" aria-hidden />
          Choose photo
        </Button>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {/* Two hidden pickers: a plain one, and one that asks a phone for its rear camera. */}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPicked} />
      <input
        ref={cameraFileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPicked}
      />

      <Sheet
        open={camOpen}
        onClose={closeCamera}
        title="Take a photo"
        size="sm"
        zIndexBase={zIndexBase}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
              Choose photo
            </Button>
            {!camError ? (
              <Button type="button" disabled={busy} onClick={snap}>
                <Camera className="h-4 w-4" aria-hidden />
                Capture
              </Button>
            ) : null}
          </div>
        }
      >
        {camError ? (
          <p className="text-sm text-muted-foreground">{camError}</p>
        ) : (
          <video
            /* A callback ref: the Sheet portals after mount, so the stream can
               arrive before OR after this element exists — attach on whichever
               comes second. */
            ref={(el) => {
              videoRef.current = el;
              if (el && streamRef.current && el.srcObject !== streamRef.current) {
                el.srcObject = streamRef.current;
                void el.play().catch(() => {});
              }
            }}
            playsInline
            muted
            className="aspect-[4/3] w-full rounded-lg bg-black object-cover"
          />
        )}
      </Sheet>
    </div>
  );
}
