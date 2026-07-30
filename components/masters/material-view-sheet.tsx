"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { DetailSection } from "@/components/masters/detail-section";
import { describeConversion } from "@/lib/uom/convert";
import { itemClassForm, isAccessoryClass, type Material } from "@/lib/masters/material-types";
import type { ConfigLookup, Attribute, AttributeValue } from "@/lib/masters/extras-types";
import type { MaterialAttribute } from "@/lib/masters/material-attribute-types";
import type { Category } from "@/lib/masters/category-types";
import type { Uom } from "@/lib/masters/types";

/**
 * Read-only material record (client 2026-07-28 #9). Opening the editor was the
 * only way to look at a material, which meant every "what is this?" carried the
 * risk of saving something — and on the auto-named classes, of re-composing the
 * Name on the way out.
 *
 * Renders the row the list ALREADY holds: `listMaterials` selects the header and
 * every child grid, so there is nothing to fetch here and no loading state to
 * design. Only fields that actually have a value are rendered — a General
 * consumable and a Fabric share almost nothing, and a fixed grid of "—" tells
 * the reader less than a short list of what is there.
 *
 * Hosted in `Sheet`, which registers with the reload guard on its own (AGENTS.md).
 */
export function MaterialViewSheet({
  open,
  material,
  onClose,
  itemClasses,
  categories,
  units,
  counts,
  purities,
  fabricTypes,
  fabricStructures,
  yarnTypes,
  materials,
  materialAttributes,
  attributes,
}: {
  open: boolean;
  material: Material | null;
  onClose: () => void;
  itemClasses: ConfigLookup[];
  categories: Category[];
  units: Uom[];
  counts: ConfigLookup[];
  purities: ConfigLookup[];
  fabricTypes: ConfigLookup[];
  fabricStructures: ConfigLookup[];
  yarnTypes: ConfigLookup[];
  /** The full list, so a mixing row's component yarn resolves to its name. */
  materials: Material[];
  materialAttributes: MaterialAttribute[];
  attributes: Attribute[];
}) {
  const lookupName = (rows: { id: string; name: string }[], id: string | null) =>
    (id ? rows.find((r) => r.id === id)?.name : null) ?? null;
  // UOMs read as their short code everywhere else on this screen (client
  // 2026-07-23 #5) — "KG", not "KG — KGS".
  const uomCode = useMemo(() => {
    const m = new Map(units.map((u) => [u.id, u.code.toUpperCase()]));
    return (id: string | null) => (id ? m.get(id) ?? "—" : "—");
  }, [units]);

  // Attribute answers store the LINE id; the question's label lives on the
  // attribute_value that line points at (same resolution the editor does).
  const attributeValueById = useMemo(
    () => new Map<string, AttributeValue>(attributes.flatMap((a) => a.values.map((v) => [v.id, v] as const))),
    [attributes],
  );
  const attrLabelByLineId = useMemo(() => {
    const m = new Map<string, string>();
    for (const set of materialAttributes) {
      for (const line of set.lines ?? []) {
        const av = line.attribute_id ? attributeValueById.get(line.attribute_id) : undefined;
        m.set(line.id, av?.value ?? "Attribute");
      }
    }
    return m;
  }, [materialAttributes, attributeValueById]);

  if (!material) return null;
  const r = material;
  const category = categories.find((c) => c.id === r.category_id) ?? null;
  const classCode = itemClasses.find((c) => c.id === r.item_class_id)?.code ?? null;
  const formKey = itemClassForm(classCode);
  const subCategory =
    (r.sub_category_id ? category?.sub_categories?.find((sc) => sc.id === r.sub_category_id)?.name : null) ?? null;

  const classification: [string, string | null][] = [
    ["Item Class", lookupName(itemClasses, r.item_class_id)],
    [formKey === "FABRIC" ? "Structure" : "Category", category?.name ?? null],
    ["Sub Category", subCategory],
    ["Item Type", r.item_type_name],
    ["Item Name", r.item_base_name],
    [isAccessoryClass(classCode) ? "Transaction Type" : "Type", r.material_type],
    ["Count", lookupName(counts, r.count_id)],
    ["Purity", lookupName(purities, r.purity_id)],
    ["Yarn Type", lookupName(yarnTypes, r.yarn_type_id)],
    ["Fabric Type", lookupName(fabricTypes, r.fabric_type_id)],
    ["Type (Structure)", formKey === "FABRIC" ? lookupName(fabricStructures, r.fabric_structure_id) : null],
    ["Using", r.fabric_using],
    ["Direct Purchase", formKey === "FABRIC" ? (r.direct_purchase ? "Yes" : "No") : null],
    ["Shade", r.shade],
  ];

  const identity: [string, string | null][] = [
    ["Name", r.name],
    ["HSN Code", r.hsn_code],
    ["Description", r.specifications],
  ];

  const uom: [string, string | null][] = [
    ["Base UOM", r.base_uom_id ? uomCode(r.base_uom_id) : null],
    ["Alternative UOM", r.has_alternate_uom ? "Yes" : "No"],
  ];

  const status: [string, string | null][] = [
    ["Created by", r.created_by],
    ["Created on", r.created_at ? r.created_at.slice(0, 10) : null],
  ];

  const mixings = r.mixings ?? [];
  const answers = (r.item_attribute_values ?? []).filter((a) => (a.value ?? "").trim());

  return (
    <Sheet
      open={open}
      onClose={onClose}
      fullScreen
      title={`Material — ${r.name}`}
      footer={
        /* Close only — View is a dead end by design; see record-view-sheet.tsx. */
        <Button variant="outline" size="md" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-foreground">{r.name}</h3>
          <StatusPill tone={r.is_active ? "success" : "danger"}>{r.is_active ? "Active" : "Inactive"}</StatusPill>
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <ValueSection label="Classification" pairs={classification} />
            {mixings.length > 0 && (
              <DetailSection label={formKey === "FABRIC" ? "Composition" : "Mixing"}>
                <ul className="space-y-1 text-sm text-foreground">
                  {mixings.map((m) => {
                    const name =
                      (m.component_item_id ? materials.find((x) => x.id === m.component_item_id)?.name : null) ??
                      m.description ??
                      "—";
                    const bits = [
                      m.blend_pct != null ? `${m.blend_pct}%` : null,
                      m.shade ? `Shade ${m.shade}` : null,
                    ].filter(Boolean);
                    return (
                      <li key={m.id} className="flex items-baseline justify-between gap-3">
                        <span>{name}</span>
                        {bits.length > 0 && <span className="text-xs text-muted-foreground">{bits.join(" · ")}</span>}
                      </li>
                    );
                  })}
                </ul>
              </DetailSection>
            )}
            {answers.length > 0 && (
              <ValueSection
                label="Attributes"
                pairs={[...answers]
                  .sort((a, b) => a.sno - b.sno)
                  .map((a) => [
                    (a.attribute_line_id ? attrLabelByLineId.get(a.attribute_line_id) : null) ?? "Attribute",
                    a.value,
                  ])}
              />
            )}
          </div>

          <div className="space-y-4">
            <ValueSection label="Identity" pairs={identity} />
            <DetailSection label="Units of Measure">
              <Pairs pairs={uom} />
              {/* Conversions read as the pack they describe ("1 Cone = 2,500
                  MTR") rather than four raw columns — describeConversion is the
                  same renderer the planner's pack picker uses. */}
              {r.conversions.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-border pt-2 text-sm text-foreground">
                  {r.conversions.map((c) => (
                    <li key={c.id}>{describeConversion(c, uomCode)}</li>
                  ))}
                </ul>
              )}
            </DetailSection>
            <ValueSection label="Status" pairs={status} />
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/** A section of label→value rows; renders nothing when every value is empty. */
function ValueSection({ label, pairs }: { label: string; pairs: [string, string | null][] }) {
  const shown = pairs.filter(([, v]) => v != null && String(v).trim() !== "");
  if (shown.length === 0) return null;
  return (
    <DetailSection label={label}>
      <Pairs pairs={shown} />
    </DetailSection>
  );
}

function Pairs({ pairs }: { pairs: [string, string | null][] }) {
  const shown = pairs.filter(([, v]) => v != null && String(v).trim() !== "");
  return (
    <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="truncate text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
