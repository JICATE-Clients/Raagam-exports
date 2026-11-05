"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { openingStockInput, type OpeningOrderPlan, type OpeningStockInput } from "./types";
import { getOpeningOrderPlan } from "./service";

type Err = { ok: false; error: string };

const LIST = "/purchase/opening-stock";

function bad(m: string): Err {
  return { ok: false, error: m };
}
function revalidate(id?: string) {
  revalidatePath(LIST);
  if (id) revalidatePath(`${LIST}/${id}`);
  revalidatePath("/purchase/store");
}

/**
 * SAVE, OR SAVE & POST, IN ONE TRANSACTION (`opening_stock_save`, 0801). The header and its
 * line set are replaced together; with `post` the same statement writes the stock rows, and a
 * refused post rolls the save back with it — no half-posted draft, GRN's rule. The SQL is the
 * guard (store in this unit, Rejected / Replacement only in the Rejection store, bins hold the
 * qty exactly); the parse here only turns a malformed form into a sentence.
 */
export async function saveOpeningStock(
  id: string | null,
  payload: OpeningStockInput,
  post: boolean,
): Promise<{ ok: true; id: string } | Err> {
  if (!(await can("stores", id || post ? "edit" : "create"))) return bad("Forbidden");
  const p = openingStockInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const { lines, ...doc } = p.data;

  const s = await createClient();
  const { data, error } = await s.rpc("opening_stock_save", {
    p_id: id,
    p_doc: doc,
    p_lines: lines,
    p_post: post,
  });
  if (error) return bad(error.message);
  const docId = data as string;
  if (post) await writeAudit({ action: "opening_stock.posted", entityType: "opening_stock", entityId: docId });
  revalidate(docId);
  return { ok: true, id: docId };
}

export async function deleteOpeningStock(id: string): Promise<{ ok: true } | Err> {
  if (!(await can("stores", "delete"))) return bad("Forbidden");
  const s = await createClient();
  const { data, error } = await s.from("opening_stocks").delete().eq("id", id).eq("status", "draft").select("id");
  if (error) return bad(error.message);
  if (!data?.length) return bad("Only a draft can be deleted — a posted opening stock is already in the ledger");
  revalidate();
  return { ok: true };
}

/** The Order No picker changed: fetch that order's plan for the line's Item list. */
export async function loadOpeningOrderPlan(orderId: string): Promise<OpeningOrderPlan> {
  if (!(await can("stores", "view"))) return { orderId, error: "Forbidden" };
  return getOpeningOrderPlan(orderId);
}
