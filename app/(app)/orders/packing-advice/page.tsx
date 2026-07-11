import { requirePermission, can } from "@/lib/auth/server";
import {
  getPackingAdvices,
  getPackingAdviceFormData,
} from "@/lib/orders/packing-advice/service";
import { PackingAdviceScreen } from "./packing-advice-screen";

export default async function PackingAdvicePage() {
  await requirePermission("orders", "view");

  const [rows, data, canCreate, canEdit, canDelete, mCreate, mEdit] = await Promise.all([
    getPackingAdvices(),
    getPackingAdviceFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
    can("masters", "create"),
    can("masters", "edit"),
  ]);

  return (
    <PackingAdviceScreen
      rows={rows}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
      masterPerms={{ canCreate: mCreate, canEdit: mEdit }}
    />
  );
}
