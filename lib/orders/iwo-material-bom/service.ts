import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { getCurrentLocationId } from "@/lib/auth/location";
import { isInactive } from "@/lib/masters/inactive";
import { listVendorsForPicker } from "@/lib/masters/vendor-service";
import { isAccessoryClass, type MaterialOption } from "@/lib/orders/material-bom-amendment/material-options";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { IwoMaterialBom } from "./types";

export type PickerRow = { id: string; code: string | null; name: string; inactive: boolean };
export type IwoMbUomRow = PickerRow & { decimal_places_allowed: number | null };
/** A material's pack, e.g. "1 Box = 144 NOS" — the order screen's conversion row. */
export type IwoMbConversionRow = {
  id: string;
  item_id: string;
  alt_qty: number | null;
  alt_uom_id: string | null;
  base_qty: number | null;
  base_uom_id: string | null;
};

/**
 * ONE ROW PER IWO FOR ACCESSORIES at the current unit, with its Material BOM
 * embedded when there is one — the IWO Fabric BOM's list, for the other kind.
 * Scoped to the current unit because the BOM header is (RLS), exactly as
 * `listIwoFabricBomTasks` explains. A failed query is an error, not an empty list.
 */
export type IwoMaterialBomTask = {
  id: string;
  code: string | null;
  iwo_date: string;
  iwo_for: string;
  /** Reference (RE No), typed on the work order (0597). */
  reference_no: string | null;
  deli_date: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  bom: IwoMaterialBom | null;
};

export async function listIwoMaterialBomTasks(): Promise<IwoMaterialBomTask[]> {
  const locationId = await getCurrentLocationId();
  if (!locationId) return [];
  const s = await createClient();
  const { data, error } = await s
    .from("internal_work_orders")
    .select(
      "id, code, iwo_date, iwo_for, reference_no, deli_date, status, created_by, created_at, " +
        // The breakup rows ride under each line (0614).
        "iwo_material_boms(*, iwo_material_bom_items(*, iwo_material_bom_item_slices(*)), iwo_material_bom_processes(*))",
    )
    .eq("iwo_for", "accessories")
    .eq("location_id", locationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`IWO Material BOM: ${error.message}`);

  type Raw = Omit<IwoMaterialBomTask, "bom"> & { iwo_material_boms: IwoMaterialBom | IwoMaterialBom[] | null };
  const rows = ((data ?? []) as unknown as Raw[]).map(({ iwo_material_boms, ...r }) => {
    // A one-to-one embed can arrive as an object or a one-element array.
    const b = Array.isArray(iwo_material_boms) ? (iwo_material_boms[0] ?? null) : iwo_material_boms;
    return {
      ...r,
      bom: b
        ? {
            ...b,
            iwo_material_bom_items: [...(b.iwo_material_bom_items ?? [])]
              .sort((x, y) => x.sno - y.sno)
              .map((it) => ({
                ...it,
                iwo_material_bom_item_slices: [...(it.iwo_material_bom_item_slices ?? [])].sort((x, y) => x.sno - y.sno),
              })),
            iwo_material_bom_processes: [...(b.iwo_material_bom_processes ?? [])].sort((x, y) => x.sno - y.sno),
          }
        : null,
    };
  });
  return withCreators(rows);
}

/** Everything the editor's pickers offer — the order Material BOM's own
 *  option lists (its loaders are module-private, so these are copies of them,
 *  narrowed the same way and carrying `inactive` the same way). */
export type IwoMaterialBomFormData = {
  /** Sewing + Packing accessories — `getMaterialRows`' narrowing. */
  materials: MaterialOption[];
  /** Categories of the two accessory classes, each named with its class
   *  (category names repeat across classes — AGENTS.md, cascading filters). */
  categories: PickerRow[];
  uoms: IwoMbUomRow[];
  conversions: IwoMbConversionRow[];
  /** Processes flagged `for_trims` — the order screen's `getProcessRows`. */
  processes: PickerRow[];
  /** `master_vendors` — never the purchase-side `vendors` (AGENTS.md). */
  vendors: PickerRow[];
  /** config_lookups kind `fabric_color` — the one colour master. */
  colors: ConfigLookup[];
};

