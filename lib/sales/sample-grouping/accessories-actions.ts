"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import { deleteInternalWorkOrder, saveInternalWorkOrder } from "@/lib/orders/internal-work-orders/actions";

/**
 * RAISE AN SWO'S ACCESSORIES WORK ORDER (0709; user 2026-10-12, screenshot
 * 3437: the Accessories Plan header is "SWO number from grouping, Date*").
 *
 * The Accessories Plan names its SWO, and a plan cannot exist without a work
 * order, so picking an SWO that has none raises its For-Accessories work order
 * in place — the Fabric Plan's picker does the same through
 * `raiseSampleGroupIw`. It is a SEPARATE link (`accessories_iwo_id`): `iwo_id`
 * stays the FABRIC work order, which Distribute, the dyeing work order and the
 * Fabric Plan all read.
 *
 * Any SWO past Draft qualifies — approval froze its samples, and accessories
 * can be planned while the fabric is still being bought. The status is not
 * moved: the SWO's statuses track the fabric batch.
 *
 * Created through the IW screen's own action, so it takes the session's unit,
 * is numbered SIW/…, and needs Orders ▸ Create. Linking the SWO needs Sales ▸
 * Edit (the group's own update policy). If the link fails, the work order just
 * raised is deleted again rather than left as an orphan with no SWO.
 */
export async function raiseSampleGroupAccessoriesIw(
  groupId: string,
): Promise<{ ok: true; iwoId: string } | { ok: false; error: string }> {
  if (!(await can("orders", "create"))) {
    // nav-path: exempt -- "Orders ▸ Create" names the permission, not a menu row
    return { ok: false, error: "Raising a work order needs Orders ▸ Create — ask someone who can raise work orders." };
  }
  if (!(await can("sales", "edit"))) return { ok: false, error: "You do not have permission to change a sample group." };

  const s = await createClient();
  const { data: g, error } = await s
    .from("sample_product_groups")
    .select("id, group_code, status, accessories_iwo_id, items:sample_group_items(style_id)")
    .eq("id", groupId)
    .maybeSingle();
  if (error) return { ok: false, error: `Could not read the SWO: ${error.message}` };
  if (!g) return { ok: false, error: "That SWO no longer exists." };
  const group = g as unknown as {
    id: string;
    group_code: string;
    status: string;
    accessories_iwo_id: string | null;
    items: { style_id: string }[] | null;
  };
  if (group.status === "draft") return { ok: false, error: `Approve ${group.group_code} on Sample ▸ Grouping first.` };
  if (group.accessories_iwo_id) return { ok: false, error: `${group.group_code} already has its accessories work order.` };

  // Delivery = the earliest sample's, as the fabric work order takes it.
  const styleIds = [...new Set((group.items ?? []).map((it) => it.style_id))];
  let deli: string | null = null;
  if (styleIds.length) {
    const { data: dates } = await s
      .from("styles")
      .select("delivery_date")
      .in("id", styleIds)
      .not("delivery_date", "is", null)
      .order("delivery_date", { ascending: true })
      .limit(1);
    deli = (dates?.[0] as { delivery_date: string } | undefined)?.delivery_date ?? null;
  }

  const iw = await saveInternalWorkOrder(null, {
    iwo_date: today(),
    iwo_for: "accessories",
    reference_no: group.group_code,
    deli_date: deli,
    remarks: `SAMPLE GROUP ${group.group_code}: ACCESSORIES`,
    is_sample: true,
  });
  if (!iw.ok) return iw;

  // `is null` in the filter: a second tab raising at the same moment links
  // nothing, and its work order is removed below.
  const { data: linked, error: linkErr } = await s
    .from("sample_product_groups")
    .update({ accessories_iwo_id: iw.iwoId })
    .eq("id", groupId)
    .is("accessories_iwo_id", null)
    .select("id");
  if (linkErr || !linked?.length) {
    await deleteInternalWorkOrder(iw.iwoId);
    return {
      ok: false,
      error: linkErr
        ? `Could not link the work order to ${group.group_code}: ${linkErr.message}`
        : `${group.group_code} was given an accessories work order meanwhile — pick it again.`,
    };
  }
  revalidatePath("/sales/sample-accessories-plan");
  return { ok: true, iwoId: iw.iwoId };
}
