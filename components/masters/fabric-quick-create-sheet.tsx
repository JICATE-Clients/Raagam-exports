"use client";

/**
 * Quick-create a COMPLETE Fabric from inside the Fabric BOM's Fabric picker
 * (client 2026-09-02: "the first structure field based fabric only need to list
 * in that fabric field with the crud action").
 *
 * ## WHY THE ADD HAS TO BE A FORM AND NOT A NAME BOX
 *
 * `RecordPicker` says it in its own header: these fields reference records that
 * are created on their own full screens, and "a name-only row for a Vendor would
 * be born unusable". A fabric is the strongest case of that in this repo — a
 * name-only `items` row would be REFUSED outright, because `createMaterial`
 * demands `fabric_type_id`, `category_id` and `base_uom_id`
 * (`REQUIRED_BY_FORM.FABRIC`) and then a yarn composition on top
 * (`mixingRequiredError`'s FABRIC branch) unless Direct Purchase is ticked. An
 * inline Add here would be a button that can only ever produce an error.
 *
 * So this is `onAddOverride`'s case, exactly as the prop describes it: the
 * operator gets the real form. Mirrors `YarnQuickCreateSheet` deliberately —
 * same optimistic-create flow, same `createMaterial` action, same
 * mirror-the-server's-refusals-in-the-Save-gate rule.
 *
 * ## THE STRUCTURE IS CONTEXT, NOT A FIELD
 *
 * It arrives from the BOM line that opened this sheet and is shown read-only.
 * That is not a shortcut: the picker this Add hangs off is SCOPED to that
 * structure (`fabricItemsFor` in fabric-bom-screen.tsx), so a fabric created
 * under any other one would vanish from the very list the operator was looking
 * at when they pressed Add — created, saved, and apparently gone. The Materials
 * master is where a fabric gets filed under a different structure.
 *
 * ## THE NAME IS COMPOSED, NEVER TYPED
 *
 * `composeFabricName` is the Materials master's own rule, moved to
 * `lib/masters/fabric-name.ts` so both surfaces read one definition. A fabric
 * created here and one created there therefore carry the same name for the same
 * parts, which is what lets the Fabric BOM's "bracket rule" (0493) keep reading
 * a composition out of either.
 */

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { ChildGrid } from "@/components/masters/child-grid";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { ItemPicker } from "@/components/masters/lookup-picker";
import { RecordPicker, type PickerItem } from "@/components/masters/record-picker";
import { createMaterial } from "@/lib/masters/material-actions";
import { useDuplicateCheck } from "@/lib/masters/use-duplicate-check";
import { composeFabricName, isYarnDyedFabricType } from "@/lib/masters/fabric-name";
import {
  FABRIC_USING,
  missingRequiredMaterialFields,
  type MaterialInput,
} from "@/lib/masters/material-types";
import type { ConfigLookup } from "@/lib/masters/extras-types";

/** One composition row. TEXT while typing — same shape and same reason as the
 *  Materials master's `MixRow`: a number input must be able to hold "12."
 *  mid-keystroke, and `numOrNull` is what turns it into the payload's number. */
type MixRow = { key: string; component_item_id: string; blend_pct: string };
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

