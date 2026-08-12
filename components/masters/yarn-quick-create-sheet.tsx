"use client";

// Quick-create a COMPLETE Yarn from inside another form's Component Yarn picker
// (client 2026-07-23, Fabric Master #11) — not just a name like the picker's
// inline Add. Mirrors the Materials master's YARN form rules: the Name is
// auto-generated (Count + Category NAME + Purity, CAPS), Melange carries a
// Shade, and every UOM defaults to kg (yarn is always traded in kg, 0279 #15).
// Richer fields (HSN, Mixing rows for Mixed-nature blends…) stay editable from
// the full Materials master afterwards.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { ChildGrid } from "@/components/masters/child-grid";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { CategoryPicker, ItemPicker } from "@/components/masters/lookup-picker";
import { createMaterial } from "@/lib/masters/material-actions";
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";
import { yarnMixingApplies, type MaterialInput } from "@/lib/masters/material-types";
import type { Deactivatable } from "@/lib/masters/inactive";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import type { Category } from "@/lib/masters/category-types";

/** One row of the blend. Kept as TEXT while typing — same shape and same reason
 *  as the Materials master's `MixRow`: a number input must be able to hold "12."
 *  mid-keystroke, and `numOrNull` is what turns it into the payload's number. */
type MixRow = { key: string; component_item_id: string; blend_pct: string };
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

