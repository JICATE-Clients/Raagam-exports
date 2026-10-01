"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  isPoImportPath,
  PO_IMPORT_BUCKET,
  PO_IMPORT_MAX_BYTES,
  PO_IMPORT_PREFIX,
  poFileKind,
  poImportStoredSchema,
  type PoImportStored,
} from "./types";

/**
 * Upload buyer PO — the writes (doc/order/digitalisation-plan.md §2, 0669).
 *
 * The FILE is uploaded by the browser straight to the bucket (server actions
 * cap a body at 1 MB, and a buyer's PDF is routinely larger); these actions
 * only ever handle its PATH. Reading it with the model is the POST route
 * `/api/orders/po-import`, because a server action is queued behind every
 * other action on the page and the read can take a minute.
 *
 * NONE OF THESE CREATES AN ORDER. The order exists only once the merchandiser
 * presses Save on Order Entry.
 */

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Register an uploaded PO file. `id` is minted by the browser so the file could be uploaded under it first. */
export async function createPoImport(input: {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
}): Promise<Result<{ id: string }>> {
  if (!(await can("orders", "create"))) return { ok: false, error: "You need permission to create orders." };
  if (!UUID.test(input.id)) return { ok: false, error: "Invalid upload id." };
  if (!isPoImportPath(input.id, input.storage_path)) return { ok: false, error: "The file is not in this upload's folder." };
  if (!poFileKind(input.file_name, input.mime_type)) {
    return { ok: false, error: "Only PDF, Excel (.xlsx), CSV or image files can be read." };
  }
  if (input.size_bytes > PO_IMPORT_MAX_BYTES) return { ok: false, error: "The file is larger than 15 MB." };

  const sb = await createClient();
  const { error } = await sb.from("order_po_imports").insert({
    id: input.id,
    storage_path: input.storage_path,
    file_name: input.file_name.slice(0, 255),
    mime_type: input.mime_type,
    status: "uploaded",
  });
  if (error) return { ok: false, error: `The upload could not be recorded: ${error.message}` };
  await writeAudit({
    action: "order.po_import.uploaded",
    entityType: "order_po_imports",
    entityId: input.id,
    metadata: { file_name: input.file_name },
  });
  return { ok: true, data: { id: input.id } };
}

/** Save the reviewer's edited draft and master choices. */
export async function savePoDraft(id: string, stored: PoImportStored): Promise<Result> {
  if (!(await can("orders", "create"))) return { ok: false, error: "You need permission to create orders." };
  const parsed = poImportStoredSchema.safeParse(stored);
  if (!parsed.success) return { ok: false, error: "The draft is not in the expected shape." };
  const sb = await createClient();
  const { error } = await sb
    .from("order_po_imports")
    .update({ extracted: parsed.data, status: "extracted" })
    .eq("id", id)
    .in("status", ["extracted", "used"]);
  if (error) return { ok: false, error: `The draft could not be saved: ${error.message}` };
  revalidatePath("/orders/po-import");
  return { ok: true, data: undefined };
}

export type PoDraftForOrder = {
  stored: PoImportStored;
  file: { storage_path: string; file_name: string; mime_type: string; size_bytes: number };
};

/**
 * What Order Entry's `?draft=<id>` reads. Marks the import `used` — the draft
 * has been handed to an order form. (Which order it became is not known here:
 * the order is only created by Order Entry's own Save, and an unsaved form is
 * not an order.)
 */
export async function loadPoDraftForOrder(id: string): Promise<Result<PoDraftForOrder>> {
  if (!(await can("orders", "create"))) return { ok: false, error: "You need permission to create orders." };
  if (!UUID.test(id)) return { ok: false, error: "Invalid draft id." };
  const sb = await createClient();
  const { data, error } = await sb
    .from("order_po_imports")
    .select("id, storage_path, file_name, mime_type, status, extracted")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: `The PO draft could not be read: ${error.message}` };
  if (!data) return { ok: false, error: "That PO draft was not found." };
  const parsed = poImportStoredSchema.safeParse(data.extracted);
  if (!parsed.success) return { ok: false, error: "That PO has not been read yet. Open it on Upload Buyer PO first." };

  // The file's size, for the attachment row — from the bucket's own listing.
  const folder = `${PO_IMPORT_PREFIX}/${id}`;
  const name = String(data.storage_path).slice(folder.length + 1);
  const { data: listed } = await sb.storage.from(PO_IMPORT_BUCKET).list(folder, { search: name });
  const size = Number((listed ?? []).find((o) => o.name === name)?.metadata?.size ?? 0);

  await sb.from("order_po_imports").update({ status: "used" }).eq("id", id);
  return {
    ok: true,
    data: {
      stored: parsed.data,
      file: {
        storage_path: String(data.storage_path),
        file_name: String(data.file_name),
        mime_type: String(data.mime_type ?? "application/octet-stream"),
        size_bytes: Number.isFinite(size) ? size : 0,
      },
    },
  };
}
