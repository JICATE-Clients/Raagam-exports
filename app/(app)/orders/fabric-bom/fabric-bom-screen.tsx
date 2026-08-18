"use client";

/**
 * Orders ▸ Fabric BOM — step 5 of the client's order flow (0426).
 *
 * TWO SURFACES, one route. `mode === "list"` is the merchandiser's work queue —
 * one row per confirmed garment ORDER, not one per document, so an order with no
 * BOM is visible as "Pending" rather than absent. `mode === "edit"` is the
 * editor, a full-screen takeover for the reason the Material BOM records: a page
 * mount left the module sidebar beside the section rail, putting two navigation
 * lists on screen and leaving ~1090px for a wide grid.
 *
 * THE LINE GRID IS `forceCards`. Fourteen columns cannot fit the width a rail
 * leaves, and the responsive table answers that with a horizontal scrollbar —
 * the operator fills the first cell, then drags a bar to reach the last one with
 * the first scrolled out of sight (raagam-screen-layout, the operator's five,
 * rule 4). Every cell's `required` is forwarded onto the control inside
 * `renderMobileRow`, because that callback replaces the `columns.map()` that
 * would otherwise wrap each cell in a `RequiredScope` — forgetting it leaves the
 * header `*` drawn with no cursor hold behind it, which is the one divergence
 * `required` exists to rule out.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, ListChecks, Calculator, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGrid } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RecordPicker } from "@/components/masters/record-picker";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { RowActions } from "@/components/ui/row-actions";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { sectionValidity } from "@/lib/screens/validity";
import { fmtDate, fmtNumber } from "@/lib/format";
import { bomStatusHint, bomStatusText, bomStatusTone } from "@/lib/orders/bom-status";
import {
  FABRIC_BASIS_LABELS,
  FABRIC_BASES,
  fabricBasisOf,
  fabricRequirementRows,
  isRefusal,
  type FabricBasis,
} from "@/lib/orders/fabric-bom/requirement";
import type { OrderProductionInput } from "@/lib/orders/material-bom/requirement";
import { FABRIC_TYPE_OPTIONS, type FabricBom } from "@/lib/orders/fabric-bom/types";
import type {
  BomTaskRow,
  FabricBomFormData,
} from "@/lib/orders/fabric-bom/service";
import {
  createFabricBom,
  deleteFabricBom,
  loadOrderFabricSeed,
  loadOrderProduction,
  updateFabricBom,
} from "@/lib/orders/fabric-bom/actions";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/** One editable line. `key` is React's, never the database id — `ChildGrid`
 *  requires it and a new row has no id to offer. */
type LineRow = {
  key: string;
  id: string | null;
  style_ref_no: string;
  combo: string;
  structure_id: string | null;
  component_id: string | null;
  item_id: string | null;
  fabric_type: string;
  color_name: string;
  consumption: string;
  consumption_uom_id: string | null;
  wastage_pct: string;
  requirement_basis: string;
  dia: string;
  required_by: string;
  rate: string;
  notes: string;
};

type Form = { garment_order_id: string | null; bom_date: string; remark: string };

const today = () => new Date().toISOString().slice(0, 10);
const BLANK = (): Form => ({ garment_order_id: null, bom_date: today(), remark: "" });

const blankLine = (key: string): LineRow => ({
  key,
  id: null,
  style_ref_no: "",
  combo: "",
  structure_id: null,
  component_id: null,
  item_id: null,
  fabric_type: "",
  color_name: "",
  consumption: "",
  consumption_uom_id: null,
  wastage_pct: "",
  // DEFAULTED TO COLOUR, and this is the one default in the file. Fabric is dyed
  // per colourway, so colour-wise is not a guess about what the operator meant —
  // it is the only basis that is right for the ordinary case, and the engine
  // still refuses a line that has been cleared back to blank.
  requirement_basis: "colour",
  dia: "",
  required_by: "",
  rate: "",
  notes: "",
});

