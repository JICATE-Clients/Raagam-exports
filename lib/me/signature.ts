import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * MY SIGNATURE (0764) — the image an approval of mine prints on a document. Read
 * with the caller's own session: the `signatures` bucket lets a login read only
 * its own folder, and `profiles` lets it read only its own row.
 */
export async function getMySignature(): Promise<{ path: string | null; url: string | null }> {
  const s = await createClient();
  const {
    data: { user },
  } = await s.auth.getUser();
  if (!user) return { path: null, url: null };
  const { data } = await s.from("profiles").select("signature_path").eq("id", user.id).maybeSingle();
  const path = (data as { signature_path: string | null } | null)?.signature_path ?? null;
  if (!path) return { path: null, url: null };
  const { data: signed } = await s.storage.from("signatures").createSignedUrl(path, 600);
  return { path, url: signed?.signedUrl ?? null };
}