export async function getIwoMaterialBomFormData(): Promise<IwoMaterialBomFormData> {
  const s = await createClient();
  const [itemRes, classRes, catRes, uomRes, convRes, procRes, colorRes, vendors] = await Promise.all([
    s
      .from("items")
      .select("id, code, name, is_active, item_class_id, category_id, has_alternate_uom, base_uom_id, purchase_uom_id")
      .order("name"),
    s.from("config_lookups").select("id, code, name").eq("kind", "item_class"),
    s.from("categories").select("id, short_name, name, inactive, item_class_id").order("name"),
    s.from("uoms").select("id, code, name, decimal_places_allowed, is_active").order("name"),
    s.from("material_uom_conversions").select("id, item_id, alt_qty, alt_uom_id, base_qty, base_uom_id").order("sno"),
    s.from("processes").select("id, name, inactive, for_trims").eq("for_trims", true).order("name"),
    s.from("config_lookups").select("id, kind, code, name, notes, is_active").eq("kind", "fabric_color").order("name"),
    listVendorsForPicker(),
  ]);
  for (const r of [itemRes, classRes, catRes, uomRes, convRes, procRes, colorRes]) {
    if (r.error) throw new Error(`IWO Material BOM form: ${r.error.message}`);
  }

  const classes = new Map(
    ((classRes.data ?? []) as { id: string; code: string | null; name: string | null }[]).map((c) => [c.id, c]),
  );
  const codeOf = (classId: string | null) => (classId ? (classes.get(classId)?.code ?? null) : null);

  type ItemRaw = {
    id: string;
    code: string | null;
    name: string;
    is_active: boolean;
    item_class_id: string | null;
    category_id: string | null;
    has_alternate_uom: boolean | null;
    base_uom_id: string | null;
    purchase_uom_id: string | null;
  };
  const materials: MaterialOption[] = ((itemRes.data ?? []) as ItemRaw[])
    .map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      inactive: isInactive(r),
      class_code: codeOf(r.item_class_id),
      category_id: r.category_id ?? null,
      has_alternate_uom: r.has_alternate_uom ?? false,
      base_uom_id: r.base_uom_id ?? null,
      purchase_uom_id: r.purchase_uom_id ?? null,
    }))
    .filter((r) => isAccessoryClass(r.class_code));

  type CatRaw = { id: string; short_name: string | null; name: string | null; inactive: boolean; item_class_id: string | null };
  const categories: PickerRow[] = ((catRes.data ?? []) as CatRaw[])
    .filter((c) => isAccessoryClass(codeOf(c.item_class_id)))
    .map((c) => ({
      id: c.id,
      code: c.short_name,
      name: `${classes.get(c.item_class_id ?? "")?.name ?? ""} · ${c.name ?? c.short_name ?? "(unnamed)"}`,
      inactive: isInactive(c),
    }));

  return {
    materials,
    categories,
    uoms: ((uomRes.data ?? []) as (Omit<IwoMbUomRow, "inactive"> & { is_active: boolean })[]).map((u) => ({
      ...u,
      inactive: isInactive(u),
    })),
    conversions: (convRes.data ?? []) as IwoMbConversionRow[],
    processes: ((procRes.data ?? []) as { id: string; name: string; inactive: boolean | null }[]).map((p) => ({
      id: p.id,
      code: null,
      name: p.name,
      inactive: isInactive(p),
    })),
    vendors: vendors.map((v) => ({ id: v.id, code: v.code ?? null, name: v.name, inactive: !!v.inactive })),
    colors: (colorRes.data ?? []) as unknown as ConfigLookup[],
  };
}
