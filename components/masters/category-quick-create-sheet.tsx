"use client";

// Quick-create a COMPLETE Category from inside another form's Category picker —
// not just a name like the picker's inline Add. Mirrors the full Category master
// (category-master-screen.tsx): the fields shown depend on the parent Item
// Class — Category Type (Natural/Manmade/Mixed) for Yarn, Fabric Structure for
// Fabric. Richer costing fields (wastage/profit/…) stay editable from the full
// Category master afterwards, defaulted to 0 here.
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
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { createCategory } from "@/lib/masters/category-actions";
import { useDuplicateCheck, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { DuplicateError } from "@/components/ui/duplicate-error";
import {
  MADE_TYPES,
  type Category,
  type CategoryInput,
  type MadeType,
} from "@/lib/masters/category-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { Levy } from "@/lib/masters/levy-types";

export function CategoryQuickCreateSheet({
  open,
  onClose,
  onCreated,
  itemClassId,
  selectedClassCode,
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
  /** Parent item class CODE (YARN/FABRIC/GEN/…) — drives which fields render.
   *  When `itemClasses` is supplied this is only the STARTING value; the
   *  operator's choice inside the sheet wins from then on. */
  selectedClassCode: string | null;
  /**
   * Supply this and the sheet ASKS FOR THE ITEM CLASS ITSELF, as its first
   * field, with everything below driven by the answer (client 2026-08-10).
   *
   * Omit it — as material-master-screen.tsx does — and the class comes from
   * the parent form, which already asked. Two forms asking the same question
   * is how the answers drift, so this is opt-in rather than always-on: a
   * caller that KNOWS the class must not re-ask it.
   */
  itemClasses?: ConfigLookup[];
  /** Still accepted, deliberately unused: Levy Description was hidden from both
   *  Category forms (client 2026-08-01, see category-master-screen.tsx). Kept in
   *  the signature so re-showing the picker — here or on a child — is one line
   *  and no call site has to be re-plumbed. */
  levies: Levy[];
  fabricStructures: ConfigLookup[];
  perms: { canCreate: boolean; canEdit: boolean; canDelete: boolean };
}) {
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [made, setMade] = useState<"" | MadeType>("");
  const [fabricStructureId, setFabricStructureId] = useState("");
  /**
   * The class this category is being created under.
   *
   * Seeded from the prop so a caller that already knows it (the Material
   * child) is unaffected, and so a caller that asks still opens on a sensible
   * default rather than blank.
   */
  const [classId, setClassId] = useState(itemClassId);

  // Fresh form every time the sheet opens.
  useEffect(() => {
    if (open) {
      setName("");
      setMade("");
      setFabricStructureId("");
      // Re-seed from the prop on every open: the parent may have changed
      // class since, and a stale class here would file the new category
      // under the previous one.
      setClassId(itemClassId);
      // No `setUserDefined` — the User Defined question was dropped from this
      // sheet (client 2026-07-30) and `user_defined` is hardcoded false in the
      // payload below. The setter outlived its state and broke the typecheck.
      // Same story now for `setLevyId` — the Levy field is hidden, so the state
      // went with it rather than sitting here holding a permanent "".
    }
  }, [open, itemClassId]);

  /** Drives which fields render. Reads the CHOSEN class when the sheet asked
   *  for one, falling back to the caller's when it did not. */
  const chosenClass = itemClasses?.find((c) => c.id === classId) ?? null;
  const code = (chosenClass?.code ?? selectedClassCode)?.toUpperCase() ?? null;
  const showMade = code === "YARN";
  const showFabricStructure = code === "FABRIC";

  // Real-time duplicate check on Name, scoped to the parent Item Class —
  // backstopped server-side by createCategory's own duplicate guard.
  //
  // dup-check: server-only -- this sheet is opened FROM a Category picker and is
  // never handed the category list, so there are no on-screen rows to scan. A
  // late answer still catches the cursor (keyboard-nav-provider.tsx).
  const dupError = useDuplicateCheck({
    table: "categories",
    name,
    scope: { item_class_id: classId || null },
    enabled: open && !!(name && classId),
  });

  // No "did you mean?" suggestions on Name (client 2026-07-30) — the red
  // duplicate error is the only feedback this field gives.

  // made only applies to Yarn — never persist a stray value for other classes.
  const madeValue = useMemo(() => (showMade && made ? made : null), [showMade, made]);

  function save() {
    startTransition(async () => {
      const trimmed = name.trim();
      const payload: CategoryInput = {
        item_class_id: classId,
        short_name: trimmed || null, // merged: Short Name = Name (single field)
        // Required by the schema now; Save is gated on `!name.trim()`. The
        // `stub` below keeps `|| null` on purpose — it is a `Category` ROW,
        // whose column is still nullable.
        name: trimmed,
        short_spec: null,
        made: madeValue,
        // Field hidden (client 2026-08-01) — a quick-create never sets it. The
        // key stays so CategoryInput is satisfied and the column round-trips.
        levy_id: null,
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
        item_class_id: classId,
        short_name: trimmed || null,
        name: trimmed || null,
        short_spec: null,
        made: madeValue,
        // Field hidden (client 2026-08-01) — a quick-create never sets it. The
        // key stays so CategoryInput is satisfied and the column round-trips.
        levy_id: null,
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
          <Button size="md" disabled={isPending || !classId || !name.trim() || !!dupError} onClick={save}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/**
          * `<Field required>`, NOT a hand-written `*`.
          *
          * This was the reported bug (client 2026-08-10): a bare `<Label>Name
          * <span className="text-danger">*</span></Label>` over a plain
          * `<Input>`. `useRequiredHold` emits `data-required-empty` from
          * `ctx.required || own.required`, and neither was set — so the star was
          * decoration and a blank Name let Tab, Enter and ↓ straight past.
          *
          * NOT caused by the `RequiredScope` reset that `Sheet` puts at its
          * portal boundary: that reset only clears INHERITED requiredness, and a
          * `<Field required>` below it provides its own context, which wins.
          */}
        {/**
          * ITEM CLASS FIRST, AND ONLY WHEN THE CALLER DID NOT ALREADY ASK.
          *
          * The client's flow is "click Add, choose the class, and the form for
          * that class opens" (2026-08-10). Everything below reads `code`, which
          * follows this picker — so changing the class here swaps the
          * class-dependent fields live rather than needing the sheet reopened.
          *
          * `required`: a category cannot exist outside a class, and creating one
          * under the wrong class files it somewhere the operator will not find
          * it again.
          */}
        {itemClasses && (
          <Field label="Item Class" required>
            <LookupDialogPicker
              kind="item_class"
              label="Item Class"
              options={itemClasses}
              value={classId}
              onChange={(id) => {
                // Class-dependent answers belong to the class that was showing
                // when they were given. Keeping them would file a Yarn's
                // "Category Type" against a Fabric.
                setClassId(id);
                setMade("");
                setFabricStructureId("");
              }}
              // No inline Add: creating an ITEM CLASS from inside a category
              // quick-create is two masters deep, and the class list is a fixed
              // seven the business does not extend casually.
              canCreate={false}
              canEdit={false}
              compact
            />
          </Field>
        )}

        <Field label="Name" required htmlFor="cqc-name">
          <Input
            id="cqc-name"
            autoFocus
            uppercase
            value={name}
            onChange={(e) => setName(e.target.value)}
            // No local Enter handler. It used to save from here (client
            // 2026-07-23), which under Enter-advance means committing from field
            // ONE and skipping Category Type and Fabric Structure below. The
            // Sheet's footer already carries data-focus-region="footer" with Save
            // last by position, so the global contract reaches it off the last
            // field without help.
            className="text-base md:text-sm"
            {...dupFieldProps(dupError, "cqc-name")}
          />
          <DuplicateError error={dupError} id="cqc-name" />
        </Field>

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

        {/* Fabric Structure is a stored list, so it is a picker rather than a
            <Select> — but it is SELECT-ONLY, exactly as Category Type above
            cannot be extended. `CLOSED_LOOKUP_KINDS` (extras-types.ts) is where
            that is declared; the picker drops Add / Modify / Delete whatever
            perms it is handed, so this sheet needs no special case of its own. */}
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

        {/* Levy Description hidden here too — the full Category master dropped
            it on the same call, and a quick-create must never ask more than the
            master it is a shortcut for. */}
      </div>
    </Sheet>
  );
}
