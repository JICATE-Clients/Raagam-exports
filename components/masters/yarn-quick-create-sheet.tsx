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
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { CategoryPicker } from "@/components/masters/lookup-picker";
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
  perms,
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
  /**
   * Host screen's masters permissions, threaded through by `ItemPicker` exactly
   * as `CategoryPicker` threads them into `CategoryQuickCreateSheet`.
   *
   * Required, and deliberately not defaulted: the four fields below are pickers
   * with inline Add / Modify / Delete, and a default would decide an
   * authorisation question in the component that renders the buttons rather
   * than at the screen that knows the answer. Absent perms means no CRUD, not
   * full CRUD.
   */
  perms?: { canCreate: boolean; canEdit: boolean; canDelete: boolean };
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

  // No perms passed → no inline CRUD. Never the other way round.
  const canCreate = perms?.canCreate ?? false;
  const canEdit = perms?.canEdit ?? false;
  const canDelete = perms?.canDelete ?? false;

  /**
   * A value added from a picker's own "+ Add" lives in that picker's local
   * state until `router.refresh()` lands, so it is not in `counts` / `purities`
   * / `categories` yet — and the Name below is COMPOSED from all three.
   * Composing it from a value we cannot resolve would save the yarn under a
   * silently wrong name (the new count simply missing from it), which is
   * unrecoverable without noticing. Hold Save for the moment the refreshed list
   * takes to arrive instead.
   */
  const namePending =
    (!!countId && !counts.some((c) => c.id === countId)) ||
    (!!purityId && !purities.some((p) => p.id === purityId)) ||
    (!!categoryId && !selectedCategory);

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
  //
  // dup-check: server-only -- the name is COMPOSED here from counts/purities;
  // the `items` rows it would collide with are never passed to this sheet. A
  // late answer still catches the cursor (keyboard-nav-provider.tsx).
  const dupError = useDuplicateCheck({
    table: "items",
    name: previewName,
    scope: { item_class_id: yarnClassId },
    // Skipped while a just-added value is still resolving — the half-composed
    // name it would produce could collide with a real yarn and report a
    // duplicate that isn't one.
    enabled: open && !!previewName && !namePending,
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
      // Above MasterFullScreen (80), and deliberately NOT above the picker
      // panel (150) that opened us: this sheet holds pickers of its own, and
      // they portal at 150 too. DataPicker.startAdd closes its list before
      // handing over, which is what keeps the two off screen together.
      zIndexBase={120}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          {/**
            * GATES ON EVERY FIELD `REQUIRED_BY_FORM.YARN` LISTS.
            *
            * It used to gate on Count and Category only, while
            * `material-types.ts:212` requires `item_class_id, yarn_type_id,
            * count_id, category_id, base_uom_id`. So Save enabled, and
            * `createMaterial` refused with "Fill in Yarn Type, Base UOM before
            * saving" — naming Base UOM, which this sheet does not render at all.
            *
            * `base_uom_id` is not a choice here by design: quick-create is KG
            * for every slot (see `save()`), so the gate is on whether a KG unit
            * EXISTS rather than on a picker. The banner below says so, because a
            * disabled button with no reason is the thing this replaces.
            */}
          <Button
            size="md"
            disabled={
              isPending ||
              !countId ||
              !categoryId ||
              !yarnTypeId ||
              !kgUnitId ||
              !!dupError ||
              namePending
            }
            onClick={save}
          >
            {isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Base UOM is required for a yarn and is supplied as KG, not chosen.
            If the shop's Stock Unit master has no KG row there is nothing to
            supply, so say that here rather than let Save look arbitrarily
            broken — or worse, let the server answer with the name of a field
            this sheet never shows. */}
        {!kgUnitId && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
            No <strong>KG</strong> stock unit exists, and a yarn is measured in KG. Add one on
            Master Data ▸ Materials ▸ Stock Units before creating a yarn here.
          </p>
        )}
        {/* All four are pickers, not plain dropdowns: each one references a
            stored list an operator must be able to extend in place. A yarn that
            arrives with a count nobody has entered yet used to be a dead end
            here — the sheet could only pick (client 2026-07-31). */}
        <div>
          <LookupDialogPicker
            kind="yarn_count"
            label="Count"
            options={counts}
            value={countId}
            onChange={setCountId}
            required
            canCreate={canCreate}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </div>
        <div>
          <CategoryPicker
            label="Category"
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            required
            clearable={false}
            itemClassId={yarnClassId}
            canCreate={canCreate}
            canEdit={canEdit}
            canDelete={canDelete}
          />
          {/* Mixing rows need the full master's blend grid — flag it up front */}
          {selectedCategory?.made === "Mixed" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Mixed-nature yarn — add its Mixing % rows from the Materials master after creating.
            </p>
          )}
        </div>
        <div>
          <LookupDialogPicker
            kind="yarn_purity"
            label="Purity"
            options={purities}
            value={purityId}
            onChange={setPurityId}
            canCreate={canCreate}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </div>
        <div>
          <LookupDialogPicker
            kind="yarn_type"
            label="Yarn Type"
            options={yarnTypes}
            value={yarnTypeId}
            onChange={handleYarnTypeChange}
            // `REQUIRED_BY_FORM.YARN` has always listed `yarn_type_id`; this
            // sheet just never said so, so a blank one neither held the cursor
            // nor drew a star and the server rejected it at Save instead.
            required
            canCreate={canCreate}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </div>
        {/* Melange yarn carries its shade (client 2026-07-23) */}
        {isMelange && (
          <div>
            <Label htmlFor="yqc-shade">Shade</Label>
            <Input
              uppercase
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
          {namePending && (
            <p className="mt-1 text-xs text-muted-foreground">
              Picking up the value you just added…
            </p>
          )}
          {/* Deliberately NOT `dupFieldProps` / `<DuplicateError>`: the name here
              is the composed <div> preview above, not an input, so there is no
              field for the keyboard hold to hold. Save is gated on `dupError`
              instead. Leave it alone. */}
          {dupError && <p className="mt-1 text-xs text-danger">{dupError}</p>}
        </div>
      </div>
    </Sheet>
  );
}