export function FabricQuickCreateSheet({
  open,
  onClose,
  onCreated,
  fabricClassId,
  structureId,
  structureName,
  fabricTypes,
  uoms,
  yarnItems,
  perms,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Fires with the created fabric so the caller can list + select it.
   *
   * CARRIES THE COLUMNS ITS READERS NEED, not just an id and a name. The Fabric
   * BOM stubs this row into its own option list until `router.refresh()` lands,
   * and on that screen `category_id` decides which structure's list it appears
   * in, `fabricType` decides the `Type` cell and whether [Detail] opens, and
   * `baseUomId` fills the line's consumption unit. A stub missing one of them is
   * a fabric that is picked and then behaves like a fabric with no type.
   */
  onCreated: (row: {
    id: string;
    code: string;
    name: string;
    categoryId: string;
    fabricType: string | null;
    baseUomId: string | null;
  }) => void;
  /** config_lookups id of item class FABRIC — scopes the record and the dup check. */
  fabricClassId: string;
  /** The BOM line's Structure — this fabric's `category_id`. See the header. */
  structureId: string;
  structureName: string;
  /** config_lookups kind `fabric_type` — Solid · Melange · Yarn Dyed. */
  fabricTypes: ConfigLookup[];
  uoms: PickerItem[];
  /** The yarns the composition grid picks from — class YARN, whole master. */
  yarnItems: PickerItem[];
  /**
   * Host screen's masters permissions, threaded through exactly as the Yarn
   * sheet threads them. Absent perms means NO inline CRUD on the pickers inside,
   * never full CRUD — a default here would decide an authorisation question in
   * the component that draws the buttons rather than at the screen that knows
   * the answer.
   */
  perms?: { canCreate: boolean; canEdit: boolean; canDelete: boolean };
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [fabricTypeId, setFabricTypeId] = useState("");
  const [baseUomId, setBaseUomId] = useState<string | null>(null);
  const [directPurchase, setDirectPurchase] = useState(false);
  const [using, setUsing] = useState("");
  const [mixings, setMixings] = useState<MixRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `m${keySeq.current++}`;

  /*
   * A FRESH FORM COMES FROM REMOUNTING, NOT FROM AN EFFECT.
   *
   * `YarnQuickCreateSheet` resets its fields in a `useEffect` keyed on `open`,
   * and `react-hooks/set-state-in-effect` reports that as an error: setting
   * state synchronously in an effect body is a cascading render, and React's own
   * answer is "you might not need an effect". The caller here mounts this
   * component only while a row is adding and keys it on that row, so every open
   * is a new mount with `useState`'s initial values — which is the same result
   * with no second render and nothing to keep in step.
   *
   * `open` is still a prop rather than being dropped: `Sheet` reads it for its
   * own enter/exit, and a caller that keeps this mounted is a shape the type
   * should still allow.
   */

  const fabricTypeName = fabricTypes.find((t) => t.id === fabricTypeId)?.name ?? null;
  const yarnDyed = isYarnDyedFabricType(fabricTypeName);
  const singleYarn = using === "Single Yarn";
  /** "Fabric and not Direct Purchase" — the same test `fabricAttributesVisible`
   *  makes on the Materials master, and the one that decides both whether the
   *  grid is on screen and whether an empty one blocks Save. A grid that is not
   *  shown must never be what refuses a save. */
  const compositionApplies = !directPurchase;
  /** The % column is meaningless for a Single Yarn (implicitly 100) and for a
   *  Yarn Dyed cloth (its yarns are dyed before knitting, so a share does not
   *  apply). Same rule as the master's `mixPctApplies`. */
  const pctApplies = compositionApplies && !yarnDyed && !singleYarn;

  const setMix = (key: string, patch: Partial<MixRow>) =>
    setMixings((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addMix = () =>
    setMixings((rows) => [...rows, { key: newKey(), component_item_id: "", blend_pct: "" }]);
  const delMix = (key: string) => setMixings((rows) => rows.filter((r) => r.key !== key));

  /** Declaring what the fabric is made OF is the moment its composition becomes
   *  the next thing to fill, so seed the first row — the same call
   *  `handleFabricUsingChange` makes on the master, and for the same reason:
   *  Single Yarn is capped at one row, so the "+ Add" click was pure ceremony
   *  for the only row it will ever have. */
  const handleUsingChange = (v: string) => {
    setUsing(v);
    if (v && mixings.length === 0) addMix();
  };

  // Never let the blend exceed 100% — the master's rule (client 2026-07-24):
  // keep the raw text so partial entry like "12." still types, unless this cell
  // would push the total over, then cap it to what is left.
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

  const mixPctSum = mixings.reduce((sum, m) => sum + (numOrNull(m.blend_pct) ?? 0), 0);
  const namedRows = mixings.filter((m) => m.component_item_id);

  /*
   * THE SERVER'S REFUSALS, MIRRORED SO SAVE SAYS WHY IT IS OFF instead of
   * bouncing off `createMaterial`. Wording follows the action's own — the same
   * refusal read two ways is how an operator learns to distrust one of them.
   *
   * All three are gated on `compositionApplies`, so ticking Direct Purchase
   * silences every one of them at once rather than one at a time.
   */
  const compositionProblem = !compositionApplies
    ? null
    : namedRows.length === 0
      ? "A fabric is its yarn composition — add at least one yarn, or tick Direct Purchase."
      : singleYarn && namedRows.length > 1
        ? "Single Yarn takes exactly one yarn — remove the extra rows or switch Using to Multiple Yarn."
        : pctApplies &&
            mixings.some((m) => numOrNull(m.blend_pct) != null) &&
            Math.abs(mixPctSum - 100) >= 0.01
          ? "Mixing percentages must add up to exactly 100%."
          : pctApplies && namedRows.some((m) => numOrNull(m.blend_pct) == null)
            ? "Every yarn needs its blend % — complete or remove the unfinished row."
            : null;

  /**
   * THE MANDATORY FIELDS, THROUGH THE SHARED FUNCTION rather than a hand-written
   * list. AGENTS.md's rule for a requiredness that is a property of the field FOR
   * A CASE: `missingRequiredMaterialFields` is what the action will run, so a
   * field it names is a field Save is refused for — the Yarn sheet's Base UOM
   * defect (Save enabled, server answering with the name of a field the form
   * never showed) is unrepresentable here.
   */
  const missingRequired = missingRequiredMaterialFields(
    {
      item_class_id: fabricClassId,
      fabric_type_id: fabricTypeId || null,
      category_id: structureId || null,
      base_uom_id: baseUomId,
      fabric_using: directPurchase ? null : using || null,
      direct_purchase: directPurchase,
    },
    "FABRIC",
  );

  const previewName = useMemo(
    () =>
      composeFabricName({
        fabricType: fabricTypeName,
        structure: structureName,
        parts: mixings.map((m) => ({
          pct: m.blend_pct,
          label: m.component_item_id
            ? (yarnItems.find((y) => y.id === m.component_item_id)?.name ?? "")
            : "",
        })),
        yarnDyed,
        singleYarn,
      }) ?? "",
    [fabricTypeName, structureName, mixings, yarnItems, yarnDyed, singleYarn],
  );

  // dup-check: server-only -- the name is COMPOSED here from the type, the
  // structure and the yarns; the `items` rows it would collide with are never
  // passed to this sheet. A late answer still catches the cursor
  // (keyboard-nav-provider.tsx), and `checkDuplicateName` in `createMaterial` is
  // the guard either way.
  const dupError = useDuplicateCheck({
    table: "items",
    name: previewName,
    scope: { item_class_id: fabricClassId },
    enabled: open && !!previewName,
  });

  const canCreate = perms?.canCreate ?? false;
  const canEdit = perms?.canEdit ?? false;
  const canDelete = perms?.canDelete ?? false;
  const usedYarnIds = mixings.map((m) => m.component_item_id).filter(Boolean);
  /** `ItemPicker` types `code` as a plain string; the services that feed picker
   *  rows type it nullable, because most masters auto-generate the code and can
   *  legitimately hold none. Narrowed here rather than at the service, which is
   *  shared with the Fabric cell and the Yarn Process tab. */
  const yarnRows = useMemo(
    () => yarnItems.map((y) => ({ ...y, code: y.code ?? "" })),
    [yarnItems],
  );

  function save() {
    startTransition(async () => {
      const payload: MaterialInput = {
        code: "", // auto-generated from the name server-side
        name: previewName,
        is_active: true,
        item_class_id: fabricClassId,
        hsn_code: null,
        hsn_id: null,
        category_id: structureId,
        sub_category_id: null, // General-only concept (0349); this sheet is Fabric.
        item_type_name: null,
        item_base_name: null,
        material_type: null,
        user_defined: false,
        specifications: null,
        short_spec: null,
        count_id: null,
        purity_id: null,
        shade: null,
        fabric_type_id: fabricTypeId || null,
        /* THE KNIT FAMILY IS THE CATEGORY'S, NOT ASKED HERE. `fabric_structure_id`
           on `items` is legacy's own copy of a fact `categories` already carries
           (0279: "Structure lives on Category, Material just reads it"), and the
           Fabric BOM reads the family off the structure row. Sending null keeps
           this sheet from inventing a second answer to it. */
        fabric_structure_id: null,
        fabric_using: directPurchase ? null : using || null,
        yarn_type_id: null,
        direct_purchase: directPurchase,
        /* One unit for every slot — quick-create has nothing to convert, and the
           full Materials master is where a fabric that needs an alternative
           purchase unit gets one. `applyFabricUomRule` only ever SUPPLIES a
           missing base, so passing one explicitly is not overridden. */
        has_alternate_uom: false,
        base_uom_id: baseUomId,
        stock_uom_id: baseUomId,
        billing_uom_id: baseUomId,
        planning_uom_id: baseUomId,
        purchase_uom_id: baseUomId,
        cost_head_id: null,
        budget_rate: null,
        budget_rate_uom_id: null,
        /*
         * Only when the grid is ON SCREEN. Ticking Direct Purchase leaves the
         * rows in state — so unticking restores what was typed instead of
         * silently discarding it — but sending them would let a grid the
         * operator can no longer see trip the 100% refine and refuse a save they
         * cannot explain. Shown and sent are the same condition.
         *
         * `blend_pct` IS NULL WHERE THE % COLUMN IS HIDDEN, and that is not
         * tidiness: `materialInput`'s top-level refine demands any non-null
         * shares total exactly 100, so a Single Yarn row carrying a stale "60"
         * would be refused by the schema for a field the sheet never showed.
         */
        mixings: compositionApplies
          ? namedRows.map((m, i) => ({
              sno: i + 1,
              description: null,
              shade: null,
              uom_id: null,
              component_item_id: m.component_item_id,
              count_id: null,
              blend_pct: pctApplies ? numOrNull(m.blend_pct) : null,
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
      success(`Fabric "${previewName}" created.`);
      if (res.id) {
        // The server auto-generates the code and doesn't return it — pass the
        // name as both. `router.refresh()` swaps in the real row later.
        onCreated({
          id: res.id,
          code: previewName,
          name: previewName,
          categoryId: structureId,
          fabricType: fabricTypeName,
          baseUomId: baseUomId,
        });
      } else {
        // id missing (shouldn't happen) — refresh so the new fabric at least
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
      title="New Fabric"
      size="sm"
      // Above MasterFullScreen (80), and deliberately NOT above the picker panel
      // (150) that opened us: this sheet holds pickers of its own and they
      // portal at 150 too. `DataPicker.startAdd` closes its list before handing
      // over, which is what keeps the two off screen together.
      zIndexBase={120}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="md"
            disabled={
              isPending ||
              missingRequired.length > 0 ||
              !!compositionProblem ||
              !previewName ||
              !!dupError
            }
            onClick={save}
          >
            {isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* THE STRUCTURE, STATED AND NOT ASKED — see the header. Plain text
            rather than a disabled control: a box that cannot be typed into still
            says "you may type here". */}
        <div>
          <Label>Structure</Label>
          <div className="flex min-h-9 items-center rounded-md border border-border bg-surface-muted px-3 py-1.5 text-sm font-medium text-foreground">
            {structureName}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            The fabric is filed under this structure, so it appears on this line.
          </p>
        </div>
        <div>
          <LookupDialogPicker
            kind="fabric_type"
            label="Fabric Type"
            options={fabricTypes}
            value={fabricTypeId}
            onChange={setFabricTypeId}
            required
            canCreate={canCreate}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </div>
        <div>
          {/* ASKED, NOT DERIVED. The master prefills it from the structure's knit
              family (`fabricStructureUom` — Circular KGS, Flat NOS, Woven MTR),
              and that prefill is keyed on the family's CODE, which the BOM's
              structure row carries only as a NAME. Re-deriving it from the name
              would be a second reading of a table whose header says a rename of
              it already breaks things. So it is a pick — and it matters, because
              this is the unit the line's consumption figure is then in (0513). */}
          <RecordPicker
            label="Base UOM"
            items={uoms}
            value={baseUomId}
            onChange={setBaseUomId}
            required
          />
        </div>
        <div>
          <label className="flex h-9 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={directPurchase}
              onChange={(e) => setDirectPurchase(e.target.checked)}
            />
            <span className="text-sm">Direct Purchase (bought ready-made)</span>
          </label>
          <p className="text-xs text-muted-foreground">
            Ticked, the cloth is bought finished and declares no yarn composition.
          </p>
        </div>
        {compositionApplies && (
          <>
            <Field label="Using" size="full" required>
              <Select value={using} onChange={(e) => handleUsingChange(e.target.value)}>
                <option value=""></option>
                {FABRIC_USING.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="border-t border-border pt-3">
              <ChildGrid<MixRow>
                inlineCards
                label="Composition"
                badge={
                  pctApplies &&
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
                /* Single Yarn is exactly one row (client 2026-07-23 #9), so the
                   grid stops offering a second rather than letting the operator
                   add one and then refusing the save for it. */
                hideAdd={singleYarn && mixings.length >= 1}
                addLabel="+ Add yarn"
                columns={[
                  {
                    header: "Yarn",
                    required: true,
                    cell: (m) => (
                      <ItemPicker
                        label=""
                        title="Component Yarn"
                        items={yarnRows}
                        value={m.component_item_id}
                        usedIds={usedYarnIds}
                        onChange={(v) => setMix(m.key, { component_item_id: v })}
                        placeholder="— Component yarn —"
                      />
                    ),
                  },
                  ...(pctApplies
                    ? [
                        {
                          header: "Mixing %",
                          align: "center" as const,
                          width: "5rem",
                          required: true,
                          cell: (m: MixRow) => (
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
                      ]
                    : []),
                ]}
              />
              {/* A composition needs something to compose FROM. With no yarns on
                  the master the grid is unanswerable, so say that instead of
                  showing an empty picker. */}
              {yarnItems.length === 0 ? (
                <p className="mt-1 text-xs text-warning">
                  No yarns exist yet to compose from. Create them on Master Data ▸ Materials ▸
                  Yarn first, or tick Direct Purchase.
                </p>
              ) : (
                compositionProblem && <p className="mt-1 text-xs text-danger">{compositionProblem}</p>
              )}
            </div>
          </>
        )}

        {/* Auto-generated NAME — the Materials master's own rule, one definition
            (`composeFabricName`). */}
        <div className="border-t border-border pt-3">
          <Label>Name (auto-generated)</Label>
          <div className="flex min-h-9 items-center rounded-md border border-border bg-surface-muted px-3 py-1.5 text-sm font-medium text-foreground">
            {previewName || (
              <span className="font-normal text-muted-foreground">Pick the Fabric Type…</span>
            )}
          </div>
          {/* Deliberately NOT `dupFieldProps` / `<DuplicateError>`: the name here
              is the composed <div> above, not an input, so there is no field for
              the keyboard hold to hold. Save is gated on `dupError` instead. */}
          {dupError && <p className="mt-1 text-xs text-danger">{dupError}</p>}
          {/* The remaining refusal, named. A disabled Save with no reason is the
              thing this whole sheet exists to avoid. */}
          {!dupError && missingRequired.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Still needed: {missingRequired.join(", ")}.
            </p>
          )}
        </div>
      </div>
    </Sheet>
  );
}
