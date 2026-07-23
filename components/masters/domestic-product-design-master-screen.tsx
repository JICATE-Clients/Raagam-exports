"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import {
  createDomesticProductDesign,
  updateDomesticProductDesign,
  deleteDomesticProductDesign,
} from "@/lib/masters/simple-master-actions";

type Row = { id: string; design_no: string; description: string; is_active: boolean };
type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const descriptor: SimpleMasterDescriptor<Row> = {
  entityLabel: "Domestic Product Design",
  ioEntityKey: "domestic-product-designs",
  status: "active",
  fields: [
    { key: "design_no", label: "Design No", required: true, mono: true, widthClass: "w-40" },
    { key: "description", label: "Description", required: true },
  ],
  fromRow: (r) => ({ design_no: r.design_no, description: r.description }),
  searchText: (r) => [r.design_no, r.description].filter(Boolean).join(" "),
  statusOf: (r) => (r.is_active ? "active" : "inactive"),
  toPayload: (v, s) => ({
    design_no: String(v.design_no),
    description: String(v.description),
    is_active: s.active,
  }),
  dupCheck: { table: "domestic_product_designs", fieldKey: "design_no", nameColumn: "design_no" },
  actions: {
    create: createDomesticProductDesign,
    update: updateDomesticProductDesign,
    remove: deleteDomesticProductDesign,
  },
};

export function DomesticProductDesignMasterScreen({ rows, perms }: { rows: Row[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