export function YarnQuickCreateSheet({
  open,
  onClose,
  onCreated,
  yarnClassId,
  yarnItems = [],
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
  /**
   * The component yarns the Mixing grid picks from — the SAME list the picker
   * that opened this sheet is showing (see the call site in lookup-picker.tsx).
   * Optional so an older caller still compiles; without it a Mixed yarn simply
   * has nothing to blend from, and the grid says so rather than rendering an
   * empty picker with no explanation.
   */
  yarnItems?: ({ id: string; code: string; name: string } & Deactivatable)[];
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
  const [mixings, setMixings] = useState<MixRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `m${keySeq.current++}`;

  // Fresh form every time the sheet opens.
  useEffect(() => {
    if (open) {
      setCountId("");
      setCategoryId("");
      setPurityId("");
      setYarnTypeId("");
      setShade("");
      setMixings([]);
    }
  }, [open]);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) ?? null,
    [categories, categoryId],
  );
  const yarnTypeName = yarnTypes.find((y) => y.id === yarnTypeId)?.name ?? null;
  const isMelange = yarnTypeName?.toLowerCase() === "melange";

  /**
   * A MIXED YARN DECLARES ITS BLEND HERE, NOT "LATER" (client 2026-08-11).
   *
   * This sheet used to send `mixings: []` always and print a note telling the
   * operator to add the rows from the Materials master afterwards. That note
   * stopped being true the moment `mixingRequiredError`'s YARN branch landed
   * (material-actions.ts): a Mixed-nature Category — or a Twisted / Doubling /
   * Melange type — now makes at least one complete row MANDATORY, so the sheet
   * could not create the very yarn it was apologising about. Save returned
   * "Mixing Details are required for a Mixed yarn" and there was no field on
   * screen to answer it with.
   *
   * `yarnMixingApplies` is the shared rule (material-types.ts), read here and by
   * the server from one definition, so "the grid is showing" and "the save will
   * be refused" cannot disagree — the same guarantee the Materials master gets
   * from `yarnMixingVisible`.
   */
  const mixingApplies = yarnMixingApplies(selectedCategory?.made ?? null, yarnTypeName);

  const setMix = (key: string, patch: Partial<MixRow>) =>
    setMixings((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addMix = () =>
    setMixings((rows) => [...rows, { key: newKey(), component_item_id: "", blend_pct: "" }]);
  const delMix = (key: string) => setMixings((rows) => rows.filter((r) => r.key !== key));

  // Never let the blend exceed 100% (material-master-screen.tsx's rule, client
  // 2026-07-24): keep the raw text so partial entry like "12." still types,
  // unless this cell would push the total over — then cap it to what is left.
  const setMixPct = (key: string, raw: string) => {
    const n = Number(raw);
    if (raw.trim() === "" || Number.isNaN(n)) {
      setMix(key, { blend_pct: raw });
      return;
    }
    const others = mixings.reduce(
      (s, r) => (r.key === key ? s : s + (numOrNull(r.blend_pct) ?? 0)),
      0,
    );
    const max = Math.max(0, 100 - others);
    setMix(key, { blend_pct: n > max ? String(max) : raw });
  };

  /*
   * The server's two tests, mirrored so Save says why it is off instead of
   * bouncing off `createMaterial`. Wording matches `mixingRequiredError`
   * verbatim — the same refusal read two ways is how an operator learns to
   * distrust one of them.
   *
   * TOUCHED vs COMPLETE, both needed, for the reason the master records:
   * counting rows would block Save on a blank line `normMixings` drops
   * server-side, and counting only completeness would let a half-filled row
   * through — the row that silently loses its data on save.
   */
  const mixTouched = mixings.filter((m) => m.component_item_id || numOrNull(m.blend_pct) != null);
  const mixComplete = mixTouched.filter(
    (m) => m.component_item_id && numOrNull(m.blend_pct) != null,
  );
  const mixPctSum = mixings.reduce((sum, m) => sum + (numOrNull(m.blend_pct) ?? 0), 0);
  const mixPctInvalid =
    mixingApplies &&
    mixings.some((m) => numOrNull(m.blend_pct) != null) &&
    Math.abs(mixPctSum - 100) >= 0.01;
  const mixingProblem = !mixingApplies
    ? null
    : mixComplete.length === 0
      ? "Mixing Details are required for a Mixed yarn — add at least one yarn with its blend %."
      : mixComplete.length !== mixTouched.length
        ? "Every mixing row needs both a yarn and a blend % — complete or remove the unfinished row."
        : mixPctInvalid
          ? "Mixing percentages must add up to exactly 100%."
          : null;
  const usedComponentIds = mixings.map((m) => m.component_item_id).filter(Boolean);

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
        /*
         * Only when the blend grid is ON SCREEN. A Category switched from Mixed
         * to Natural leaves its rows in state — so switching back restores what
         * was typed instead of silently discarding it — but sending them would
         * let a grid the operator can no longer see trip the 100% refine and
         * refuse a save they cannot explain. Shown and sent are the same
         * condition, which is the same promise `mixingApplies` makes above.
         */
        mixings: mixingApplies
          ? mixings
              .filter((m) => m.component_item_id)
              .map((m, i) => ({
                sno: i + 1,
                description: null,
                shade: null,
                uom_id: null,
                component_item_id: m.component_item_id,
                count_id: null,
                blend_pct: numOrNull(m.blend_pct),
              }))
          : [],
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
              namePending ||
              // The blend, on the same terms the server states them. Null unless
              // `mixingApplies`, so a plain yarn is unaffected.
              !!mixingProblem
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
        {/* MIXING — shown on exactly the condition that makes it mandatory, so
            the operator is never refused for a field that is not on screen.
            A ChildGrid, not a hand-rolled row: it brings the arrows, Enter,
            tab-along-row and Ctrl+Del-removes-a-row that the keyboard contract
            promises, and the `required` columns draw their own stars and hold
            the cursor on an empty cell. */}
        {mixingApplies && (
          <div className="border-t border-border pt-3">
            <ChildGrid<MixRow>
              inlineCards
              label="Mixing"
              badge={
                mixings.some((m) => m.component_item_id || numOrNull(m.blend_pct) != null) && (
                  <span
                    className={cn(
                      "text-xs font-medium",
                      Math.abs(mixPctSum - 100) < 0.01 ? "text-success" : "text-danger",
                    )}
                  >
                    {mixPctSum}% of 100%
                  </span>
                )
              }
              rows={mixings}
              onAdd={addMix}
              onRemove={(m) => delMix(m.key)}
              addLabel="+ Add mixing row"
              columns={[
                {
                  header: "Yarn",
                  required: true,
                  cell: (m) => (
                    <ItemPicker
                      label=""
                      title="Component Yarn"
                      items={yarnItems}
                      value={m.component_item_id}
                      usedIds={usedComponentIds}
                      onChange={(v) => setMix(m.key, { component_item_id: v })}
                      placeholder="— Component yarn —"
                    />
                  ),
                },
                {
                  header: "Mixing %",
                  align: "center",
                  width: "5rem",
                  required: true,
                  cell: (m) => (
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="%"
                      value={m.blend_pct}
                      onChange={(e) => setMixPct(m.key, e.target.value)}
                      className="text-center"
                    />
                  ),
                },
              ]}
            />
            {/* A blend needs something to blend FROM. With no yarns on the list
                the grid is unanswerable, so say that instead of showing an empty
                picker — the same reason the missing-KG banner exists above. */}
            {yarnItems.length === 0 ? (
              <p className="mt-1 text-xs text-warning">
                No other yarns exist yet to blend from. Create the component yarns first, or add
                this one from Master Data ▸ Materials.
              </p>
            ) : (
              mixingProblem && <p className="mt-1 text-xs text-danger">{mixingProblem}</p>
            )}
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
