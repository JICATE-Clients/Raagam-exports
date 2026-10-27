import type { SupabaseClient } from "@supabase/supabase-js";
import { COMM_BUCKET } from "./types";

/**
 * Upload one file to the private comm-files bucket WITH PROGRESS.
 *
 * The same request supabase-js's `storage.upload()` makes — the Storage REST
 * endpoint, the signed-in user's own access token, never the service role —
 * but through XMLHttpRequest, because fetch() cannot report upload progress
 * and a 20 MB drawing on a factory connection needs a bar, not a spinner.
 * Storage applies the same bucket limits and the same insert policy (an
 * active member of the folder's conversation) as before; nothing about WHO
 * may upload changes here.
 *
 * `x-upsert: false`: a key is never overwritten. Keys are generated
 * (attachmentPath), never taken from the file name.
 */
export async function uploadWithProgress(
  supabase: SupabaseClient,
  path: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !base || !anon) return { ok: false, error: "You are signed out." };

  const url = `${base}/storage/v1/object/${COMM_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", anon);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(e.loaded / e.total, 1));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve({ ok: true });
      } else if (xhr.status === 413) {
        resolve({ ok: false, error: "The file is over 20 MB." });
      } else if (xhr.status === 400 || xhr.status === 415) {
        resolve({ ok: false, error: "That file type cannot be shared here." });
      } else if (xhr.status === 403 || xhr.status === 401) {
        resolve({ ok: false, error: "You cannot add files to this conversation." });
      } else {
        resolve({ ok: false, error: "Upload failed. Try again." });
      }
    };
    xhr.onerror = () => resolve({ ok: false, error: "Upload failed. Check the connection and try again." });
    xhr.onabort = () => resolve({ ok: false, error: "Upload cancelled." });
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}
