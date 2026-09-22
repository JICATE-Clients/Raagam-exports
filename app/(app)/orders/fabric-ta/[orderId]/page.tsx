import { redirect } from "next/navigation";

/**
 * Moved into Orders ▸ Fabric BOM ▸ T&A (client 2026-09-21) — see the note on
 * `../page.tsx`. The Fabric BOM screen has no deep link to one order's BOM, so
 * this lands on its queue, where the order's BOM opens.
 */
export default function FabricTaOrderMoved() {
  redirect("/orders/fabric-bom");
}
