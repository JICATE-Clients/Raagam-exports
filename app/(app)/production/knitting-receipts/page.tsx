import { requirePermission } from "@/lib/auth/server";
import { listKnittingReceipts } from "@/lib/production/knitting-service";
import { KnittingReceiptsRegister } from "../knitting-hub/_components/knitting-receipts-register";

/** Production ▸ Knitting ▸ Fabric Receipts (0831) — same `stores` permission as the Knitting Orders. */
export default async function KnittingReceiptsPage() {
  await requirePermission("stores", "view");
  const rows = await listKnittingReceipts("fabric");
  return <KnittingReceiptsRegister kind="fabric" rows={rows} />;
}
