import "server-only";
import { createClient } from "@/lib/supabase/server";
import { letterheadLogoOf, registeredAddressOf } from "@/lib/orders/fabric-bom/letterhead";

/** The order documents' letterhead — company, registered address, unit, logo. */
export type DocLetterhead = {
  name: string | null;
  address: string | null;
  unit: string | null;
  gstin: string | null;
  logo: string | null;
};

/**
 * THE GARMENT ORDER SHEET'S LETTERHEAD (client 2026-09-23: the sheet moves to
 * the order documents' format). Read the way every other order document reads
 * it — `company_profile` through `registeredAddressOf` / `letterheadLogoOf`,
 * and the unit off the order's own `location_id`.
 *
 * LOADED BESIDE THE SHEET, NEVER INSIDE IT. `GosSheet` is what V_final freezes
 * at raise (0619); the letterhead is not part of what an amendment approves,
 * and adding a field to the frozen payload would leave every sheet frozen
 * before today without it. So it is read live on every render, like the style
 * images. A failed read costs the letterhead lines, never the sheet — the
 * company name then falls back to the wordmark text, as every exporter does.
 */
export async function getDocLetterhead(salesOrderId: string): Promise<DocLetterhead> {
  const s = await createClient();
  const [coRes, soRes] = await Promise.all([
    s.from("company_profile").select("*").limit(1).maybeSingle(),
    s.from("sales_orders").select("location_id").eq("id", salesOrderId).maybeSingle(),
  ]);
  const co = (coRes.data ?? null) as Record<string, unknown> | null;
  const str = (k: string) => (typeof co?.[k] === "string" ? (co[k] as string) : null);
  const locationId = (soRes.data as { location_id: string | null } | null)?.location_id ?? null;
  let unit: string | null = null;
  if (locationId) {
    const { data } = await s.from("locations").select("name").eq("id", locationId).maybeSingle();
    unit = (data as { name: string | null } | null)?.name ?? null;
  }
  return {
    name: str("name") ?? str("company_name"),
    address: registeredAddressOf(co),
    unit,
    gstin: str("gstin"),
    logo: letterheadLogoOf(co),
  };
}
