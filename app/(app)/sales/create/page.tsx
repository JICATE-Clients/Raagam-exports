import { requirePermission, can } from "@/lib/auth/server";
import { getBuyers } from "@/lib/sales/service";
import { CreateOpportunitiesClient } from "./create-opportunities-client";

export default async function CreateOpportunitiesPage() {
  await requirePermission("sales", "view");

  const [buyers, canCreate] = await Promise.all([
    getBuyers(),
    can("sales", "create"),
  ]);

  return <CreateOpportunitiesClient buyers={buyers} canCreate={canCreate} />;
}
