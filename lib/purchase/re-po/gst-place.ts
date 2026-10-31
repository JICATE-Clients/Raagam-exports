import "server-only";
import { createClient } from "@/lib/supabase/server";
import { gstStateCode } from "./types";

/**
 * WHERE EACH SIDE OF A PO IS REGISTERED FOR GST (user 2026-10-31: CGST + SGST vs IGST
 * follows "Vendor State vs Unit State", editable after). Returned as the two-digit GST
 * state code — 33 is Tamil Nadu — because that is what decides the tax, not the state's
 * name: a GSTIN starts with it, and `states.code` holds it for an address.
 *
 * Vendor: its GSTIN first, else the state on its first address that has one.
 * Unit:   the current unit's GSTIN (`locations.gst_number`), else the company's
 *         (`company_profile.gstin`) — no unit carries its own today, so that is the one read.
 * A side that resolves to nothing is left out / null, and the screen then leaves the
 * slab as it is rather than guessing.
 */
export async function getGstPlaces(): Promise<{ unit: string | null; vendors: Record<string, string>; names: Record<string, string> }> {
  const s = await createClient();
  const [locRes, coRes, vendRes, addrRes, stateRes] = await Promise.all([
    s.rpc("current_location"),
    s.from("company_profile").select("gstin").limit(1).maybeSingle(),
    s.from("master_vendors").select("id, gst_no"),
    s.from("master_vendor_addresses").select("vendor_id, sno, states!state_id(code)").not("state_id", "is", null),
    // The words the screen says ("Tamil Nadu"), keyed by the code it decides on.
    s.from("states").select("code, name"),
  ]);

  let unit: string | null = null;
  const locId = (locRes.data as string | null) ?? null;
  if (locId) {
    const { data } = await s.from("locations").select("gst_number").eq("id", locId).maybeSingle();
    unit = gstStateCode((data as { gst_number: string | null } | null)?.gst_number);
  }
  unit ??= gstStateCode((coRes.data as { gstin: string | null } | null)?.gstin);

  // First address (lowest sno) with a state, per vendor.
  const addrCode = new Map<string, { sno: number; code: string }>();
  for (const a of (addrRes.data ?? []) as unknown as { vendor_id: string; sno: number | null; states: { code: string | null } | null }[]) {
    const code = gstStateCode(a.states?.code);
    if (!code) continue;
    const sno = a.sno ?? Number.MAX_SAFE_INTEGER;
    const cur = addrCode.get(a.vendor_id);
    if (!cur || sno < cur.sno) addrCode.set(a.vendor_id, { sno, code });
  }
  const vendors: Record<string, string> = {};
  for (const v of (vendRes.data ?? []) as { id: string; gst_no: string | null }[]) {
    const code = gstStateCode(v.gst_no) ?? addrCode.get(v.id)?.code ?? null;
    if (code) vendors[v.id] = code;
  }
  const names: Record<string, string> = {};
  for (const st of (stateRes.data ?? []) as { code: string | null; name: string | null }[]) {
    const code = gstStateCode(st.code);
    if (code && st.name && !names[code]) names[code] = st.name;
  }
  return { unit, vendors, names };
}
