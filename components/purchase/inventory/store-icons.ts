import { Archive, Boxes, Factory, PackagePlus, PackageX, Truck, Warehouse } from "lucide-react";

export type DashBin = { id: string; bin_code: string | null; store_id: string; inactive: boolean; description: string | null };
export type DashStore = { id: string; name: string; store_type: string };

/* ONE ICON PER KIND OF STORE (user 2026-11-06: "that store icon need difference") — the
   picture says what the store is FOR, so three tabs never look like one tab three times.
   Keyed on `store_type` (system store types, 0800), never on the name an admin can retype. */
export const STORE_ICON: Record<string, typeof Warehouse> = {
  material: Boxes, //        stock kept for orders
  purchase: PackagePlus, //  goods just bought and received
  rejection: PackageX, //    refused at QC, owed by the vendor
  processing: Factory, //    out at / back from a process
  surplus: Archive, //       left over, set aside
  transit: Truck, //         on the move between units
};
