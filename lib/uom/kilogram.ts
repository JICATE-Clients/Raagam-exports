import "server-only";
import type { createClient } from "@/lib/supabase/server";

/**
 * A KILOGRAM UNIT, RESOLVED FROM THE MASTER AND NEVER ASSUMED.
 *
 * Two writers need "the kg row" and neither may guess its id: the CAD seed
 * (`lib/orders/cad/actions.ts`, marker weights are grams and there is no gram
 * UOM in this database) and the Fabric BOM requirement (`lib/orders/fabric-bom/
 * actions.ts`, whose figure is `grams / 1000` by construction — see
 * `requirementRows`). The live `uoms` master holds CONE, DZN, GROSS, KGS, LTR,
 * MTR, NOS, PCS and an INACTIVE `kg`, so the match is by code, active rows
 * only, and `null` is a real answer the caller must refuse on rather than
 * default past.
 *
 * Lifted out of the CAD action on 2026-09-16 so the second writer could not
 * grow a second spelling of the same lookup.
 */
export async function kilogramUom(
  s: Awaited<ReturnType<typeof createClient>>,
): Promise<{ id: string; code: string } | null> {
  const { data } = await s.from("uoms").select("id, code, is_active");
  const rows = (data ?? []) as { id: string; code: string; is_active: boolean }[];
  const match = rows.find(
    (r) => r.is_active && ["KG", "KGS", "KILOGRAM", "KILOGRAMS"].includes(r.code.trim().toUpperCase()),
  );
  return match ? { id: match.id, code: match.code.trim().toUpperCase() } : null;
}
