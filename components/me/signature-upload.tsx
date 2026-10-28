"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { setMySignature } from "@/lib/me/signature-actions";

const ACCEPTED = "image/png,image/jpeg,image/webp";
const MAX_SIZE = 1024 * 1024; // 1 MB — the bucket's own ceiling (0764)

/**
 * MY SIGNATURE (user 2026-10-28, 0764) — "capture a permanent snapshot of that
 * approver's digital signature image … embed [it] onto the Authorized Signatory
 * block of the official PO PDF".
 *
 * Uploaded to the PRIVATE `signatures` bucket under the login's own folder, as a
 * NEW file every time (never overwritten): a PO approved last month keeps pointing
 * at the image it was approved with. A PNG on a transparent or white background
 * prints best.
 */
export function SignatureUpload({ url }: { url: string | null }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function upload(file: File) {
    if (!ACCEPTED.split(",").includes(file.type)) return toastError("Use a PNG, JPG or WEBP image");
    if (file.size > MAX_SIZE) return toastError("The image must be 1 MB or smaller");
    setUploading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return toastError("Sign in again, then upload");
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("signatures").upload(path, file, { upsert: false });
      if (error) return toastError(`The signature could not be uploaded: ${error.message}`);
      startTransition(async () => {
        const res = await setMySignature(path);
        if (!res.ok) return toastError(res.error);
        success("Signature saved — it prints on what you approve from now on");
        router.refresh();
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const busy = uploading || isPending;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex h-20 w-56 items-center justify-center rounded-md border border-dashed border-border bg-white">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL
          <img src={url} alt="Your signature" className="max-h-16 max-w-[13rem] object-contain" />
        ) : (
          <span className="text-xs text-muted-foreground">No signature yet</span>
        )}
      </div>
      <div className="space-y-1">
        <Button type="button" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "Saving…" : url ? "Replace signature" : "Upload signature"}
        </Button>
        <p className="max-w-xs text-xs text-muted-foreground">
          Printed on purchase orders you approve. A PNG on a white or clear background works best. Replacing it
          does not change POs you already approved.
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        aria-label="Signature image"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
    </div>
  );
}
