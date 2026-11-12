import { requirePermission, can } from "@/lib/auth/server";
import { listKnittingReceipts } from "@/lib/production/knitting-service";
import { KnittingReceiptsRegister } from "../knitting-hub/_components/knitting-receipts-register";

/** Process ▸ Knitting ▸ Fabric Receipts (0831) — same `stores` permission as the Knitting Orders. */
export default async function KnittingReceiptsPage() {
  await requirePermission("stores", "view");
  const [rows, canCreate] = await Promise.all([listKnittingReceipts("fabric"), can("stores", "edit")]);
  return <KnittingReceiptsRegister kind="fabric" rows={rows} canCreate={canCreate} />;
}
