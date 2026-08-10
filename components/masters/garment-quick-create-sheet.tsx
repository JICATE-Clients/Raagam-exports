"use client";

// Quick-create a GARMENT from inside a Coordinate picker — the Material child's
// own form for item class GARMENTS, not a Name-only box (client 2026-08-10).
//
// A COORDINATE IS A GARMENT. `items` under class GAR holds TOP, BOTTOM, INNER,
// OUTER, PIECES: a Set style is two to six garments sold together, so each
// coordinate IS one of them. That is why "+ Add coordinate" creates a material
// rather than a lookup value, and why this sheet exists at all.
//
// FORM C IS SHORT BY DESIGN, and that is what makes a complete mini-form
// possible here. `MATERIAL_FORMS.C` is `{ fields: ["category_id"] }` and
// material-types.ts says why in words: "A garment is identified by its category
// and its name and nothing else — the client asked for Category Name and Item
// Name, with none of the consumption/conversion modelling that sewing thread or
// buttons need". So the whole form is Category, Name and Base UOM.
//
// Mirrors YarnQuickCreateSheet deliberately — same optimistic-create flow, same
// `onAddOverride` entry point from the picker, same `createMaterial` action.
// The one difference is Base UOM: the Yarn sheet supplies KG for every slot
// because a yarn is always weighed, while a garment is counted and this shop
// carries both NOS and PCS. There is no single right answer to derive, so it is
// ASKED. That also sidesteps the failure the Yarn sheet hit — a required value
// derived from a master row that might not exist, leaving Save enabled and the
// server refusing with the name of a field the form never showed.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { CategoryPicker } from "@/components/masters/lookup-picker";
import { RecordPicker } from "@/components/masters/record-picker";
import { createMaterial } from "@/lib/masters/material-actions";
import { useDuplicateCheck, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import type { MaterialInput } from "@/lib/masters/material-types";
import type { Category } from "@/lib/masters/category-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { Levy } from "@/lib/masters/levy-types";

type UomRow = { id: string; code: string | null; name: string; inactive?: boolean };

export function GarmentQuickCreateSheet({
  open,
  onClose,
  onCreated,
  garmentClassId,
  categories,
  uoms,
  levies,
  fabricStructures,
  itemClasses,
  perms,
}: {
  open: boolean;
  /** Fires with the created garment so the picker can list + select it. */
  onCreated: (row: { id: string; code: string; name: string }) => void;
  onClose: () => void;
  /** config_lookups id of item class GAR — every garment is created under it. */
  garmentClassId: string;
  /** Already GARMENTS-scoped by the caller, the same contract
   *  `yarnQuickCreate.categories` has. */
  categories: Category[];
  uoms: UomRow[];
  /** Threaded through to the Category picker's OWN quick-create sheet, so
   *  "+ Add" nests: a garment whose category does not exist yet can be entered
   *  without leaving this sheet. */
  levies: Levy[];
  fabricStructures: ConfigLookup[];
  itemClasses: ConfigLookup[];
  perms: { canCreate: boolean; canEdit: boolean; canDelete: boolean };
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [uomId, setUomId] = useState("");

  /**
   * Fresh form every time the sheet opens.
   *
   * ADJUSTED DURING RENDER, NOT IN AN EFFECT — React's documented pattern for
   * "reset state when a prop changes". `YarnQuickCreateSheet` and
   * `CategoryQuickCreateSheet` both do this in a `useEffect` and both trip
   * `react-hooks/set-state-in-effect` for it; matching them would have meant
   * copying a lint error into new code. This shape also re-renders with the
   * corrected state before painting, so it cannot flash the previous garment's
   * name the way the effect version can.
   *
   * The two siblings are worth converting the same way, separately — doing it
   * here would be unrelated churn in a commit about coordinates.
   */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      setCategoryId("");
      setUomId("");
    }
  }

  // dup-check: server-only -- this sheet is opened FROM a Coordinate picker and
  // is never handed the item list, so there are no on-screen rows to scan. A
  // late answer still catches the cursor (keyboard-nav-provider.tsx).
  const dupError = useDuplicateCheck({
    table: "items",
    name,
    scope: { item_class_id: garmentClassId || null },
    enabled: open && !!(name && garmentClassId),
  });

  /** Every field `REQUIRED_BY_FORM.C` names — item_class_id (supplied),
   *  category_id and base_uom_id — plus the name. Gating on all of them is what
   *  stops the server answering with the name of a field the operator can see
   *  but was never told was mandatory. */
  const canSave =
    !!garmentClassId && !!categoryId && !!uomId && !!name.trim() && !dupError;

  function save() {
    startTransition(async () => {
      const trimmed = name.trim();
      const payload: MaterialInput = {
        code: "", // auto-generated from the name server-side
        name: trimmed,
        is_active: true,
        item_class_id: garmentClassId,
        hsn_code: null,
        hsn_id: null,
        category_id: categoryId || null,
        // General-only concept (0349); a garment has no sub-category.
        sub_category_id: null,
        // Form C asks no Transaction Type — a garment is made, not bought in
        // (material-types.ts, client 2026-07-28).
        material_type: null,
        user_defined: false,
        specifications: null,
        short_spec: null,
        count_id: null,
        purity_id: null,
        shade: null,
        fabric_type_id: null,
        fabric_structure_id: null,
        fabric_using: null,
        yarn_type_id: null,
        direct_purchase: false,
        // One unit in every slot, as the Yarn sheet does: there is nothing to
        // convert on a quick-create. The full Materials master is where a
        // garment that needs an alternative purchase unit gets one.
        has_alternate_uom: false,
        base_uom_id: uomId,
        stock_uom_id: uomId,
        billing_uom_id: uomId,
        planning_uom_id: uomId,
        purchase_uom_id: uomId,
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
      success(`Garment "${trimmed}" created.`);
      if (res.id) {
        // The server auto-generates the code and does not return it — pass
        // the name as both (ItemPicker renders the name; code is display-only
        // there). router.refresh() swaps in the real row later.
        onCreated({ id: res.id, code: trimmed, name: trimmed });
      } else {
        // id missing (should not happen) — refresh so the new garment at
        // least lands in the caller's server-fetched list rather than being
        // silently lost. Same fallback as YarnQuickCreateSheet.
        router.refresh();
      }
      onClose();
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New Coordinate"
      size="sm"
      // Above MasterFullScreen (80), and deliberately NOT above the picker panel
      // (150) that opened us — this sheet holds pickers of its own, which portal
      // at 150 too. Same reasoning as CategoryQuickCreateSheet.
      zIndexBase={120}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={isPending || !canSave} onClick={save}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Category first: it classifies the garment, and its own "+ Add" opens
            the class-aware Category sheet, so a brand-new category can be
            entered without leaving this one. */}
        <Field label="Category" required>
          <CategoryPicker
            label="Category"
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            itemClassId={garmentClassId}
            selectedClassCode="GAR"
            levies={levies}
            fabricStructures={fabricStructures}
            itemClasses={itemClasses}
            canCreate={perms.canCreate}
            canEdit={perms.canEdit}
            canDelete={perms.canDelete}
            required
            compact
          />
        </Field>

        <Field label="Name" required htmlFor="gqc-name">
          <Input
            id="gqc-name"
            autoFocus
            uppercase
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. TOP"
            className="text-base md:text-sm"
            {...dupFieldProps(dupError, "gqc-name")}
          />
          <DuplicateError error={dupError} id="gqc-name" />
        </Field>

        {/* ASKED, NOT DERIVED — see the header. A garment is counted, and this
            shop carries both NOS and PCS, so there is no single unit to supply
            on the operator's behalf. */}
        <Field label="Base UOM" required>
          <RecordPicker
            label="Base UOM"
            items={uoms}
            value={uomId}
            onChange={(v) => setUomId(v ?? "")}
            required
            compact
          />
        </Field>
      </div>
    </Sheet>
  );
}
