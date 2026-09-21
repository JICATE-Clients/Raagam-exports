import { redirect } from "next/navigation";

/**
 * Fabric T&A MOVED INTO THE FABRIC BOM (client 2026-09-21): it is now the
 * T&A tab of Orders ▸ Fabric BOM, next to Fabric Process. This address was its
 * own sidebar row for an afternoon; it keeps working as a redirect rather than
 * a 404, per AGENTS.md "A screen that loses its sidebar row keeps its URL".
 */
export default function FabricTaMoved() {
  redirect("/orders/fabric-bom");
}
