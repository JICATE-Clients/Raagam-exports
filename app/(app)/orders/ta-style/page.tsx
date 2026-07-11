import { requirePermission, can } from "@/lib/auth/server";
import {
  getTaStyles,
  getTaStyleFormData,
} from "@/lib/orders/ta-styles/service";
import { TaStyleScreen } from "./ta-style-screen";

export default async function TaStylePage() {
  await requirePermission("orders", "view");

  const [rows, data, canCreate, canEdit, canDelete] = await Promise.all([
    getTaStyles(),
    getTaStyleFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);

  return (
    <TaStyleScreen
      rows={rows}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
    />
  );
}
