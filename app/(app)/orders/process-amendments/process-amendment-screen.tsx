"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Shirt, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGrid } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { sectionValidity } from "@/lib/screens/validity";
import { RecordPicker } from "@/components/masters/record-picker";
import {
  createProcessAmendment,
  updateProcessAmendment,
  deleteProcessAmendment,
} from "@/lib/orders/process-amendments/actions";
import type { GarmentProcessAmendment, GpaTab } from "@/lib/orders/process-amendments/types";
import type { GpaFormData, StyleRow } from "@/lib/orders/process-amendments/service";
import { withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
interface Props {
  rows: GarmentProcessAmendment[];
  data: GpaFormData;
  perms: Perms;
}

type LineRow = { key: string; style_id: string | null };

const today = () => new Date().toISOString().slice(0, 10);

export function ProcessAmendmentScreen({ rows, data, perms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [amendDate, setAmendDate] = useState(() => today());
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [amendSno, setAmendSno] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [component, setComponent] = useState<LineRow[]>([]);
  const [garment, setGarment] = useState<LineRow[]>([]);

  /**
   * Unsaved work — real edits, not "is the editor open".
   *
   * It was `useUnsavedGuard(mode === "edit" || isPending)`, which pinned the
   * silent PWA auto-update off for as long as the operator sat on the screen and
   * made every Escape ask. The overlay mount below needs this to be honest for a
   * second reason: `MasterFullScreen` calls `useModalGuard` on an overlay and
   * `confirmDiscard()` deliberately does not read that one, so THIS is what
   * stands between Escape and a silently discarded amendment.
   */
  const [dirty, setDirty] = useState(false);

  /** Lets a blocked Save switch section and land on the offending field. */
  const shellRef = useRef<MasterFullScreenHandle>(null);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  useUnsavedGuard(dirty || isPending);

  const styleById = useMemo(() => {
    const m = new Map<string, StyleRow>();
    data.styles.forEach((s) => m.set(s.id, s));
    return m;
  }, [data.styles]);

  const buyerItems = useMemo(
    () => data.buyers.map((b) => ({ id: b.id, code: b.code, name: b.name })),
    [data.buyers],
  );
  const orderItems = useMemo(
    () => data.orders.map((o) => ({ id: o.id, code: o.order_number, name: o.order_number ?? "—" })),
    [data.orders],
  );
  const styleItems = useMemo(
    () => data.styles.map((s) => ({ id: s.id, code: s.code, name: s.style_name ?? "(unnamed)" })),
    [data.styles],
  );

  // Every mutation marks the record dirty in the same breath as changing it, so
  // the flag cannot drift from the state it describes.
  const mutComponent = (fn: (xs: LineRow[]) => LineRow[]) => { setComponent(fn); setDirty(true); };
  const mutGarment = (fn: (xs: LineRow[]) => LineRow[]) => { setGarment(fn); setDirty(true); };

  function openAdd() {
    setEditId(null);
    setAmendDate(today());
    setCustomerId(null);
    setOrderId(null);
    setAmendSno("");
    setOrderNo("");
    setComponent([{ key: newKey(), style_id: null }]);
    setGarment([{ key: newKey(), style_id: null }]);
    setDirty(false);
    setMode("edit");
  }

  function openEdit(r: GarmentProcessAmendment) {
    setEditId(r.id);
    setAmendDate(r.amend_date ?? today());
    setCustomerId(r.customer_id);
    setOrderId(r.sales_order_id);
    setAmendSno(r.amend_sno != null ? String(r.amend_sno) : "");
    setOrderNo(r.order_no ?? "");
    setComponent(
      r.lines.filter((l) => l.tab === "component").map((l) => ({ key: newKey(), style_id: l.style_id })),
    );
    setGarment(
      r.lines.filter((l) => l.tab === "garment").map((l) => ({ key: newKey(), style_id: l.style_id })),
    );
    setDirty(false);
    setMode("edit");
  }

  function onPickOrder(id: string | null) {
    setOrderId(id);
    setDirty(true);
    // auto-fill Customer from the picked order's buyer (legacy behaviour)
    if (id) {
      const o = data.orders.find((x) => x.id === id);
      if (o?.buyer_id && !customerId) setCustomerId(o.buyer_id);
    }
  }

  function submit() {
    const lines = [
      ...component.map((r) => ({ tab: "component" as GpaTab, sno: 0, style_id: r.style_id })),
      ...garment.map((r) => ({ tab: "garment" as GpaTab, sno: 0, style_id: r.style_id })),
    ];
    const payload = {
      amend_date: amendDate,
      customer_id: customerId,
      sales_order_id: orderId,
      amend_sno: amendSno ? Number(amendSno) : null,
      order_no: orderNo || null,
      lines,
    };
    start(async () => {
      const res = editId
        ? await updateProcessAmendment(editId, payload)
        : await createProcessAmendment(payload);
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

  function del(r: GarmentProcessAmendment) {
    /* No confirm() — <RowActions> asks in the row (LAYOUT.md §6a). */
    start(async () => {
      const res = await deleteProcessAmendment(r.id);
      if (res.ok) {
        success("Amendment deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---------------- THE LIST ----------------
  // Rendered unconditionally, with the editor as an OVERLAY above it —
  // `MasterFullScreen` returns null while `open` is false.
  const columns: Column<GarmentProcessAmendment>[] = [
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
    { header: "Date", cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.amend_date)}</span> },
    { header: "Customer", cell: (r) => <span className="text-sm">{r.customer?.name ?? "—"}</span> },
    {
      header: "RE No",
      cell: (r) => <span className="font-mono text-xs">{r.sales_order?.order_number ?? "—"}</span>,
    },
    { header: "Order No", cell: (r) => <span className="text-sm">{r.order_no ?? "—"}</span> },
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
  const entryCode = editId ? (rows.find((r) => r.id === editId)?.code ?? null) : null;
  const customerName = buyerItems.find((b) => b.id === customerId)?.name ?? null;
  const orderNumber = orderItems.find((o) => o.id === orderId)?.code ?? null;

  /**
   * DERIVED, never hand-assembled. It was `!amendDate` inline on the button.
   * `fields` mirrors the `required` prop below, so the red `*`, the cursor hold
   * and the Save gate cannot disagree.
   *
   * No rule about the line grids: blank rows are ignored on save (the screen's
   * own description says so), so an amendment with none is not an incomplete
   * record — adding a rule here would be a behaviour change dressed up as a
   * layout change.
   */
  const validity = sectionValidity({
    sections: [{ key: "amendment" }, { key: "component" }, { key: "garment" }],
    values: { amendDate },
    fields: [
      {
        section: "amendment",
        id: "gpa-date",
        label: "Date",
        required: true,
        empty: (v) => !v.amendDate,
      },
    ],
  });

  const revealFirstProblem = () => {
    const p = validity.first;
    if (!p) return;
    toastError(p.message);
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };

  /**
   * One column list for both grids — the two tabs differ only in which array
   * they hold, so a second copy is a second thing to keep true.
   *
   * Four columns (the `#` and the remove ✕ are the component's), which fits the
   * editor width comfortably — so this keeps the table layout. `forceCards` is
   * for the grids that would otherwise need a sideways scrollbar; see rule 4 in
   * the `raagam-screen-layout` skill.
   */
  const lineColumns = (
    setRows: (fn: (xs: LineRow[]) => LineRow[]) => void,
  ): ChildGridColumn<LineRow>[] => [
    {
      header: "Style Ref No",
      cell: (r) => (
        <RecordPicker
          label="Style Ref No"
          items={styleItems}
          value={r.style_id}
          onChange={(id) => setRows((xs) => xs.map((x) => (x.key === r.key ? { ...x, style_id: id } : x)))}
          compact
        />
      ),
    },
    {
      header: "Style",
      cell: (r) => {
        const st = r.style_id ? styleById.get(r.style_id) : undefined;
        return <span className="text-sm">{st?.style_name ?? "—"}</span>;
      },
    },
    {
      header: "Article No",
      cell: (r) => {
        const st = r.style_id ? styleById.get(r.style_id) : undefined;
        return <span className="text-sm text-muted-foreground">{st?.article_no ?? "—"}</span>;
      },
    },
  ];

  /**
   * THREE RAIL ROWS, THE SCREEN'S OWN NAME FIRST.
   *
   * The header fields — Entry No, Date, Customer, SC No — were a full-bleed
   * `CardBody` above a `<Tabs>` strip, hand-rolling `<div><Label/><Input/></div>`
   * pairs and a literal `"Date *"`. That asterisk drew a red star with nothing
   * behind it, so the mandatory-field hold never ran here. They are a SECTION
   * now, on the same `<Field>` convention as everything else.
   *
   * No `problems` badge (operator, 2026-08-11) — `onBlockedSave` carries the
   * "which section" job instead. See "The operator's five" in the skill.
   */
  const sections: FullScreenSection[] = [
    {
      key: "amendment",
      label: "Garment Process Amendment",
      icon: ClipboardList,
      done: !!amendDate && !!orderId,
      content: (
        <SectionBody title="Garment Process Amendment">
          <FieldGrid>
            {/* `Input readOnly` sets `tabIndex={-1}` itself, which is what keeps
                an auto field off the typing path — no `skipTab` needed. It also
                replaces `disabled`, which would have taken the value out of the
                accessibility tree entirely. */}
            <Field label="Entry No" size="sm" htmlFor="gpa-entry">
              <Input id="gpa-entry" readOnly value={entryCode ?? "(auto)"} className="font-mono" />
            </Field>
            <Field label="Date" required size="sm" htmlFor="gpa-date">
              <Input
                id="gpa-date"
                type="date"
                value={amendDate}
                onChange={(e) => { setAmendDate(e.target.value); setDirty(true); }}
              />
            </Field>
            {/* The picker draws its own label; `Field` is here for the span. */}
            <Field size="sm">
              <RecordPicker
                label="Customer"
                items={buyerItems}
                value={customerId}
                onChange={(id) => { setCustomerId(id); setDirty(true); }}
              />
            </Field>
            <Field size="sm">
              <RecordPicker label="RE No" items={orderItems} value={orderId} onChange={onPickOrder} />
            </Field>
            <Field label="Amend S No" size="sm" htmlFor="gpa-sno">
              <Input
                id="gpa-sno"
                type="number"
                value={amendSno}
                onChange={(e) => { setAmendSno(e.target.value); setDirty(true); }}
              />
            </Field>
            <Field label="Order No" size="sm" htmlFor="gpa-order">
              <Input
                id="gpa-order"
                uppercase
                value={orderNo}
                onChange={(e) => { setOrderNo(e.target.value); setDirty(true); }}
              />
            </Field>
          </FieldGrid>
        </SectionBody>
      ),
    },
    {
      key: "component",
      label: "Component Process",
      icon: SlidersHorizontal,
      done: component.some((r) => r.style_id),
      content: (
        <SectionBody title="Component Process">
          {/* `ChildGrid`, not the hand-rolled <table> this screen carried — that
              one drew its own S No cell and its own Trash2 button, so it
              inherited neither Ctrl+Del nor `data-row-remove`. */}
          <ChildGrid<LineRow>
            columns={lineColumns(mutComponent)}
            rows={component}
            seedRow
            onAdd={() => mutComponent((xs) => [...xs, { key: newKey(), style_id: null }])}
            onRemove={(r) => mutComponent((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add style"
          />
        </SectionBody>
      ),
    },
    {
      key: "garment",
      label: "Garment Process",
      icon: Shirt,
      done: garment.some((r) => r.style_id),
      content: (
        <SectionBody title="Garment Process">
          <ChildGrid<LineRow>
            columns={lineColumns(mutGarment)}
            rows={garment}
            seedRow
            onAdd={() => mutGarment((xs) => [...xs, { key: newKey(), style_id: null }])}
            onRemove={(r) => mutGarment((xs) => xs.filter((x) => x.key !== r.key))}
            addLabel="+ Add style"
          />
        </SectionBody>
      ),
    },
  ];

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="Garment Process Amendment"
          description="Amend the component / garment process of styles on an order."
          actions={perms.canCreate ? <Button onClick={openAdd}>New Amendment</Button> : undefined}
        />
        <DataTable
          columns={withCreatedColumns(columns, rows)}
          rows={rows}
          getKey={(r) => r.id}
          empty="No amendments yet."
        />
      </div>

      {/* A FULL-SCREEN TAKEOVER, not a page pane: the module sidebar beside a
          section rail is two navigation lists on one screen. */}
      <MasterFullScreen
        ref={shellRef}
        mount="overlay"
        open={mode === "edit"}
        onClose={() => setMode("list")}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">garment process amendment</span>
          </>
        }
        // An overlay covers the route's PageHeader, so without this band nothing
        // on screen names the record being edited.
        header={{
          initials: "GP",
          title: orderNumber ?? (editId ? "Garment Process Amendment" : "New amendment"),
          badges: dirty ? (
            <span className="text-[11px] font-medium text-warning">● Unsaved</span>
          ) : null,
          meta: (
            <>
              <span>
                {entryCode ? (
                  <span className="font-mono font-semibold text-foreground">{entryCode}</span>
                ) : (
                  "Entry No auto"
                )}
              </span>
              {customerName && <span>· {customerName}</span>}
              {amendDate && <span>· {fmtDate(amendDate)}</span>}
            </>
          ),
        }}
        sections={sections}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New amendment",
          onCancel: () => setMode("list"),
          onSave: submit,
          saveLabel: "Save amendment",
          canSave: validity.canSave,
          // Keeps Save clickable when blocked so it names the missing field and
          // steers there — and so Ctrl+S and Enter-off-the-last-field reach the
          // same handler.
          onBlockedSave: revealFirstProblem,
          isPending,
        }}
      />
    </>
  );
}