const numOrNull = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function FabricBomScreen({
  tasks,
  boms,
  data,
  perms,
}: {
  tasks: BomTaskRow[];
  boms: FabricBom[];
  data: FabricBomFormData;
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(BLANK);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");

  /**
   * THE SCREEN REGISTERS ITS OWN UNSAVED GUARD.
   *
   * `MasterFullScreen` calls `useModalGuard(open)` on an overlay mount, and
   * `confirmDiscard()` deliberately does not read that one — an open overlay is
   * not the same thing as edited data. Keyed on `dirty`, never on
   * `mode === "edit"`: that would pin the silent PWA auto-update off for as long
   * as the operator sits on the screen.
   */
  useUnsavedGuard(dirty || isPending);

  const shellRef = useRef<MasterFullScreenHandle>(null);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const mut = (fn: (xs: LineRow[]) => LineRow[]) => {
    setLines(fn);
    setDirty(true);
  };
  const setCell = (key: string, patch: Partial<LineRow>) =>
    mut((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  // ---- the picked order ----------------------------------------------------

  /**
   * THE ANSWER IS STORED WITH THE QUESTION IT ANSWERS.
   *
   * One state cell holding `{ forOrder, order, error }`, not three cells the
   * effect has to keep in step. Two things fall out of that, and the second is
   * why it is written this way rather than the obvious way:
   *
   *  - **No stale flash.** `order` is only read when `forOrder` matches the
   *    order currently picked, so switching orders shows "Reading the order…"
   *    rather than the previous order's quantities until the reply lands. With
   *    three cells that gap is a real render, and the Calculated Quantities
   *    section would spend it multiplying this order's lines by that order's
   *    target.
   *  - **The effect sets state only in its CALLBACK.** Clearing three cells
   *    synchronously in the effect body is what `react-hooks/set-state-in-effect`
   *    is about, and the rule is right here — the clear was a second render that
   *    existed only to undo the first.
   */
  const [loaded, setLoaded] = useState<{
    forOrder: string;
    order: OrderProductionInput | null;
    error: string | null;
  } | null>(null);

  const current = loaded && loaded.forOrder === form.garment_order_id ? loaded : null;
  const order = current?.order ?? null;
  const orderErr = current?.error ?? null;
  const orderLoading = !!form.garment_order_id && !current;

  /**
   * One round trip per ORDER, not per keystroke.
   *
   * The requirement recalculates as the operator types, but only the LINE moves
   * — the order's approval quantities do not — so this fires on the order id
   * and nothing else. `cancelled` guards the operator picking a second order
   * before the first answers, which would otherwise leave the slower reply
   * overwriting the faster one.
   */
  useEffect(() => {
    const id = form.garment_order_id;
    if (!id) return;
    let cancelled = false;
    loadOrderProduction(id).then((res) => {
      if (cancelled) return;
      setLoaded(
        res.ok
          ? { forOrder: id, order: res.order, error: null }
          : { forOrder: id, order: null, error: res.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [form.garment_order_id]);

  const pickedOrder = useMemo(
    () => data.orders.find((o) => o.id === form.garment_order_id) ?? null,
    [data.orders, form.garment_order_id],
  );

  // ---- opening and closing -------------------------------------------------

  function openNew(garmentOrderId: string | null) {
    setEditId(null);
    setForm({ ...BLANK(), garment_order_id: garmentOrderId });
    // ONE BLANK LINE, never the empty state. Entering the first line must cost
    // no click — and an empty grid has no field for Tab to land on, so its only
    // affordance would be a button Tab never visits (AGENTS.md, enterNestedGrid).
    setLines([blankLine(newKey())]);
    setDirty(false);
    setMode("edit");
  }

  function openExisting(bomId: string) {
    const b = boms.find((x) => x.id === bomId);
    if (!b) return;
    setEditId(b.id);
    setForm({
      garment_order_id: b.garment_order_id,
      bom_date: b.bom_date,
      remark: b.remark ?? "",
    });
    setLines(
      (b.lines ?? []).map((l) => ({
        key: newKey(),
        id: l.id,
        style_ref_no: l.style_ref_no ?? "",
        combo: l.combo ?? "",
        structure_id: l.structure_id,
        component_id: l.component_id,
        item_id: l.item_id,
        fabric_type: l.fabric_type ?? "",
        color_name: l.color_name ?? "",
        consumption: l.consumption == null ? "" : String(l.consumption),
        consumption_uom_id: l.consumption_uom_id,
        wastage_pct: l.wastage_pct == null ? "" : String(l.wastage_pct),
        requirement_basis: l.requirement_basis ?? "colour",
        dia: l.dia == null ? "" : String(l.dia),
        required_by: l.required_by ?? "",
        rate: l.rate == null ? "" : String(l.rate),
        notes: l.notes ?? "",
      })),
    );
    if ((b.lines ?? []).length === 0) setLines([blankLine(newKey())]);
    setDirty(false);
    setMode("edit");
  }

  function openTask(t: BomTaskRow) {
    if (t.bom_id) openExisting(t.bom_id);
    else openNew(t.id);
  }

  // ---- seeding from the order's own combo tree -----------------------------

  /**
   * ADDS what the order names and the grid does not already have. It NEVER
   * removes or overwrites a line.
   *
   * The first cut replaced the grid wholesale behind a `window.confirm`, and
   * both halves of that were wrong. Wholesale replacement throws away typed
   * consumptions to re-add rows the operator had already accepted — and the
   * button is most useful on a HALF-DONE BOM, where an amended order has grown a
   * colourway. `window.confirm` is a browser modal: it is not the app's
   * two-step confirm (LAYOUT.md 6a), it cannot be styled or dismissed with
   * Escape the way every other surface here can, and a destructive default
   * needing a guard is usually a sign the default is wrong. Making the action
   * additive removes the need for a guard rather than dressing one up.
   *
   * "Already have" is the four keys that ADDRESS a fabric — style, colourway,
   * structure, panel — which is the same tuple `order_fabric_bom_lines` uses to
   * point at the order's tree (0426). Two lines differing only in fabric or
   * consumption are two deliberate lines and both stay.
   */
  function seedFromOrder() {
    const id = form.garment_order_id;
    if (!id) return;
    start(async () => {
      const res = await loadOrderFabricSeed(id);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      const addressOf = (l: {
        style_ref_no: string | null;
        combo: string | null;
        structure_id: string | null;
        component_id: string | null;
      }) =>
        [l.style_ref_no ?? "", l.combo ?? "", l.structure_id ?? "", l.component_id ?? ""]
          .map((v) => v.trim().toUpperCase())
          .join(" ");

      const held = new Set(lines.map(addressOf));
      const fresh = res.rows.filter((r) => !held.has(addressOf(r)));

      if (fresh.length === 0) {
        // EMPTY-AND-EXPLAIN. A button that does nothing and says nothing reads
        // as broken; "already here" is the answer, and it is a good one.
        success("Every fabric on this order is already on the BOM");
        return;
      }

      mut((xs) => [
        // Drop the untouched scaffolding row the grid seeds, so a fresh BOM does
        // not begin with a blank line above the seeded ones.
        ...xs.filter((l) => l.item_id || l.consumption.trim() || l.structure_id),
        ...fresh.map((r) => ({
          ...blankLine(newKey()),
          style_ref_no: r.style_ref_no ?? "",
          combo: r.combo ?? "",
          structure_id: r.structure_id,
          component_id: r.component_id,
          fabric_type: r.fabric_type ?? "",
          color_name: r.color_name ?? "",
        })),
      ]);
      success(`${fresh.length} fabric line${fresh.length === 1 ? "" : "s"} added from the order`);
    });
  }

  // ---- the line grid -------------------------------------------------------

  const styleOptions = pickedOrder?.styles ?? [];
  const comboOptions = pickedOrder?.combos ?? [];

  const lineColumns: ChildGridColumn<LineRow>[] = [
    {
      header: "Style",
      width: "10rem",
      cell: (r) => (
        <Select
          className="h-8"
          value={r.style_ref_no}
          onChange={(e) => setCell(r.key, { style_ref_no: e.target.value })}
        >
          {/* BLANK MEANS EVERY STYLE, and the label says so rather than showing
              a dash the operator has to interpret. */}
          <option value="">All styles</option>
          {styleOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Combo",
      width: "10rem",
      cell: (r) => (
        <Select
          className="h-8"
          value={r.combo}
          onChange={(e) => setCell(r.key, { combo: e.target.value })}
        >
          <option value="">All colourways</option>
          {comboOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Structure",
      cell: (r) => (
        <RecordPicker
          label="Structure"
          compact
          items={data.structures}
          value={r.structure_id}
          onChange={(id) => setCell(r.key, { structure_id: id })}
        />
      ),
    },
    {
      header: "Component",
      cell: (r) => (
        <RecordPicker
          label="Component"
          compact
          items={data.components}
          value={r.component_id}
          onChange={(id) => setCell(r.key, { component_id: id })}
        />
      ),
    },
    {
      header: "Fabric",
      required: true,
      cell: (r) => (
        <RecordPicker
          label="Fabric"
          compact
          required
          items={data.fabrics}
          value={r.item_id}
          onChange={(id) => setCell(r.key, { item_id: id })}
        />
      ),
    },
    {
      header: "Type",
      width: "9rem",
      cell: (r) => (
        <Select
          className="h-8"
          value={r.fabric_type}
          onChange={(e) => setCell(r.key, { fabric_type: e.target.value })}
        >
          <option value=""></option>
          {FABRIC_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Fabric colour",
      width: "9rem",
      cell: (r) => (
        <Input
          className="h-8"
          uppercase
          value={r.color_name}
          onChange={(e) => setCell(r.key, { color_name: e.target.value })}
        />
      ),
    },
    {
      header: "Consumption",
      align: "right",
      width: "8rem",
      required: true,
      cell: (r) => (
        <Input
          className="h-8 text-right"
          required
          inputMode="decimal"
          value={r.consumption}
          onChange={(e) => setCell(r.key, { consumption: e.target.value })}
        />
      ),
    },
    {
      header: "Unit",
      width: "8rem",
      required: true,
      cell: (r) => (
        <RecordPicker
          label="Unit"
          compact
          required
          items={data.uoms}
          value={r.consumption_uom_id}
          onChange={(id) => setCell(r.key, { consumption_uom_id: id })}
        />
      ),
    },
    {
      header: "Wastage %",
      align: "right",
      width: "7rem",
      cell: (r) => (
        <Input
          className="h-8 text-right"
          inputMode="decimal"
          value={r.wastage_pct}
          onChange={(e) => setCell(r.key, { wastage_pct: e.target.value })}
        />
      ),
    },
    {
      header: "Split",
      width: "11rem",
      required: true,
      cell: (r) => (
        <Select
          className="h-8"
          required
          value={r.requirement_basis}
          onChange={(e) => setCell(r.key, { requirement_basis: e.target.value })}
        >
          <option value=""></option>
          {FABRIC_BASES.map((b) => (
            <option key={b} value={b}>
              {FABRIC_BASIS_LABELS[b]}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Dia",
      align: "right",
      width: "6rem",
      cell: (r) => (
        <Input
          className="h-8 text-right"
          inputMode="decimal"
          value={r.dia}
          onChange={(e) => setCell(r.key, { dia: e.target.value })}
        />
      ),
    },
    {
      header: "Required by",
      width: "9rem",
      cell: (r) => (
        <Input
          className="h-8"
          type="date"
          value={r.required_by}
          onChange={(e) => setCell(r.key, { required_by: e.target.value })}
        />
      ),
    },
    {
      header: "Rate",
      align: "right",
      width: "7rem",
      cell: (r) => (
        <Input
          className="h-8 text-right"
          inputMode="decimal"
          value={r.rate}
          onChange={(e) => setCell(r.key, { rate: e.target.value })}
        />
      ),
    },
  ];

  // ---- the requirement, recomputed as the operator types -------------------

  type PreviewRow = {
    key: string;
    fabric: string;
    slice: string;
    qty: number | null;
    refusal: string | null;
    unit: string;
  };

  /**
   * WHAT THE SERVER WILL STORE, computed from the SAME functions the action
   * calls.
   *
   * Not a second implementation and not an approximation: `requirement.ts` is
   * client-safe precisely so the figure the operator approves and the figure a
   * purchase order is later checked against cannot be derived twice.
   */
  const preview: PreviewRow[] = useMemo(() => {
    if (!order) return [];
    const out: PreviewRow[] = [];
    for (const l of lines) {
      if (!l.item_id) continue;
      const fabric = data.fabrics.find((f) => f.id === l.item_id)?.name ?? "—";
      const uom = data.uoms.find((u) => u.id === l.consumption_uom_id);
      const unit = uom?.code ?? uom?.name ?? "";

      const basis = fabricBasisOf(l.requirement_basis);
      if (isRefusal(basis)) {
        out.push({ key: `${l.key}-b`, fabric, slice: "—", qty: null, refusal: basis.refused, unit });
        continue;
      }
      const rows = fabricRequirementRows(
        basis as FabricBasis,
        {
          style_ref_no: l.style_ref_no.trim() || null,
          combo: l.combo.trim() || null,
        },
        {
          consumption: numOrNull(l.consumption),
          wastage_pct: numOrNull(l.wastage_pct),
          decimals: uom?.decimal_places_allowed ?? null,
        },
        order,
      );
      if (isRefusal(rows)) {
        out.push({ key: `${l.key}-r`, fabric, slice: "—", qty: null, refusal: rows.refused, unit });
        continue;
      }
      for (const r of rows) {
        out.push({ key: `${l.key}-${r.key}`, fabric, slice: r.label, qty: r.required, refusal: null, unit });
      }
    }
    return out;
  }, [order, lines, data.fabrics, data.uoms]);

  const previewColumns: ChildGridColumn<PreviewRow>[] = [
    { header: "Fabric", cell: (r) => <Truncated>{r.fabric}</Truncated> },
    { header: "Slice", width: "12rem", cell: (r) => <Truncated>{r.slice}</Truncated> },
    {
      header: "Required",
      align: "right",
      width: "10rem",
      cell: (r) =>
        // A REFUSAL IS PRINTED, NEVER A ZERO. "Nothing needed" and "the operator
        // has not answered yet" produce the same empty cell otherwise, and only
        // one of those is something anybody can act on.
        r.refusal ? (
          <span className="text-xs text-danger">{r.refusal}</span>
        ) : (
          <span className="tabular-nums">
            {fmtNumber(r.qty ?? 0)} {r.unit}
          </span>
        ),
    },
  ];

  // ---- validity ------------------------------------------------------------

  const filledLines = lines.filter((l) => l.item_id || l.consumption.trim());

  /**
   * `canSave` is DERIVED. The hand-assembled form is a list a screen can forget
   * to extend, and two shipped screens gate Save on an error two sections away
   * with nothing on screen to say so.
   *
   * The line problems are `extra` rather than `fields` because they are per-ROW:
   * `fields` addresses one control by id, and there is no single id for "the
   * consumption cell of whichever line is blank". The GRID's own `required`
   * holds the cursor there; this is what makes Save explain itself.
   */
  const validity = sectionValidity({
    sections: [{ key: "bom" }, { key: "lines" }, { key: "qty" }],
    values: form,
    fields: [
      {
        section: "bom",
        id: "fb-order",
        label: "Garment order",
        required: true,
        empty: (f) => !f.garment_order_id,
      },
      { section: "bom", id: "fb-date", label: "Date", required: true, empty: (f) => !f.bom_date },
    ],
    extra: [
      ...(filledLines.length === 0
        ? [
            {
              section: "lines",
              label: "Fabric lines",
              message: "Add at least one fabric line.",
              kind: "custom" as const,
            },
          ]
        : []),
      ...(filledLines.some((l) => !l.item_id)
        ? [
            {
              section: "lines",
              label: "Fabric",
              message: "Every line needs a fabric.",
              kind: "custom" as const,
            },
          ]
        : []),
      ...(filledLines.some((l) => l.item_id && !numOrNull(l.consumption))
        ? [
            {
              section: "lines",
              label: "Consumption",
              // The ENGINE'S sentence, word for word. Two spellings of one
              // refusal is how an operator comes to believe there are two
              // different problems.
              message: "Enter the fabric consumption per garment",
              kind: "custom" as const,
            },
          ]
        : []),
      ...(filledLines.some((l) => l.item_id && !l.consumption_uom_id)
        ? [
            {
              section: "lines",
              label: "Unit",
              message: "Choose the unit this consumption is in",
              kind: "custom" as const,
            },
          ]
        : []),
      ...(filledLines.some((l) => l.item_id && isRefusal(fabricBasisOf(l.requirement_basis)))
        ? [
            {
              section: "lines",
              label: "Split",
              message: "Choose how this fabric splits",
              kind: "custom" as const,
            },
          ]
        : []),
    ],
  });

  const revealFirstProblem = () => {
    const p = validity.first;
    if (!p) return;
    toastError(p.message);
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };

  // ---- sections ------------------------------------------------------------

  const sections: FullScreenSection[] = [
    {
      key: "bom",
      label: "Fabric BOM",
      icon: Layers,
      // NO `problems`. Pass `done` — the operator asked for the quiet dot rather
      // than a red count, and `footer.onBlockedSave` is what replaces it.
      done: !!form.garment_order_id,
      content: (
        <SectionBody title="Fabric BOM">
          <FieldGrid>
            <Field label="Garment order" required size="sm" htmlFor="fb-order">
              <RecordPicker
                id="fb-order"
                label="Garment order"
                compact
                items={data.orders}
                value={form.garment_order_id}
                // LOCKED ONCE SAVED. Every requirement row was computed against
                // this order; re-pointing the document at another one would
                // leave figures behind that describe quantities from a different
                // order, and nothing on screen would say so.
                disabled={!!editId}
                onChange={(id) => set({ garment_order_id: id })}
              />
            </Field>
            <Field label="Date" required size="sm" htmlFor="fb-date">
              <Input
                id="fb-date"
                type="date"
                value={form.bom_date}
                onChange={(e) => set({ bom_date: e.target.value })}
              />
            </Field>
            <Field label="Customer" size="sm" htmlFor="fb-cust">
              {/* READ-ONLY, from the order. A readOnly field never holds the
                  cursor (AGENTS.md, Mandatory fields), which is right: its
                  source is the order picker above. */}
              <Input id="fb-cust" readOnly value={pickedOrder?.customer_name ?? ""} />
            </Field>
            <Field label="Delivery" size="sm" htmlFor="fb-del">
              <Input
                id="fb-del"
                readOnly
                value={pickedOrder?.delivery_date ? fmtDate(pickedOrder.delivery_date) : ""}
              />
            </Field>
            <Field label="Remark" size="full" htmlFor="fb-remark">
              <Textarea
                id="fb-remark"
                rows={2}
                value={form.remark}
                onChange={(e) => set({ remark: e.target.value })}
              />
            </Field>
          </FieldGrid>

          <ProductionStrip
            picked={!!form.garment_order_id}
            loading={orderLoading}
            error={orderErr}
            order={order}
          />
        </SectionBody>
      ),
    },
    {
      key: "lines",
      label: "Fabric Lines",
      icon: ListChecks,
      done: filledLines.length > 0,
      content: (
        <SectionBody title="Fabric Lines">
          <div className="mb-3 flex items-center justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={seedFromOrder}
              disabled={!form.garment_order_id || isPending}
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              Seed from order
            </Button>
          </div>
          <ChildGrid<LineRow>
            columns={lineColumns}
            rows={lines}
            seedRow
            forceCards
            /* Fourteen columns. See the file header: a table here scrolls
               sideways, and a sideways-scrolling grid loses the first cell while
               the operator reaches the last. */
            renderMobileRow={(row) => (
              <FieldGrid>
                {lineColumns.map((c, ci) => (
                  <Field key={ci} label={c.header} required={c.required} size="sm">
                    {c.cell(row, ci)}
                  </Field>
                ))}
              </FieldGrid>
            )}
            onAdd={() => mut((xs) => [...xs, blankLine(newKey())])}
            onRemove={(r) => mut((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add fabric"
          />
        </SectionBody>
      ),
    },
    {
      key: "qty",
      label: "Calculated Quantities",
      icon: Calculator,
      done: preview.some((p) => p.qty != null),
      content: (
        <SectionBody title="Calculated Quantities">
          {!form.garment_order_id ? (
            <p className="text-sm text-muted-foreground">Pick a garment order first.</p>
          ) : orderErr ? (
            <p className="text-sm text-danger">{orderErr}</p>
          ) : (
            <ChildGrid<PreviewRow>
              columns={previewColumns}
              rows={preview}
              hideAdd
              lockExisting
              onAdd={() => false}
              onRemove={() => {}}
            />
          )}
        </SectionBody>
      ),
    },
  ];

  // ---- saving --------------------------------------------------------------

  function submit(asDraft: boolean) {
    if (!form.garment_order_id) return;
    const payload = {
      garment_order_id: form.garment_order_id,
      bom_date: form.bom_date,
      is_draft: asDraft,
      remark: form.remark || null,
      lines: lines.map((l, i) => ({
        sno: i + 1,
        style_ref_no: l.style_ref_no || null,
        combo: l.combo || null,
        structure_id: l.structure_id,
        component_id: l.component_id,
        item_id: l.item_id,
        fabric_type: l.fabric_type || null,
        color_name: l.color_name || null,
        consumption: numOrNull(l.consumption),
        consumption_uom_id: l.consumption_uom_id,
        wastage_pct: numOrNull(l.wastage_pct) ?? 0,
        requirement_basis: (l.requirement_basis || null) as FabricBasis | null,
        dia: numOrNull(l.dia),
        required_by: l.required_by || null,
        rate: numOrNull(l.rate),
        notes: l.notes || null,
      })),
    };
    start(async () => {
      const res = editId
        ? await updateFabricBom(editId, payload)
        : await createFabricBom(payload);
      if (res.ok) {
        success(editId ? "Fabric BOM updated" : "Fabric BOM created");
        setDirty(false);
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function remove(bomId: string) {
    start(async () => {
      const res = await deleteFabricBom(bomId);
      if (res.ok) {
        success("Fabric BOM deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---- the queue -----------------------------------------------------------

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) =>
      [t.sc_no, t.order_code, t.po_no, t.customer_name]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  }, [tasks, search]);

  const columns: Column<BomTaskRow>[] = [
    {
      header: "SC No",
      cell: (t) => (
        <button
          type="button"
          className="font-mono text-xs font-medium text-primary hover:underline"
          onClick={() => openTask(t)}
        >
          {t.sc_no ?? t.order_code ?? "—"}
        </button>
      ),
    },
    { header: "Buyer PO", cell: (t) => <Truncated>{t.po_no ?? "—"}</Truncated> },
    { header: "Customer", cell: (t) => <Truncated>{t.customer_name ?? "—"}</Truncated> },
    {
      header: "Delivery",
      cell: (t) => <span className="tabular-nums text-sm">{t.delivery_date ? fmtDate(t.delivery_date) : "—"}</span>,
    },
    {
      header: "Production",
      align: "right",
      cell: (t) =>
        t.production_refusal ? (
          <span className="text-xs text-danger">{t.production_refusal}</span>
        ) : (
          <span className="tabular-nums text-sm">{fmtNumber(t.production_qty ?? 0)}</span>
        ),
    },
    { header: "Lines", align: "right", cell: (t) => <span className="tabular-nums text-sm">{t.bom_line_count}</span> },
    {
      header: "Status",
      cell: (t) => (
        <span title={bomStatusHint(t.status, t.production_qty)}>
          <StatusPill tone={bomStatusTone(t.status)}>{bomStatusText(t.status)}</StatusPill>
        </span>
      ),
    },
    // The trailing cluster comes from `rowActionsColumn`, never hand-declared:
    // it fixes the header, alignment and width in one place, and it is what
    // brings the app's two-step delete confirm (LAYOUT.md 6a) — the reason no
    // screen here reaches for `window.confirm`.
    rowActionsColumn<BomTaskRow>((t) => (
      <RowActions
        label={t.sc_no ?? t.order_code}
        onEdit={() => openTask(t)}
        canEdit={perms.canEdit}
        // A queue row with no BOM has no document to delete — that is the
        // "Pending" case, and it is the whole reason the queue lists ORDERS.
        canDelete={perms.canDelete && !!t.bom_id}
        onDelete={t.bom_id ? () => remove(t.bom_id as string) : undefined}
        deleteLabel="Delete BOM"
        isPending={isPending}
      />
    )),
  ];

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="Fabric BOM"
          description="Step 5 — fabric per component and colour, with the net requirement each order implies."
        />

        {/* EVERY CONTROL IN THIS BAND IS `md` (h-9). The row's fixed element is
            the search <Input>, and an <Input> is h-9 (AGENTS.md, The header row). */}
        <div className="flex flex-wrap items-center gap-2">
          {/* caps-input: exempt -- a search QUERY is not a stored value. */}
          <Input
            uppercase={false}
            className="w-64"
            placeholder="Search SC No, PO or customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex flex-1 items-center justify-end gap-2">
            {perms.canCreate && (
              <Button size="md" onClick={() => openNew(null)}>
                + New Fabric BOM
              </Button>
            )}
          </div>
        </div>

        <DataTable
          columns={withCreatedColumns(columns, filtered)}
          rows={filtered}
          getKey={(t) => t.id}
          empty="No confirmed garment orders yet. A fabric BOM is planned against an order."
        />
      </div>

      <MasterFullScreen
        ref={shellRef}
        mount="overlay"
        open={mode === "edit"}
        onClose={() => setMode("list")}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">fabric BOM</span>
          </>
        }
        header={{
          initials: "FB",
          title: pickedOrder?.code ?? (editId ? "Fabric BOM" : "New fabric BOM"),
          badges: dirty ? (
            <span className="text-[11px] font-medium text-warning">● Unsaved</span>
          ) : null,
          meta: (
            <>
              {pickedOrder?.customer_name && <span>{pickedOrder.customer_name}</span>}
              {form.bom_date && <span>· {fmtDate(form.bom_date)}</span>}
              <span>· {filledLines.length} fabric {filledLines.length === 1 ? "line" : "lines"}</span>
            </>
          ),
        }}
        sections={sections}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New fabric BOM",
          onCancel: () => setMode("list"),
          onSave: () => submit(false),
          saveLabel: "Save fabric BOM",
          canSave: validity.canSave,
          onBlockedSave: revealFirstProblem,
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          isPending,
        }}
      />
    </>
  );
}

/**
 * The order's production quantity, and where it came from.
 *
 * A REFUSAL IS SHOWN, NOT SWALLOWED. "This order has no Approval Qty rows" and
 * "the requirement is zero" produce the same empty table, and only the first is
 * something an operator can act on — the failure AGENTS.md names under Cascading
 * filters, where an empty report reads as a real result.
 */
function ProductionStrip({
  loading,
  error,
  order,
  picked,
}: {
  loading: boolean;
  error: string | null;
  order: OrderProductionInput | null;
  picked: boolean;
}) {
  if (!picked) return null;

  let body: React.ReactNode;
  if (loading) body = <span className="text-muted-foreground">Reading the order…</span>;
  else if (error) body = <span className="text-danger">{error}</span>;
  else if (!order) body = <span className="text-muted-foreground">—</span>;
  else {
    const total = order.approvals.reduce((a, r) => a + (Number(r.qty) || 0), 0);
    body = (
      <span className="text-muted-foreground">
        {order.combos.length} {order.combos.length === 1 ? "colourway" : "colourways"} · PO{" "}
        <span className="font-medium tabular-nums text-foreground">{fmtNumber(total)}</span> pcs ·
        excess {order.excessPct}%
        {order.rejectionRuleChosen ? " · rejection rule applied" : " · no rejection rule"}
      </span>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs">
      <span className="mr-2 font-medium text-foreground">Planning against:</span>
      {body}
    </div>
  );
}
