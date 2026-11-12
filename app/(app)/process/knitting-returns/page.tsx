import { requirePermission, can } from "@/lib/auth/server";
import { listKnittingReceipts } from "@/lib/production/knitting-service";
import { KnittingReceiptsRegister } from "../knitting-hub/_components/knitting-receipts-register";

/** Process ▸ Knitting ▸ Yarn Returns (0831) — same `stores` permission as the Knitting Orders. */
export default async function KnittingReturnsPage() {
  await requirePermission("stores", "view");
  const [rows, canCreate] = await Promise.all([listKnittingReceipts("yarn_return"), can("stores", "edit")]);
  return <KnittingReceiptsRegister kind="yarn_return" rows={rows} canCreate={canCreate} />;
}
