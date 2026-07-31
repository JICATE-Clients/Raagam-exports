"use client";

// Quick-create a COMPLETE Category from inside another form's Category picker —
// not just a name like the picker's inline Add. Mirrors the full Category master
// (category-master-screen.tsx): the fields shown depend on the parent Item
// Class — Category Type (Natural/Manmade/Mixed) for Yarn, Fabric Structure for
// Fabric — plus Levy and Commodity. Richer costing fields (wastage/profit/…)
// stay editable from the full Category master afterwards, defaulted to 0 here.
// ("User Defined" used to be one of the class-dependent fields; the client
// dropped the question on 2026-07-30 — see doc/masters-open-questions.md #6.)
//
// Why this exists: a name-only category leaves `made` null, which silently
// breaks the Yarn form — the Mixing % grid is gated on the category's
// made === "Mixed" (material-master-screen.tsx). This lets the user set it up
// front, from the same picker, exactly like YarnQuickCreateSheet does for yarns.

import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { LevyPicker } from "@/components/masters/lookup-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { CommodityPicker } from "@/components/masters/commodity-picker";
import { createCategory } from "@/lib/masters/category-actions";
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";
import {
  MADE_TYPES,
  type Category,
  type CategoryInput,
  type MadeType,
} from "@/lib/masters/category-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { Levy } from "@/lib/masters/levy-types";
import type { Commodity } from "@/lib/masters/commodity-types";

export function CategoryQuickCreateSheet({
  open,
  onClose,
  onCreated,
  itemClassId,
  selectedClassCode,
  levies,
  commodities,
  itemClasses,
  fabricStructures,
  perms,
}: {
  open: boolean;
  onClose: () => void;
  /** Fires with the freshly created row so the caller can list + select it. */
  onCreated: (cat: Category) => void;
  /** config_lookups id of the parent item class — scopes the record + dup check. */
  itemClassId: string;
  /** Parent item class CODE (YARN/FABRIC/GEN/…) — drives which fields render. */
  selectedClassCode: string | null;
  levies: Levy[];
  commodities: Commodity[];
  itemClasses: ConfigLookup[];
  fabricStructures: ConfigLookup[];
  perms: { canCreate: boolean; canEdit: boolean; canDelete: boolean };
}) {
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [made, setMade] = useState<"" | MadeType>("");
  const [fabricStructureId, setFabricStructureId] = useState("");
  const [levyId, setLevyId] = useState("");
  const [commodityId, setCommodityId] = useState("");

  // Fresh form every time the sheet opens.
  useEffect(() => {
    if (open) {
      setName("");
      setMade("");
      setFabricStructureId("");
      // No `setUserDefined` — the User Defined question was dropped from this
      // sheet (client 2026-07-30) and `user_defined` is hardcoded false in the
      // payload below. The setter outlived its state and broke the typecheck.
      setLevyId("");
      setCommodityId("");
    }
  }, [open]);

  const code = selectedClassCode?.toUpperCase() ?? null;
  const showMade = code === "YARN";
  const showFabricStructure = code === "FABRIC";

  // Real-time duplicate check on Name, scoped to the parent Item Class —
  // backstopped server-side by createCategory's own duplicate guard.
  const dupError = useDuplicateCheck({
    table: "categories",
    name,
    scope: { item_class_id: itemClassId || null },
    enabled: open && !!(name && itemClassId),
  });

  // No "did you mean?" suggestions on Name (client 2026-07-30) — the red
  // duplicate error is the only feedback this field gives.

  // made only applies to Yarn — never persist a stray value for other classes.
  const madeValue = useMemo(() => (showMade && made ? made : null), [showMade, made]);

  function save() {
    startTransition(async () => {
      const trimmed = name.trim();
      const payload: CategoryInput = {
        item_class_id: itemClassId,
        short_name: trimmed || null, // merged: Short Name = Name (single field)
        name: trimmed || null,
        short_spec: null,
        made: madeValue,
        levy_id: levyId || null,
        commodity_id: commodityId || null,
        fabric_structure_id: showFabricStructure ? fabricStructureId || null : null,
        wastage_per: 0,
        profit_per: 0,
        freight_per: 0,
        insurance_per: 0,
        interest_per: 0,
        size_group_id: null,
        status_monitoring_type: null,
        user_defined: false, // no longer asked (client 2026-07-30)
        inactive: false,
        // Sub Categories are defined on the full Category master, not in this
        // quick-create mini-child (0349) — a new category starts with none.
        has_sub_categories: false,
        sub_categories: [],
      };
      const res = await createCategory(payload);
      if (!res.ok) {
        error(res.error);
        return;
      }
      success(`Category "${trimmed}" created.`);
      // Optimistic full row for the picker's local list — router.refresh()
      // swaps in the real server row (with created_by/at) later.
      const stub: Category = {
        id: res.id,
        item_class_id: itemClassId,
        short_name: trimmed || null,
        name: trimmed || null,
        short_spec: null,
        made: madeValue,
        levy_id: levyId || null,
        commodity_id: commodityId || null,
        fabric_structure_id: showFabricStructure ? fabricStructureId || null : null,
        wastage_per: 0,
        profit_per: 0,
        freight_per: 0,
        insurance_per: 0,
        interest_per: 0,
        size_group_id: null,
        status_monitoring_type: null,
        user_defined: false, // no longer asked (client 2026-07-30)
        inactive: false,
        has_sub_categories: false,
        sub_categories: [],
        created_by: null,
        created_by_name: null,
        created_at: "",
        updated_at: "",
      };
      onCreated(stub);
      onClose();
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New Category"
      size="sm"
      zIndexBase={120} // stacks above the picker dialog (100)
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={isPending || !name.trim() || !!dupError} onClick={save}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label htmlFor="cqc-name">
            Name <span className="text-danger">*</span>
          </Label>
          <Input
            id="cqc-name"
            autoFocus
            uppercase
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              // Enter = save (client 2026-07-23)
              if (e.key === "Enter" && !isPending && name.trim() && !dupError) {
                e.preventDefault();
                save();
              }
            }}
            className="text-base md:text-sm"
          />
          {dupError && <p className="mt-1 text-xs text-danger">{dupError}</p>}
        </div>

        {/* Category Type (Natural/Manmade/Mixed) is a Yarn concept only — it
            drives Nature display + the Mixing % grid on the Materials form. */}
        {showMade && (
          <div>
            <Label htmlFor="cqc-made">Category Type</Label>
            <Select
              id="cqc-made"
              value={made}
              onChange={(e) => setMade(e.target.value as "" | MadeType)}
              className="text-base md:text-sm"
            >
              <option value="">— Select —</option>
              {MADE_TYPES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
        )}

        {/* Fabric Structure is a stored list, so it is a picker with inline
            Add / Modify / Delete — unlike Category Type above, which is a fixed
            three-value enum the operator can never extend. */}
        {showFabricStructure && (
          <div>
            <LookupDialogPicker
              kind="fabric_structure"
              label="Fabric Structure"
              options={fabricStructures}
              value={fabricStructureId}
              onChange={setFabricStructureId}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
              canDelete={perms.canDelete}
            />
          </div>
        )}

        <LevyPicker label="Levy Description" levies={levies} value={levyId} onChange={setLevyId} />

        <CommodityPicker
          commodities={commodities}
          itemClasses={itemClasses}
          value={commodityId}
          onChange={setCommodityId}
          canCreate={perms.canCreate}
          canEdit={perms.canEdit}
          canDelete={perms.canDelete}
        />
      </div>
    </Sheet>
  );
}
