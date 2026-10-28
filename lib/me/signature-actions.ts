"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Point my profile at a signature file I just uploaded (0764). `set_my_signature`
 * refuses a path outside the caller's own folder, so this cannot name someone
 * else's signature. The old file is kept, never deleted: a PO approved with it
 * still prints it.
 */
export async function setMySignature(path: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await createClient();
  const { error } = await s.rpc("set_my_signature", { p_path: path });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/my-profile");
  return { ok: true };
}
