import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { isInactive } from "@/lib/masters/inactive";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { InternalWorkOrder } from "./types";

/** A row normalized to {id, code, name} for a RecordPicker. `inactive` is
 *  carried, never filtered, so a value a saved line holds still resolves
 *  (AGENTS.md, Disabled rows) — the picker greys it and refuses a re-pick. */
export type PickerRow = { id: string; code: string | null; name: string; inactive: boolean };

/** A fabric carries its structure — `items.category_id` IS the structure, the
 *  same fact Fabric BOM's Fabric cell is scoped by. */
export type IwoFabricOption = PickerRow & { category_id: string | null };

/** A structure (a FABRIC-class category — SINGLE JERSEY) carries its knit
 *  family (Circular / Flat Knit / Woven), which the SRS prints as the fabric's
 *  "Structure" and the app calls Structure Type (fabric-bom/service.ts). */
export type IwoStructureOption = PickerRow & { knit: string | null };

export type IwoProcessOption = PickerRow & { for_yarn: boolean; for_fabric: boolean };

/** The BOM that plans an IWO — IWO Fabric BOM (Yarn / Fabric) or IWO Material
 *  BOM (Accessories) — or null while none is raised. */
export type IwoBomRef = { id: string; is_draft: boolean } | null;

export type IwoRow = InternalWorkOrder & {
  sales_orders: { id: string; order_number: string | null } | null;
  bom: IwoBomRef;
};

/**
 * Every IWO, each with the BOM that plans it. An IWO is a HEADER (2026-09-19):
 * its lines live on its BOM, so the list carries only whether that BOM exists
 * and is a draft — the "BOM" column. Each embed follows the ONE foreign key
 * its table has to the IWO (unique), so none is ambiguous.
 *
 * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST (AGENTS.md): an empty list is
 * a believable answer here, so a broken select must not be able to look like one.
 */
