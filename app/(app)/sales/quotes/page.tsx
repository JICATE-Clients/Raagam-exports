import { requirePermission, can } from "@/lib/auth/server";
import {
  getQuoteCostings,
  getQuoteCostingFormData,
} from "@/lib/sales/quote-costings/service";
import { PrepareQuoteClient } from "./prepare-quote-client";

export default async function SalesQuotesPage() {
  await requirePermission("sales", "view");

  const [rows, data, canCreate, canEdit, canDelete, mCreate, mEdit] = await Promise.all([
    getQuoteCostings(),
    getQuoteCostingFormData(),
    can("sales", "create"),
    can("sales", "edit"),
    can("sales", "delete"),
    can("masters", "create"),
    can("masters", "edit"),
  ]);

  return (
    <PrepareQuoteClient
      rows={rows}
      data={data}
      perms={{ canCreate, canEdit, canDelete }}
      masterPerms={{ canCreate: mCreate, canEdit: mEdit }}
    />
  );
}
