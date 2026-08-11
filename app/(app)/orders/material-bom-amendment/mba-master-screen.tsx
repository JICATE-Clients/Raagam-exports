"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Boxes, Calculator, ClipboardList, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtNumber } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { sectionValidity } from "@/lib/screens/validity";
import { CustomerPicker } from "@/components/masters/customer-picker";
import { RecordPicker } from "@/components/masters/record-picker";
import { NominatedVendorPicker } from "@/components/masters/nominated-vendor-picker";
import { nominatedVendorOptions } from "@/lib/masters/vendor-nominations";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import {
  createMaterialBomAmendment,
  updateMaterialBomAmendment,
  deleteMaterialBomAmendment,
} from "@/lib/orders/material-bom-amendment/actions";
import {
  MATERIAL_TYPE_OPTIONS,
  SUPPLY_TYPE_OPTIONS,
  mbaStatusTone,
  mbaStatusText,
  type CalculatedQtyRow,
  type MaterialBomAmendment,
} from "@/lib/orders/material-bom-amendment/types";
import type { MbaFormData } from "@/lib/orders/material-bom-amendment/service";
import { describeConversion, isUsableConversion, toPurchaseQty } from "@/lib/uom/convert";
import { withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

interface Props {
  rows: MaterialBomAmendment[];
  data: MbaFormData;
  perms: Perms;
  /** masters:create/edit — gates inline Add/Modify inside config-list pickers. */
  masterPerms: { canCreate: boolean; canEdit: boolean };
}

type ItemRow = {
  key: string;
  category_id: string | null;
  type: string;
  item_id: string | null;
  attribute_id: string | null;
  supply_type: string;
  vendor_id: string | null;
  purchase_uom_id: string | null;
  consumption_uom_id: string | null;
  alternate_uom_id: string | null;
  /** The pack size this line buys (0348) — see MbaItem.uom_conversion_id. */
  uom_conversion_id: string | null;
  combination: string;
  moq: string;
  quantity_nos: string;
};
type ProcRow = { key: string; item_id: string | null };

type HeaderForm = {
  sales_order_id: string | null;
  customer_id: string | null;
  amend_date: string;
  remarks: string;
};

const BLANK: HeaderForm = {
  sales_order_id: null,
  customer_id: null,
  amend_date: "",
  remarks: "",
};

const blankItem = (key: string): ItemRow => ({
  key,
  category_id: null,
  type: "",
  item_id: null,
  attribute_id: null,
  supply_type: "",
  vendor_id: null,
  purchase_uom_id: null,
  consumption_uom_id: null,
  alternate_uom_id: null,
  uom_conversion_id: null,
  combination: "",
  moq: "",
  quantity_nos: "",
});

const today = () => new Date().toISOString().slice(0, 10);

export function MbaMasterScreen({ rows, data, perms, masterPerms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [amendmentNo, setAmendmentNo] = useState<number | null>(null);
  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [procs, setProcs] = useState<ProcRow[]>([]);

  /**
   * Has the operator changed anything since this amendment opened.
   *
   * A real flag rather than "does the editor happen to be open", which is what
   * this screen used to hand `useUnsavedGuard` — always true while editing, so
   * the silent PWA auto-update was pinned off for as long as the operator sat on
   * the screen. A page-mounted `MasterFullScreen` gates the reload on THIS, so
   * it has to mean unsaved work and nothing else. Seeded records (openAdd /
   * openEdit) clear it: loading a row is not an edit of it.
   */
  const [dirty, setDirty] = useState(false);

  /** Lets a blocked Save switch section and land on the offending field. The
   *  shell keeps `section` in its own state; this handle is the only way in. */
  const shellRef = useRef<MasterFullScreenHandle>(null);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  /**
   * UNSAVED WORK, DECLARED HERE BECAUSE THE OVERLAY CANNOT DECLARE IT.
   *
   * `MasterFullScreen` calls `useModalGuard(open)` on an overlay mount, and
   * `confirmDiscard()` deliberately does NOT read that one — `reload-guard.ts`:
   * "an open overlay is not the same thing as edited data, and confirming on
   * every Escape would train the operator to dismiss the prompt without reading
   * it." So Escape asks before discarding only if the SCREEN registers real
   * dirtiness, which is why every overlay master (courier-delivery, customer,
   * applicant) carries this exact line.
   *
   * `dirty`, not `mode === "edit"`: the old version was keyed on the editor
   * merely being open, which pinned the silent PWA auto-update off for as long
   * as the operator sat on the screen and made every Escape ask.
   *
   * Ctrl+S is NOT registered here — the shell owns it (`fireSave`), and the
   * hand-rolled copy this screen used to carry had its own `canSave` test, which
   * is the split between a blocked button and a blocked shortcut that
   * `onBlockedSave` exists to close.
   */
  useUnsavedGuard(dirty || isPending);

  const materialCategories = useMemo(
    () => data.lookups.filter((l) => l.kind === "material_category"),
    [data.lookups],
  );
  const materialAttributes = useMemo(
    () => data.lookups.filter((l) => l.kind === "material_attribute"),
    [data.lookups],
  );

  const customerName = useMemo(
    () => data.customers.find((c) => c.id === form.customer_id)?.name ?? null,
    [data.customers, form.customer_id],
  );

  /**
   * Everything `NominatedVendorPicker` needs except the row's own supply type
   * and current value, which differ per line.
   *
   * The rule itself lives in `lib/masters/vendor-nominations.ts` — shared with
   * Order Trims and Accessory BOM, because a nomination has to mean the same
   * thing on all three. MBA's Supply Type list happens to have no "Recommended",
   * which costs nothing: the shared rule filters on `list_kind`, it does not
   * assume the recommended list is absent.
   */
  const vendorRule = {
    customerId: form.customer_id,
    customerName,
    vendors: data.vendors,
    nominations: data.nominations,
  };

  const orderItems = useMemo(
    () =>
      data.orders.map((o) => ({
        id: o.id,
        code: o.order_number,
        name: o.buyer_name ?? "—",
      })),
    [data.orders],
  );
  const selectedOrder = useMemo(
    () => data.orders.find((o) => o.id === form.sales_order_id) ?? null,
    [data.orders, form.sales_order_id],
  );

  // Every mutation marks the record dirty in the same breath as changing it, so
  // the flag cannot drift from the state it describes.
  const set = (patch: Partial<HeaderForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const mutItems = (fn: (xs: ItemRow[]) => ItemRow[]) => {
    setItems(fn);
    setDirty(true);
  };
  const mutProcs = (fn: (xs: ProcRow[]) => ProcRow[]) => {
    setProcs(fn);
    setDirty(true);
  };
  const updItem = (key: string, patch: Partial<ItemRow>) =>
    mutItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const updProc = (key: string, patch: Partial<ProcRow>) =>
    mutProcs((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function openAdd() {
    setEditId(null);
    setAmendmentNo(null);
    setForm({ ...BLANK, amend_date: today() });
    setItems([blankItem(newKey())]);
    setProcs([{ key: newKey(), item_id: null }]);
    setDirty(false);
    setMode("edit");
  }

  function openEdit(r: MaterialBomAmendment) {
    setEditId(r.id);
    setAmendmentNo(r.amendment_no);
    setForm({
      sales_order_id: r.sales_order_id,
      customer_id: r.customer_id,
      amend_date: r.amend_date ?? today(),
      remarks: r.remarks ?? "",
    });
    setItems(
      r.items.map((c) => ({
        key: newKey(),
        category_id: c.category_id,
        type: c.type ?? "",
        item_id: c.item_id,
        attribute_id: c.attribute_id,
        supply_type: c.supply_type ?? "",
        vendor_id: c.vendor_id,
        purchase_uom_id: c.purchase_uom_id,
        consumption_uom_id: c.consumption_uom_id,
        alternate_uom_id: c.alternate_uom_id,
        uom_conversion_id: c.uom_conversion_id,
        combination: c.combination ?? "",
        moq: c.moq != null ? String(c.moq) : "",
        quantity_nos: c.quantity_nos != null ? String(c.quantity_nos) : "",
      })),
    );
    setProcs(r.processes.map((p) => ({ key: newKey(), item_id: p.item_id })));
    setDirty(false);
    setMode("edit");
  }

  function submit(asDraft: boolean) {
    const payload = {
      sales_order_id: form.sales_order_id,
      customer_id: form.customer_id,
      amend_date: form.amend_date,
      remarks: form.remarks || null,
      is_draft: asDraft,
      items: items.map((c) => ({
        sno: 0,
        category_id: c.category_id,
        type: c.type || null,
        item_id: c.item_id,
        attribute_id: c.attribute_id,
        supply_type: c.supply_type || null,
        vendor_id: c.vendor_id,
        purchase_uom_id: c.purchase_uom_id,
        consumption_uom_id: c.consumption_uom_id,
        alternate_uom_id: c.alternate_uom_id,
        uom_conversion_id: c.uom_conversion_id,
        combination: c.combination || null,
        moq: c.moq ? Number(c.moq) : null,
        quantity_nos: c.quantity_nos ? Number(c.quantity_nos) : null,
      })),
      processes: procs.map((p) => ({ sno: 0, item_id: p.item_id })),
    };
    start(async () => {
      const res = editId
        ? await updateMaterialBomAmendment(editId, payload)
        : await createMaterialBomAmendment(payload);
      if (res.ok) {
        success(editId ? "Amendment updated" : "Amendment created");
        setDirty(false);
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: MaterialBomAmendment) {
    /* No confirm() — <RowActions> asks in the row (LAYOUT.md §6a). */
    start(async () => {
      const res = await deleteMaterialBomAmendment(r.id);
      if (res.ok) {
        success("Amendment deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---------------- THE LIST ----------------
  // Rendered unconditionally now, with the editor as an OVERLAY above it —
  // `MasterFullScreen` returns null while `open` is false, so this is the same
  // "list + editor over it" shape every master screen uses (courier-delivery,
  // customer, applicant). It replaced an early `return` for the list branch,
  // which the page mount needed and the overlay does not.
  const columns: Column<MaterialBomAmendment>[] = [
    {
      header: "Entry No",
      cell: (r) => (
        <button
          type="button"
          onClick={() => perms.canEdit && openEdit(r)}
          className="font-mono text-xs font-medium text-primary hover:underline"
        >
          {r.code ?? "—"}
        </button>
      ),
    },
    {
      header: "Customer",
      cell: (r) => <span className="text-sm">{r.customer?.name ?? "—"}</span>,
    },
    {
      header: "Order",
      cell: (r) => (
        <span className="font-mono text-xs">
          {r.sales_orders?.order_number ?? "—"}
        </span>
      ),
    },
    {
      header: "A. No",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.amendment_no}</span>,
    },
    {
      header: "Date",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {fmtDate(r.amend_date)}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={mbaStatusTone(r.is_draft)}>
          {mbaStatusText(r.is_draft)}
        </StatusPill>
      ),
    },
    rowActionsColumn((r) => (
      <RowActions
        label={r.code}
        onEdit={() => openEdit(r)}
        canEdit={perms.canEdit}
        onDelete={() => del(r)}
        canDelete={perms.canDelete}
        isPending={isPending}
      />
    )),
  ];

  // ---------------- THE EDITOR ----------------
  const orderQty = selectedOrder?.order_qty ?? 0;
  const catName = (id: string | null) =>
    materialCategories.find((l) => l.id === id)?.name ?? "—";
  const itemName = (id: string | null) =>
    data.items.find((i) => i.id === id)?.name ?? "—";
  const uomName = (id: string | null) =>
    data.uoms.find((u) => u.id === id)?.name ?? "—";

  /** Pack sizes defined on a material, for that BOM line's pack picker. Empty
   *  means the material has no conversions — the ~90% bought in the unit they
   *  are consumed in, or one whose master hasn't been filled in yet. */
  const packsFor = (itemId: string | null) =>
    itemId
      ? data.conversions.filter((c) => c.item_id === itemId && isUsableConversion(c))
      : [];
  const packById = (id: string | null) =>
    id ? (data.conversions.find((c) => c.id === id) ?? null) : null;
  /** Decimals the purchase quantity may carry. `decimal_places_allowed` (0309),
   *  not `decimal_places` (0224) — the latter is 0 on every row in the live DB
   *  and would round 16.67 Gross to 17, the round-up the client rejected. */
  const uomDecimals = (id: string | null) =>
    data.uoms.find((u) => u.id === id)?.decimal_places_allowed ?? 2;

  const calcRows: CalculatedQtyRow[] = items
    .filter((r) => r.item_id || r.category_id || r.quantity_nos)
    .map((r, i) => {
      const per = r.quantity_nos ? Number(r.quantity_nos) : null;
      // Base requirement: what production consumes. 1,000 pcs × 200 m = 200,000 m.
      const totalBase = per != null ? per * orderQty : null;
      // Purchase requirement: the same thing in the unit the supplier bills in.
      // 200,000 m ÷ 2,500 m/cone = 80 cones. Null when no pack is selected, so
      // lines that never needed a conversion read "—" rather than a wrong number.
      const pack = packById(r.uom_conversion_id);
      return {
        sno: i + 1,
        category: catName(r.category_id),
        description: itemName(r.item_id),
        process: "—",
        size: "—",
        uom: uomName(r.consumption_uom_id ?? r.purchase_uom_id),
        calc_qty: totalBase,
        purchase_qty:
          pack && totalBase != null
            ? toPurchaseQty(totalBase, pack, uomDecimals(pack.alt_uom_id))
            : null,
        purchase_uom: pack ? uomName(pack.alt_uom_id) : "—",
        order_qty: orderQty,
      };
    });

  /**
   * WHAT IS STOPPING A SAVE, AND WHICH SECTION HOLDS IT.
   *
   * Derived, never hand-assembled. The old form was
   * `!!form.amend_date && !!form.sales_order_id` — correct, but a list this
   * screen had to remember to extend, and with only one panel mounted at a time
   * a blocked Save had nothing on screen to explain itself. Both required
   * fields live in the first section, so `bySection` puts the count on that rail
   * item and `onBlockedSave` steers there.
   *
   * The two entries mirror the `required` props on the fields below, so the red
   * `*`, the cursor hold and this list cannot disagree. Deliberately no rule
   * about item or process lines: the record has never required them, and adding
   * one here would be a behaviour change dressed up as a layout change.
   *
   * NO `problems` BADGE ON THE RAIL (operator request, 2026-08-10). The sections
   * below deliberately pass `done` and not `problems`, so a section with a blank
   * mandatory field shows the quiet empty dot rather than a red count. This is a
   * real trade-off, not an oversight: one section is mounted at a time, so the
   * badge was the only thing that could say WHICH section was blocking Save
   * before the operator pressed it.
   *
   * What replaces it is `onBlockedSave` below — Save stays clickable, and
   * pressing it toasts the reason and steers the cursor to the offending field.
   * The information still arrives, on the action instead of ahead of it. Keep
   * `validity` itself: it is what makes `canSave` derived rather than a
   * hand-assembled `&&` chain that a later field can be forgotten from.
   */
  const validity = sectionValidity({
    sections: [
      { key: "amendment" },
      { key: "items" },
      { key: "processes" },
      { key: "calc" },
    ],
    values: form,
    fields: [
      {
        section: "amendment",
        id: "mba-date",
        label: "Date",
        required: true,
        empty: (f) => !f.amend_date,
      },
      {
        section: "amendment",
        id: "mba-order",
        label: "SC No / Order",
        required: true,
        empty: (f) => !f.sales_order_id,
      },
    ],
  });

  const revealFirstProblem = () => {
    const p = validity.first;
    if (!p) return;
    toastError(p.message);
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };

  // ---- the item grid ---------------------------------------------------------
  // NOTE ON `className`/`align` BELOW: those are the TABLE layout's, and the grid
  // renders cards here (`forceCards`), so nothing reads them today. They are kept
  // rather than stripped because they are the widths the table needs if the card
  // layout is ever reverted, and re-deriving "how wide should Consumption Uom be"
  // from scratch is how a reverted grid comes back squashed.
  // `ChildGrid`, not the hand-rolled <table> this screen carried. That table was
  // one of the ~22 AGENTS.md counts under "Tab lands on fields": it drew its own
  // <thead>, its own S No cell and its own Trash2 remove button, so it inherited
  // none of Ctrl+Del, `data-row-remove`, required cells, the mobile cards or the
  // totals band. The `#` column and the remove button are the component's, which
  // is why neither appears below.
  const itemColumns: ChildGridColumn<ItemRow>[] = [
    {
      header: "Category",
      className: "min-w-[150px]",
      cell: (r) => (
        <LookupDialogPicker
          kind="material_category"
          label="Category"
          options={materialCategories}
          value={r.category_id}
          onChange={(id) => updItem(r.key, { category_id: id })}
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
          compact
        />
      ),
    },
    {
      header: "Type",
      className: "min-w-[110px]",
      cell: (r) => (
        <Select
          value={r.type}
          onChange={(e) => updItem(r.key, { type: e.target.value })}
          className="h-8"
        >
          <option value="">—</option>
          {MATERIAL_TYPE_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Item",
      className: "min-w-[160px]",
      cell: (r) => (
        <RecordPicker
          label="Item"
          items={data.items}
          value={r.item_id}
          onChange={(id) => updItem(r.key, { item_id: id })}
          compact
        />
      ),
    },
    {
      header: "Attribute",
      className: "min-w-[150px]",
      cell: (r) => (
        <LookupDialogPicker
          kind="material_attribute"
          label="Attribute"
          options={materialAttributes}
          value={r.attribute_id}
          onChange={(id) => updItem(r.key, { attribute_id: id })}
          canCreate={masterPerms.canCreate}
          canEdit={masterPerms.canEdit}
          compact
        />
      ),
    },
    {
      header: "Supply Type",
      className: "min-w-[120px]",
      cell: (r) => (
        <Select
          value={r.supply_type}
          // Changing the type drops a vendor the new type no longer allows.
          // Leaving it would show a value the reopened picker no longer offers —
          // the row would look valid and save a vendor the rule forbids.
          //
          // Asked of the SAME function that builds the picker's options, so the
          // two can never disagree about what "allowed" means.
          onChange={(e) => {
            const supply_type = e.target.value;
            const { items: allowed } = nominatedVendorOptions({
              ...vendorRule,
              supplyType: supply_type,
            });
            const keepVendor =
              !r.vendor_id || allowed.some((v) => v.id === r.vendor_id);
            updItem(
              r.key,
              keepVendor ? { supply_type } : { supply_type, vendor_id: null },
            );
          }}
          className="h-8"
        >
          <option value="">—</option>
          {SUPPLY_TYPE_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Vendor",
      className: "min-w-[150px]",
      // Narrowed per ROW, not per grid: two lines of the same amendment can
      // carry different supply types.
      cell: (r) => (
        <NominatedVendorPicker
          {...vendorRule}
          supplyType={r.supply_type}
          value={r.vendor_id}
          onChange={(id) => updItem(r.key, { vendor_id: id })}
          compact
        />
      ),
    },
    {
      header: "Purchase Uom",
      className: "min-w-[130px]",
      cell: (r) => (
        <RecordPicker
          label="Purchase Uom"
          items={data.uoms}
          value={r.purchase_uom_id}
          onChange={(id) => updItem(r.key, { purchase_uom_id: id })}
          compact
        />
      ),
    },
    {
      header: "Consumption Uom",
      className: "min-w-[130px]",
      cell: (r) => (
        <RecordPicker
          label="Consumption Uom"
          items={data.uoms}
          value={r.consumption_uom_id}
          onChange={(id) => updItem(r.key, { consumption_uom_id: id })}
          compact
        />
      ),
    },
    {
      header: "Alternate Uom",
      className: "min-w-[130px]",
      cell: (r) => (
        <RecordPicker
          label="Alternate Uom"
          items={data.uoms}
          value={r.alternate_uom_id}
          onChange={(id) => updItem(r.key, { alternate_uom_id: id })}
          compact
        />
      ),
    },
    {
      header: "Purchase Pack",
      className: "min-w-[170px]",
      // Which cone/gross size this line buys. Options come from the material's
      // own conversions, so an empty list is the signal to go define them on the
      // Materials master rather than a dead control.
      cell: (r) => {
        const packs = packsFor(r.item_id);
        return (
          <Select
            className="h-8"
            value={r.uom_conversion_id ?? ""}
            disabled={packs.length === 0}
            title={
              packs.length === 0
                ? "No conversions defined on this material — add them under Materials ▸ Units of Measure."
                : undefined
            }
            onChange={(e) =>
              updItem(r.key, { uom_conversion_id: e.target.value || null })
            }
          >
            <option value="">
              {packs.length === 0 ? "No conversions" : "Same as consumption"}
            </option>
            {packs.map((c) => (
              <option key={c.id} value={c.id}>
                {describeConversion(c, uomName)}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      header: "Combination",
      className: "min-w-[120px]",
      cell: (r) => (
        <Input
          value={r.combination}
          onChange={(e) => updItem(r.key, { combination: e.target.value })}
          className="h-8"
        />
      ),
    },
    {
      header: "MOQ",
      align: "right",
      className: "min-w-[6rem]",
      cell: (r) => (
        <Input
          type="number"
          min="0"
          step="0.001"
          value={r.moq}
          onChange={(e) => updItem(r.key, { moq: e.target.value })}
          className="h-8 text-right"
        />
      ),
    },
    {
      header: "Qty",
      align: "right",
      className: "min-w-[6rem]",
      cell: (r) => (
        <Input
          type="number"
          min="0"
          step="0.001"
          value={r.quantity_nos}
          onChange={(e) => updItem(r.key, { quantity_nos: e.target.value })}
          className="h-8 text-right"
        />
      ),
    },
  ];

  const procColumns: ChildGridColumn<ProcRow>[] = [
    {
      header: "Item",
      cell: (r) => (
        <RecordPicker
          label="Item"
          items={data.items}
          value={r.item_id}
          onChange={(id) => updProc(r.key, { item_id: id })}
          compact
        />
      ),
    },
  ];

  const calcColumns: Column<CalculatedQtyRow>[] = [
    { header: "S No", cell: (r) => <span className="text-xs text-muted-foreground">{r.sno}</span> },
    { header: "Category", cell: (r) => r.category },
    { header: "Description", cell: (r) => r.description },
    { header: "Process", cell: (r) => <span className="text-muted-foreground">{r.process}</span> },
    { header: "Size", cell: (r) => <span className="text-muted-foreground">{r.size}</span> },
    { header: "Uom", cell: (r) => r.uom },
    {
      header: "Calc Qty",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">{r.calc_qty != null ? fmtNumber(r.calc_qty) : "—"}</span>
      ),
    },
    {
      header: "Purchase Qty",
      align: "right",
      cell: (r) => (
        <span className="font-medium tabular-nums">
          {r.purchase_qty != null ? fmtNumber(r.purchase_qty) : "—"}
        </span>
      ),
    },
    { header: "Purchase Uom", cell: (r) => r.purchase_uom },
    {
      header: "Order Qty",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-muted-foreground">{fmtNumber(r.order_qty)}</span>
      ),
    },
  ];

  /**
   * FOUR RAIL SECTIONS, and the first of them is the header band.
   *
   * The three horizontal tabs (Items / Processes / Calculated Quantities) left
   * the document's own fields — Date, Customer, SC No — stranded above the strip
   * on a full-bleed `CardBody` that hand-rolled `<div><Label/><Input/></div>`
   * pairs and a literal "Date *". None of that was reachable by the field
   * primitives, so the `*` drew nothing behind it and the required hold never
   * ran. Making the header a section puts every field on this screen behind one
   * `<Field>` convention, and it is what the operator asked for: four rows in
   * the rail, the screen's own name first.
   *
   * Same move `amendment-screen.tsx` made for the sibling Order Amendment
   * ("Order Info" as its first section), so the two amendment screens read
   * alike.
   */
  const sections: FullScreenSection[] = [
    {
      key: "amendment",
      label: "Material BOM Amendment",
      icon: ClipboardList,
      done: !!form.amend_date && !!form.sales_order_id,
      content: (
        <SectionBody
          title="Material BOM Amendment"
          hint="Which accepted order is being amended, and when."
        >
          {/* ONE FieldGrid for the whole section — SectionBody has no grid of
              its own, and two stacked grids agree on the left edge but not the
              row gap. */}
          <FieldGrid>
            {/* size="sm" on EVERY field: 3 of 12, four per row, ~280px. Nothing
                is sized to its own data, so the Date box and the Customer picker
                line up down the page. */}
            {/* No `skipTab`: `Input` already sets `tabIndex={-1}` on a readOnly
                field (input.tsx), which is the one declaration that also takes it
                out of the arrow walk and Enter-advance. A second one here would
                be the same fact stated twice. */}
            <Field label="Entry No" size="sm" htmlFor="mba-entry">
              <Input id="mba-entry" readOnly value={editId ? "—" : "Auto"} className="font-mono" />
            </Field>
            <Field label="Date" required size="sm" htmlFor="mba-date">
              <Input
                id="mba-date"
                type="date"
                value={form.amend_date}
                onChange={(e) => set({ amend_date: e.target.value })}
              />
            </Field>
            {/* The picker draws its own <Label>; `Field` is here for the span
                only, which is what its optional `label` is for. */}
            <Field size="sm">
              <CustomerPicker
                customers={data.customers}
                value={form.customer_id}
                onChange={(id) => set({ customer_id: id })}
                label="Customer"
              />
            </Field>
            <Field label="A. No" size="sm" htmlFor="mba-ano">
              <Input id="mba-ano" readOnly value={amendmentNo != null ? String(amendmentNo) : "Auto"} />
            </Field>
            <Field size="sm">
              {/* `id` lands on the picker's trigger, so a blocked Save can steer
                  the cursor to THIS control rather than the first marked one in
                  the section. */}
              <RecordPicker
                id="mba-order"
                label="SC No / Order"
                identity="code"
                items={orderItems}
                value={form.sales_order_id}
                onChange={(id) => set({ sales_order_id: id })}
                required
              />
            </Field>
            <Field label="Remarks" size="sm" htmlFor="mba-remarks">
              <Input
                id="mba-remarks"
                value={form.remarks}
                onChange={(e) => set({ remarks: e.target.value })}
                placeholder="Optional"
              />
            </Field>
          </FieldGrid>
        </SectionBody>
      ),
    },
    {
      key: "items",
      label: "Items",
      icon: Boxes,
      done: items.some((r) => r.item_id || r.category_id),
      content: (
        <SectionBody title="Items" hint="The materials this amendment puts on the BOM.">
          {/* NO SIDEWAYS SCROLLBAR — THE ROW WRAPS INSTEAD (operator, 2026-08-10).
              13 columns cannot fit 1180px minus the rail, so the responsive table
              put the row behind a horizontal scrollbar: the operator filled
              Category, then dragged a bar to reach MOQ and Qty, with the row's
              first cells scrolled out of sight. That is the "no scroll-in-a-box"
              rule (LAYOUT.md §6) failing on the axis nobody had hit yet.

              `forceCards` drops the table for one card per line, and
              `renderMobileRow` fills that card with the SAME `FieldGrid` the
              header section uses — `size="sm"`, four across, wrapping onto as
              many lines as it takes. So a line's 13 fields read like a small form
              rather than a train carriage, and every control on this screen now
              sits on one field track.

              `columns` is still the single declaration: the labels and the cells
              below are read straight off it, so adding a column here cannot leave
              the card and the header disagreeing. */}
          <ChildGrid<ItemRow>
            columns={itemColumns}
            rows={items}
            forceCards
            renderMobileRow={(row, i) => (
              <FieldGrid>
                {itemColumns.map((c, ci) => (
                  // `Field` supplies the label the <th> used to, and the
                  // RequiredScope that `cards` mode applies per column only when
                  // it renders the columns itself. Declaring `required` here
                  // keeps one source for the `*` and the cursor hold — none of
                  // these columns is mandatory today, and this is what makes it
                  // safe when one becomes so.
                  <Field key={ci} label={c.header} required={c.required} size="sm">
                    {c.cell(row, i)}
                  </Field>
                ))}
              </FieldGrid>
            )}
            seedRow
            onAdd={() => mutItems((xs) => [...xs, blankItem(newKey())])}
            onRemove={(r) => mutItems((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add item"
          />
        </SectionBody>
      ),
    },
    {
      key: "processes",
      label: "Processes",
      icon: Workflow,
      done: procs.some((r) => r.item_id),
      content: (
        <SectionBody title="Processes" hint="The processes these materials pass through.">
          <ChildGrid<ProcRow>
            columns={procColumns}
            rows={procs}
            seedRow
            onAdd={() => mutProcs((xs) => [...xs, { key: newKey(), item_id: null }])}
            onRemove={(r) => mutProcs((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add process"
          />
        </SectionBody>
      ),
    },
    {
      key: "calc",
      label: "Calculated Quantities",
      icon: Calculator,
      done: calcRows.length > 0,
      content: (
        <SectionBody
          title="Calculated Quantities"
          hint="Read-only — derived from the item lines and the order quantity."
        >
          <p className="text-xs text-muted-foreground">
            Provisional calculation — Calc Qty = per-piece Qty × order qty
            {selectedOrder ? ` (${fmtNumber(orderQty)})` : " (select an order)"};
            Purchase Qty = Calc Qty ÷ the selected Purchase Pack. Process / Size
            mapping pending the legacy formula.
          </p>
          {/* A read-only projection, not line items — so `DataTable`, the app's
              presentational table, rather than `ChildGrid`, which exists to be
              typed into and would draw an Add button for rows nobody can add. */}
          <DataTable
            columns={calcColumns}
            rows={calcRows}
            getKey={(r) => String(r.sno)}
            empty="Add items with a quantity to see calculated requirements."
          />
        </SectionBody>
      ),
    },
  ];

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="Material BOM Amendment"
          description="Amend an accepted order's material BOM — items, processes & calculated quantities."
          actions={
            <div className="flex items-center gap-2">
              <Link href="/orders">
                <Button variant="outline" size="md">
                  ← Garment Orders
                </Button>
              </Link>
              {perms.canCreate && (
                <Button size="md" onClick={openAdd}>
                  New Amendment
                </Button>
              )}
            </div>
          }
        />
        <DataTable
          columns={withCreatedColumns(columns, rows)}
          rows={rows}
          getKey={(r) => r.id}
          empty="No material BOM amendments yet. Use 'New Amendment' to create the first."
        />
      </div>

      {/* THE EDITOR IS A FULL-SCREEN TAKEOVER, NOT A PAGE PANE (operator
          request, 2026-08-10). `mount="page"` sat the rail in normal flow with
          the module sidebar still beside it, so the operator entering an
          amendment had two navigation lists on screen — the app's and the
          record's — and only ~1090px left for a 13-column grid. The overlay is
          `fixed inset-0`, so the amendment is the only thing on screen.
          `open` is what mounts it; the list above stays rendered underneath. */}
      <MasterFullScreen
        ref={shellRef}
        mount="overlay"
        open={mode === "edit"}
        onClose={() => setMode("list")}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">
              material BOM amendment
            </span>
          </>
        }
        // An overlay NEEDS this band: it covers the whole screen, so without it
        // there is nothing naming the record being edited. (A page mount omits
        // it, because the route's own PageHeader already does.)
        header={{
          initials: "MB",
          title:
            selectedOrder?.order_number ??
            (editId ? "Material BOM Amendment" : "New amendment"),
          badges: dirty ? (
            <span className="text-[11px] font-medium text-warning">● Unsaved</span>
          ) : null,
          meta: (
            <>
              <span>
                {amendmentNo != null ? (
                  <>
                    A. No{" "}
                    <span className="font-semibold text-foreground">{amendmentNo}</span>
                  </>
                ) : (
                  "A. No auto"
                )}
              </span>
              {customerName && <span>· {customerName}</span>}
              {form.amend_date && <span>· {fmtDate(form.amend_date)}</span>}
            </>
          ),
        }}
        sections={sections}
        footer={{
          status: dirty
            ? "Unsaved changes"
            : editId
              ? "All changes saved"
              : "New amendment",
          onCancel: () => setMode("list"),
          onSave: () => submit(false),
          // Names the ENTITY, not a bare "Save" that could belong to any record
          // on any screen.
          saveLabel: "Save amendment",
          canSave: validity.canSave,
          // Keeps Save clickable when blocked, so it explains itself instead of
          // going silently dead — and so Ctrl+S and Enter-off-the-last-field
          // reach the same handler rather than falling through to "Save as
          // Draft" (`submitTargetOf` takes the footer's last NON-disabled
          // button).
          onBlockedSave: revealFirstProblem,
          onSaveDraft: perms.canCreate ? () => submit(true) : undefined,
          isPending,
        }}
      />
    </>
  );
}
