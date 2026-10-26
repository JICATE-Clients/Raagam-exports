import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { inspectJpeg, MAX_PHOTO_BYTES, stripJpegMetadata } from "./jpeg";
import { fail, ok, type Result } from "./result";
import { PHOTO_BUCKET } from "./service";

/*
 * The ONLY writer to the `resolve-photos` bucket: it has no insert policy for
 * `authenticated`, so a photo reaches storage only through here — after the
 * magic bytes are checked and the EXIF / GPS segments are stripped.
 *
 * The object is uploaded BEFORE the RPC that records it (the RPC needs the
 * path), so a failed RPC must call `removePhoto` or the bucket keeps an orphan.
 */

/** Read a FormData photo field. Null when nothing was attached. */
export async function readPhoto(fd: FormData, field = "photo"): Promise<Result<Uint8Array | null>> {
  const v = fd.get(field);
  if (v === null || v === "" || (v instanceof File && v.size === 0)) return ok(null);
  if (!(v instanceof File)) return fail("The photo did not arrive — attach it again");
  if (v.size > MAX_PHOTO_BYTES) return fail("The photo is larger than 2 MB");
  return ok(new Uint8Array(await v.arrayBuffer()));
}

/** Validate, strip and upload. Returns the storage path. */
export async function uploadPhoto(bytes: Uint8Array): Promise<Result<string>> {
  const info = inspectJpeg(bytes);
  if (!info.ok) return fail(info.error);
  const clean = stripJpegMetadata(bytes);
  const path = `tickets/${new Date().getUTCFullYear()}/${crypto.randomUUID()}.jpg`;
  const { error } = await createAdminClient()
    .storage.from(PHOTO_BUCKET)
    .upload(path, clean, { contentType: "image/jpeg", upsert: false, cacheControl: "3600" });
  if (error) return fail(`The photo could not be saved: ${error.message}`);
  return ok(path);
}

/** Best-effort cleanup after the recording RPC refused. Never throws. */
export async function removePhoto(path: string | null): Promise<void> {
  if (!path) return;
  try {
    await createAdminClient().storage.from(PHOTO_BUCKET).remove([path]);
  } catch {
    // an orphan object is a storage cost, not a correctness problem
  }
}
