"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
  type SimpleValues,
  type SimpleStatus,
} from "@/components/masters/simple-master-screen";
import {
  createStockUnit,
  updateStockUnit,
  deleteStockUnit,
} from "@/lib/masters/stock-unit-actions";
import { type StockUnit, type StockUnitInput } from "@/lib/masters/stock-unit-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import { STOCK_UNIT_NAMES } from "@/lib/masters/name-vocabularies";
import { FIELD_WIDTH } from "@/components/ui/field";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

/** The two fields the row edits, plus Active from the Status switch. */
type Visible = Pick<StockUnitInput, "name" | "decimal_places" | "is_active">;

/**
 * THE HIDDEN LEGACY COLUMNS, CARRIED THROUGH UNCHANGED.
 *
 * `stockUnitInput` DEFAULTS every one of these (`for_all_item_classes` true,
 * `item_classes` [], every `is_*` false), so an update that simply left them
 * out would not "leave them alone" — the schema would fill the defaults in and
 * the action would write them, wiping a unit's item-class scoping on its next
 * rename. The popup this screen replaced avoided that by seeding its form from
 * the row; the row-edit engine has no row in `toPayload`, so the update is
 * wrapped instead: it finds the stored row and spreads these under the two
 * edited fields. `code` goes through as stored, never regenerated.
 */
function hiddenFrom(r: StockUnit, itemClasses: ConfigLookup[]): Omit<StockUnitInput, keyof Visible> {
  return {
    code: r.code,
    description: r.description ?? null,
    decimal_places_allowed: r.decimal_places_allowed ?? 2,
    unit_code: r.unit_code ?? null,
    for_all_item_classes: r.for_all_item_classes,
    item_classes: r.for_all_item_classes
      ? []
      : (r.item_classes ?? []).filter((c) => itemClasses.some((ic) => ic.code === c)),
    is_fabric: r.is_fabric ?? false,
    is_yarn: r.is_yarn ?? false,
    is_sewing: r.is_sewing ?? false,
    is_packing: r.is_packing ?? false,
    is_general: r.is_general ?? false,
    is_garment: r.is_garment ?? false,
  };
}

/**
 * Stock Unit master — THE COMPONENT KIND OF UI (client 2026-09-29: "Unit of
 * Measurement, Decimal Places … rendu fields aayum veliya vaikkanum, table la
 * components table mari"). No popup: the row itself becomes editable, "+ Add"
 * opens a row at the top — `SimpleMasterScreen`, the engine Component, Item
 * Class and ~20 other masters run on. The popup had held exactly these two
 * fields (minimal form, client 2026-07-23), so nothing is lost by the move.
 *
 * Duplicate hold on the name, the STOCK_UNIT_NAMES "did you mean" chips, CAPS,
 * the reload guard, Status block/unblock and Created Date / User all come from
 * the engine.
 */
export function StockUnitMasterScreen({
  rows,
  itemClasses,
  perms,
}: {
  rows: StockUnit[];
  itemClasses: ConfigLookup[];
  perms: Perms;
}) {
  const descriptor: SimpleMasterDescriptor<StockUnit> = {
    entityLabel: "Stock Unit",
    ioEntityKey: "stock-units",
    status: "active",
    // Block / Unblock from the listing, not the form (client 2026-09-26).
    blockEntity: "stock_unit",
    fields: [
      {
        key: "name",
        label: "Unit of Measurement",
        required: true,
        placeholder: "KILOGRAM",
        // `term` (176px): KILOGRAM, SQUARE METRE.
        widthClass: FIELD_WIDTH.term,
      },
      {
        key: "decimal_places",
        label: "Decimal Places",
        // One digit, 0–6 (`stockUnitInput`); the header sets the column.
        widthClass: FIELD_WIDTH.num,
      },
    ],
    fromRow: (r) => ({ name: r.name, decimal_places: String(r.decimal_places ?? 0) }),
    searchText: (r) => [r.code, r.name, r.description].filter(Boolean).join(" "),
    statusOf: (r) => (r.is_active ? "active" : "inactive"),
    validate: (v) => {
      const dp = String(v.decimal_places ?? "").trim();
      if (dp === "") return null;
      const n = Number(dp);
      return Number.isInteger(n) && n >= 0 && n <= 6 ? null : "Decimal Places must be a whole number from 0 to 6.";
    },
    toPayload: (v: SimpleValues, s: SimpleStatus): Visible => ({
      name: String(v.name),
      decimal_places: Number(v.decimal_places) || 0,
      is_active: s.active,
    }),
    spellSuggest: { seed: STOCK_UNIT_NAMES },
    dupCheck: { table: "uoms", fieldKey: "name" },
    actions: {
      // A new unit takes the schema's defaults for the hidden columns and a
      // code generated from its name — exactly what the popup's blank form sent.
      create: (p: Visible) => createStockUnit(p as StockUnitInput),
      update: (id: string, p: Visible) => {
        const r = rows.find((x) => x.id === id);
        return updateStockUnit(id, { ...(r ? hiddenFrom(r, itemClasses) : {}), ...p } as StockUnitInput);
      },
      remove: deleteStockUnit,
    },
  };

  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