export async function listInternalWorkOrders(): Promise<IwoRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("internal_work_orders")
    .select(
      "*, sales_orders(id, order_number), " +
        "iwo_fabric_boms(id, is_draft), iwo_material_boms(id, is_draft)",
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Internal work orders: ${error.message}`);
  type Ref = { id: string; is_draft: boolean };
  type Raw = Omit<IwoRow, "bom"> & {
    iwo_fabric_boms: Ref | Ref[] | null;
    iwo_material_boms: Ref | Ref[] | null;
  };
  // A one-to-one embed can arrive as an object or a one-element array.
  const one = (v: Ref | Ref[] | null): Ref | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const rows = ((data ?? []) as unknown as Raw[]).map(({ iwo_fabric_boms, iwo_material_boms, ...r }) => ({
    ...r,
    bom: one(iwo_fabric_boms) ?? one(iwo_material_boms),
  }));
  return withCreators(rows);
}

/** Everything the editor's pickers offer. */
export type IwoFormData = {
  /** Reference (RE No) — `sales_orders.order_number`. */
  orders: PickerRow[];
  yarns: PickerRow[];
  fabrics: IwoFabricOption[];
  /** Fabric structures — `categories` of the FABRIC class. */
  structures: IwoStructureOption[];
  uoms: PickerRow[];
  /** `master_vendors` — a process row's Vendor (AGENTS.md: the
   *  master table, never the purchase-side `public.vendors`). */
  vendors: PickerRow[];
  /** The Process master, WHOLE — narrowed per row by `for_yarn` / `for_fabric`
   *  in the browser, so a process a line holds survives its flag being unticked. */
  processes: IwoProcessOption[];
  yarnStages: ConfigLookup[];
  fabricStages: ConfigLookup[];
  colors: ConfigLookup[];
  prints: ConfigLookup[];
  sizes: ConfigLookup[];
};

const LOOKUP_KINDS = ["yarn_stage", "fabric_stage", "fabric_color", "roll_form_print", "size"];

export async function getIwoFormData(): Promise<IwoFormData> {
  const s = await createClient();
  const [orderRes, itemRes, classRes, catRes, uomRes, procRes, lookRes, vendorRes] = await Promise.all([
    s
      .from("sales_orders")
      .select("id, order_number")
      .not("order_number", "is", null)
      .order("created_at", { ascending: false }),
    s
      .from("items")
      .select("id, code, name, is_active, item_class_id, category_id, base_uom_id, purchase_uom_id")
      .order("name"),
    // AN ITEM CLASS IS A `config_lookups` ROW, not a table — resolved by a
    // second query and a Map, never an embed (see fabric-bom/service.ts).
    s.from("config_lookups").select("id, code").eq("kind", "item_class"),
    s
      .from("categories")
      .select("id, short_name, name, inactive, item_class_id, fabric_structure_id")
      .order("name"),
    s.from("uoms").select("id, code, name, is_active").order("name"),
    // `inactive`, not `is_active` — 0227's spelling for this table.
    s.from("processes").select("id, name, inactive, for_yarn, for_fabric").order("name"),
    s
      .from("config_lookups")
      .select("id, kind, code, name, notes, is_active")
      .in("kind", LOOKUP_KINDS)
      .order("name"),
    s.from("master_vendors").select("id, code, name, inactive").order("name"),
  ]);
  for (const r of [orderRes, itemRes, classRes, catRes, uomRes, procRes, lookRes, vendorRes]) {
    if (r.error) throw new Error(`Internal work order form: ${r.error.message}`);
  }

  const classCode = new Map(
    ((classRes.data ?? []) as { id: string; code: string | null }[]).map((c) => [
      c.id,
      (c.code ?? "").toUpperCase(),
    ]),
  );

  type ItemRaw = {
    id: string;
    code: string | null;
    name: string;
    is_active: boolean;
    item_class_id: string | null;
    category_id: string | null;
    base_uom_id: string | null;
    purchase_uom_id: string | null;
  };
  const items = (itemRes.data ?? []) as ItemRaw[];
  const codeOf = (i: { item_class_id: string | null }) =>
    i.item_class_id ? (classCode.get(i.item_class_id) ?? "") : "";
  const pick = (i: ItemRaw): PickerRow => ({
    id: i.id,
    code: i.code,
    name: i.name,
    inactive: isInactive(i),
  });

  const lookups = (lookRes.data ?? []) as unknown as ConfigLookup[];
  const ofKind = (k: string) => lookups.filter((l) => l.kind === k);

  type CatRaw = {
    id: string;
    short_name: string | null;
    name: string | null;
    inactive: boolean;
    item_class_id: string | null;
    fabric_structure_id: string | null;
  };
  const fabricCats = ((catRes.data ?? []) as CatRaw[]).filter((c) => codeOf(c) === "FABRIC");
  // The knit family is a `config_lookups` row — a second query over only the
  // ids that appear, never an embed (the reason is in fabric-bom/service.ts's
  // getStructureRows: that embed does not parse against the generated types).
  const knitIds = [...new Set(fabricCats.map((c) => c.fabric_structure_id).filter(Boolean))] as string[];
  const knitRes = knitIds.length
    ? await s.from("config_lookups").select("id, name").in("id", knitIds)
    : { data: [] as { id: string; name: string | null }[], error: null };
  if (knitRes.error) throw new Error(`Internal work order form: ${knitRes.error.message}`);
  const knitById = new Map(
    ((knitRes.data ?? []) as { id: string; name: string | null }[]).map((r) => [r.id, r.name]),
  );

  return {
    orders: ((orderRes.data ?? []) as { id: string; order_number: string }[]).map((o) => ({
      id: o.id,
      code: o.order_number,
      name: o.order_number,
      inactive: false,
    })),
    yarns: items.filter((i) => codeOf(i) === "YARN").map(pick),
    fabrics: items
      .filter((i) => codeOf(i) === "FABRIC")
      .map((i) => ({ ...pick(i), category_id: i.category_id })),
    structures: fabricCats.map((c) => ({
      id: c.id,
      code: c.short_name,
      name: c.name ?? c.short_name ?? "(unnamed)",
      inactive: isInactive(c),
      knit: c.fabric_structure_id ? (knitById.get(c.fabric_structure_id) ?? null) : null,
    })),
    uoms: ((uomRes.data ?? []) as { id: string; code: string; name: string; is_active: boolean }[]).map(
      (u) => ({ id: u.id, code: u.code, name: u.name, inactive: isInactive(u) }),
    ),
    vendors: (
      (vendorRes.data ?? []) as { id: string; code: string | null; name: string; inactive: boolean }[]
    ).map((v) => ({ id: v.id, code: v.code, name: v.name, inactive: isInactive(v) })),
    processes: (
      (procRes.data ?? []) as {
        id: string;
        name: string;
        inactive: boolean;
        for_yarn: boolean;
        for_fabric: boolean;
      }[]
    ).map((p) => ({
      id: p.id,
      code: null,
      name: p.name,
      inactive: isInactive(p),
      for_yarn: !!p.for_yarn,
      for_fabric: !!p.for_fabric,
    })),
    yarnStages: ofKind("yarn_stage"),
    fabricStages: ofKind("fabric_stage"),
    colors: ofKind("fabric_color"),
    prints: ofKind("roll_form_print"),
    sizes: ofKind("size"),
  };
}
