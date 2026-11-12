import { requirePermission } from "@/lib/auth/server";
import { listKnittingReceipts } from "@/lib/production/knitting-service";
import { KnittingReceiptsRegister } from "../knitting-hub/_components/knitting-receipts-register";

/** Production ▸ Knitting ▸ Yarn Returns (0831) — same `stores` permission as the Knitting Orders. */
export default async function KnittingReturnsPage() {
  await requirePermission("stores", "view");
  const rows = await listKnittingReceipts("yarn_return");
  return <KnittingReceiptsRegister kind="yarn_return" rows={rows} />;
}
