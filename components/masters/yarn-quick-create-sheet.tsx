"use client";

// Quick-create a COMPLETE Yarn from inside another form's Component Yarn picker
// (client 2026-07-23, Fabric Master #11) — not just a name like the picker's
// inline Add. Mirrors the Materials master's YARN form rules: the Name is
// auto-generated (Count + Category NAME + Purity, CAPS), Melange carries a
// Shade, and every UOM defaults to kg (yarn is always traded in kg, 0279 #15).
// Richer fields (HSN, Mixing rows for Mixed-nature blends…) stay editable from
// the full Materials master afterwards.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { createMaterial } from "@/lib/masters/material-actions";
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";
import type { MaterialInput } from "@/lib/masters/material-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { Category } from "@/lib/masters/category-types";

export function YarnQuickCreateSheet({
  open,
  onClose,
  onCreated,
  yarnClassId,
  counts,
  purities,
  yarnTypes,
  categories,
  kgUnitId,
}: {
  open: boolean;
  onClose: () => void;
  /** Fires with the freshly created row so the caller can list + select it. */
  onCreated: (item: { id: string; code: string; name: string }) => void;
  /** config_lookups id of the YARN item class — scopes the record + dup check. */
  yarnClassId: string;
  counts: ConfigLookup[];
  purities: ConfigLookup[];
  yarnTypes: ConfigLookup[];
  /** Caller passes the YARN-scoped category list (cascading-picker rule). */
  categories: Category[];
  /** uoms id of "kg" — yarn's every UOM defaults to it (0279 #15). */
  kgUnitId?: string | null;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [countId, setCountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [purityId, setPurityId] = useState("");
  const [yarnTypeId, setYarnTypeId] = useState("");
  const [shade, setShade] = useState("");

  // Fresh form every time the sheet opens.
  useEffect(() => {
    if (open) {
      setCountId("");
      setCategoryId("");
      setPurityId("");
      setYarnTypeId("");
      setShade("");
    }
  }, [open]);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) ?? null,
    [categories, categoryId],
  );
  const isMelange =
    yarnTypes.find((y) => y.id === yarnTypeId)?.name?.toLowerCase() === "melange";

  // Melange yarn carries a Shade; clear it when the type moves away from
  // Melange so a hidden stale shade never persists (material screen rule).
  function handleYarnTypeChange(v: string) {
    const melange = yarnTypes.find((y) => y.id === v)?.name?.toLowerCase() === "melange";
    setYarnTypeId(v);
    if (!melange) setShade("");
  }

  // Live NAME = Count + Purity + Category NAME in CAPS — mirrors the material
  // screen's YARN suggestedName (user 2026-07-24: order is count, yarn purity,
  // then the category's own name, e.g. "cotton mixed"). Mixing parts are out of
  // scope here (no blend grid in quick-create).
  const previewName = useMemo(() => {
    const parts = [
      countId ? counts.find((c) => c.id === countId)?.name : null,
      purityId ? purities.find((p) => p.id === purityId)?.name : null,
      selectedCategory?.name ?? null,
    ].filter(Boolean);
    return parts.join(" ").toUpperCase();
  }, [countId, purityId, selectedCategory, counts, purities]);

  // Real-time duplicate check on the generated Name, scoped to the Yarn class —
  // backstopped server-side by createMaterial's Count/Category/Purity guard.
  const dupError = useDuplicateCheck({
    table: "items",
    name: previewName,
    scope: { item_class_id: yarnClassId },
    enabled: open && !!previewName,
  });

  function save() {
    startTransition(async () => {
      const uom = kgUnitId ?? null;
      const payload: MaterialInput = {
        code: "", // auto-generated from the name server-side
        name: previewName,
        is_active: true,
        item_class_id: yarnClassId,
        hsn_code: null,
        hsn_id: null,
        category_id: categoryId || null,
        sub_category_id: null, // General-only concept (0349); this sheet is Yarn.
        material_type: null,
        user_defined: false,
        specifications: null,
        short_spec: null,
        count_id: countId || null,
        purity_id: purityId || null,
        shade: isMelange ? shade.trim() || null : null,
        fabric_type_id: null,
        fabric_structure_id: null,
        fabric_using: null,
        yarn_type_id: yarnTypeId || null,
        direct_purchase: false,
        // Quick-create is KG for every slot (below), so there is nothing to
        // convert. The full Materials master is where a yarn that needs an
        // alternative purchase unit gets one.
        has_alternate_uom: false,
        base_uom_id: uom,
        stock_uom_id: uom,
        billing_uom_id: uom,
        planning_uom_id: uom,
        purchase_uom_id: uom,
        cost_head_id: null,
        budget_rate: null,
        budget_rate_uom_id: null,
        mixings: [],
        conversions: [],
        using_items: [],
        item_attribute_values: [],
      };
      const res = await createMaterial(payload);
      if (!res.ok) {
        error(res.error);
        return;
      }
      success(`Yarn "${previewName}" created.`);
      if (res.id) {
        // The server auto-generates the code and doesn't return it — pass the
        // name as both (ItemPicker options render the name; code is
        // display-only there). router.refresh() swaps in the real row later.
        onCreated({ id: res.id, code: previewName, name: previewName });
      } else {
        // id missing (shouldn't happen) — refresh so the new yarn at least
        // lands in the caller's server-fetched list.
        router.refresh();
      }
      onClose();
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New Yarn"
      size="sm"
      zIndexBase={120} // stacks above the picker dialog (100)
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="md"
            disabled={isPending || !countId || !categoryId || !!dupError}
            onClick={save}
          >
            {isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label htmlFor="yqc-count">
            Count <span className="text-danger">*</span>
          </Label>
          <Select
            id="yqc-count"
            value={countId}
            onChange={(e) => setCountId(e.target.value)}
            className="text-base md:text-sm"
          >
            <option value="">— Select —</option>
            {counts
              .filter((c) => c.is_active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="yqc-category">
            Category <span className="text-danger">*</span>
          </Label>
          <Select
            id="yqc-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="text-base md:text-sm"
          >
            <option value="">— Select —</option>
            {categories
              .filter((c) => !c.inactive)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? c.short_name ?? ""}
                </option>
              ))}
          </Select>
          {/* Mixing rows need the full master's blend grid — flag it up front */}
          {selectedCategory?.made === "Mixed" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Mixed-nature yarn — add its Mixing % rows from the Materials master after creating.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="yqc-purity">Purity</Label>
          <Select
            id="yqc-purity"
            value={purityId}
            onChange={(e) => setPurityId(e.target.value)}
            className="text-base md:text-sm"
          >
            <option value="">— Select —</option>
            {purities
              .filter((p) => p.is_active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="yqc-yarn-type">Yarn Type</Label>
          <Select
            id="yqc-yarn-type"
            value={yarnTypeId}
            onChange={(e) => handleYarnTypeChange(e.target.value)}
            className="text-base md:text-sm"
          >
            <option value="">— Select —</option>
            {yarnTypes
              .filter((y) => y.is_active)
              .map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
          </Select>
        </div>
        {/* Melange yarn carries its shade (client 2026-07-23) */}
        {isMelange && (
          <div>
            <Label htmlFor="yqc-shade">Shade</Label>
            <Input
              id="yqc-shade"
              value={shade}
              onChange={(e) => setShade(e.target.value)}
              className="text-base md:text-sm"
            />
          </div>
        )}
        {/* Auto-generated NAME — same rule as the Materials master YARN form */}
        <div className="border-t border-border pt-3">
          <Label>Name (auto-generated)</Label>
          <div className="flex min-h-9 items-center rounded-md border border-border bg-surface-muted px-3 py-1.5 text-sm font-medium text-foreground">
            {previewName || (
              <span className="font-normal text-muted-foreground">
                Pick Count, Category and Purity…
              </span>
            )}
          </div>
          {dupError && <p className="mt-1 text-xs text-danger">{dupError}</p>}
        </div>
      </div>
    </Sheet>
  );
}
