"use client";

/**
 * Orders ▸ Order Execution ▸ Internal Work Orders — the list and the IWO editor.
 *
 * ## THE IWO IS A HEADER; ITS PLAN LIVES ON ITS BOM (2026-09-19)
 *
 * The legacy shape (screenshots 2936 / 2938 / 2941): the IWO carries number,
 * date, For, reference, style, delivery and remarks, and what it procures is
 * planned on a separate BOM that names it:
 *
 *   - For = Yarn or Fabric → IWO Fabric BOM (`/orders/iwo-fabric-bom`, 0581),
 *     the order Fabric BOM duplicated.
 *   - For = Accessories    → IWO Material BOM (`/orders/iwo-material-bom`, 0584),
 *     the order Material BOM duplicated.
 *
 * "Open Fabric BOM" / "Open Material BOM" lands the operator IN that work
 * order's BOM (`?open=<id>`, `useOpenIntent`). The line grids that used to sit
 * on this screen, and their tables, went with 0582 (yarn, fabric) and 0585
 * (accessories) — they held no rows. Once a BOM exists, For is locked
 * (`iwo_for_lock`), since the BOM would be left planning the wrong kind.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import {
  MasterFullScreen,
  SectionBody,
  type FullScreenSection,
  type MasterFullScreenHandle,
} from "@/components/masters/master-full-screen";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions, type RowMenuItem } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { fmtDate, fmtNumber } from "@/lib/format";
import { today } from "@/lib/calendar";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { useCreateIntent } from "@/lib/use-create-intent";
import { sectionValidity } from "@/lib/screens/validity";
import {
  deleteInternalWorkOrder,
  previewIwoNumber,
  saveInternalWorkOrder,
  setIwoStatus,
} from "@/lib/orders/internal-work-orders/actions";
import {
  IWO_FOR,
  IWO_FOR_LABELS,
  IWO_STATUS_LABELS,
  isIwoFor,
  iwoStatusTone,
  type IwoFor,
  type IwoInput,
  type IwoStatus,
} from "@/lib/orders/internal-work-orders/types";
import type { IwoRow } from "@/lib/orders/internal-work-orders/service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/** Which BOM plans a work order of this kind, and where it lives. */
const bomOf = (f: IwoFor | "" | null | undefined) =>
  f === "accessories"
    ? { label: "Material BOM", path: "/orders/iwo-material-bom" }
    : f === "yarn" || f === "fabric"
      ? { label: "Fabric BOM", path: "/orders/iwo-fabric-bom" }
      : null;
const bomHref = (f: IwoFor, iwoId: string) => `${bomOf(f)?.path}?open=${iwoId}`;

/**
 * THE HEADER'S CAP — a definite length, never `max-w-fit` (a content-sized cap
 * computes to 0 under `@container/section`). The first line is the six fields
 * the operator fills in order, the steps Packing List Advice uses for the same
 * kinds of value:
 *   I.WO No code 144 + Date code 144 + For code 144 + Reference party 200
 *   + Deli Dt code 144                                            = 776
 *   + 4 × 12 gap                                                  = 824 → 52rem (832)
 * so Remarks folds onto a second line, the same place on a laptop and a 1920.
 * (No Style since 2026-09-20 — the user removed the field.)
 */
const HEADER_W = "max-w-[52rem]";

type Form = {
  iwo_date: string;
  iwo_for: IwoFor | "";
  /** Reference (RE No), TYPED (0597). */
  reference_no: string;
  deli_date: string;
  remarks: string;
};
const blankForm = (): Form => ({
  iwo_date: today(),
  iwo_for: "",
  reference_no: "",
  deli_date: "",
  remarks: "",
});

/**
 * THE WORK ORDER IS WHERE ITS PLAN IS SEEN (2026-09-20). Its BOM and budget no
 * longer have their own entries on Order Execution — each IWO has exactly one
 * of each, so those were three extra lists of the same work orders — and this
 * list is the one place a work order's BOM and budget are read together. The
 * editors themselves are unchanged and open from here.
 */
const budgetPill = (b: IwoRow["budget"]) =>
  !b ? (
    <StatusPill tone="neutral">Not started</StatusPill>
  ) : b.status === "approved" ? (
    <StatusPill tone="success">Approved</StatusPill>
  ) : b.status === "submitted" ? (
    <StatusPill tone="info">Submitted</StatusPill>
  ) : b.status === "rejected" ? (
    <StatusPill tone="danger">Rejected</StatusPill>
  ) : (
    <StatusPill tone="warning">Draft</StatusPill>
  );

const bomPill = (b: IwoRow["bom"]) =>
  !b ? (
    <StatusPill tone="neutral">Not started</StatusPill>
  ) : b.is_draft ? (
    <StatusPill tone="info">Draft</StatusPill>
  ) : (
    <StatusPill tone="success">Saved</StatusPill>
  );

export function IwoScreen({
  rows,
  perms,
  nextIwoNo,
}: {
  rows: IwoRow[];
  perms: Perms;
  /** The I.WO No a work order raised TODAY would get — fetched with the page so
   *  a new one's box is filled on its first paint. */
  nextIwoNo: string | null;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(blankForm);

  /**
   * Real edits, never "is the editor open". The overlay mount means
   * `MasterFullScreen` only calls `useModalGuard`, which `confirmDiscard()`
   * deliberately does not read — so THIS is what stands between Escape and a
   * silently discarded work order, and what holds off the silent auto-reload.
   */
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(dirty || isPending);

  /**
   * THE I.WO NO BOX. Two sources, never both: a saved work order shows its
   * STORED number, a new one shows what `peek_iwo_number` (0580) predicts.
   * Asked from the EVENTS that change the answer — opening a new record, and a
   * Date edit (the Date decides the fiscal year) — never from an effect.
   * `previewSeq` drops an answer that arrives after a newer question.
   * A PREDICTION, NOT A RESERVATION: only the first of two concurrent saves at
   * one unit gets the number shown.
   */
  const [previewNo, setPreviewNo] = useState<string | null>(nextIwoNo);
  const previewSeq = useRef(0);
  const askPreview = (iwoDate: string) => {
    const seq = ++previewSeq.current;
    void previewIwoNumber(iwoDate || null).then((n) => {
      if (seq === previewSeq.current) setPreviewNo(n);
    });
  };

  const shellRef = useRef<MasterFullScreenHandle>(null);

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };

  // ---- open ------------------------------------------------------------------

  function openAdd() {
    setEditId(null);
    const fresh = blankForm();
    setForm(fresh);
    // Shown at once from the page's answer, then re-asked: the page may be
    // minutes old, and another IWO may have taken that number since.
    setPreviewNo(nextIwoNo);
    askPreview(fresh.iwo_date);
    setDirty(false);
    setMode("edit");
  }
  // The palette's "New work order" (`?new=1`) — and the BOM screens' own "New
  // work order" button. Declared after `openAdd`; this component has no early
  // return.
  useCreateIntent(() => {
    if (perms.canCreate) openAdd();
  });

  function openEdit(r: IwoRow) {
    setEditId(r.id);
    setForm({
      iwo_date: r.iwo_date ?? today(),
      iwo_for: isIwoFor(r.iwo_for) ? r.iwo_for : "",
      reference_no: r.reference_no ?? "",
      deli_date: r.deli_date ?? "",
      remarks: r.remarks ?? "",
    });
    setDirty(false);
    setMode("edit");
  }

  // ---- validity --------------------------------------------------------------

  const iwoFor = form.iwo_for || null;
  const editing = editId ? (rows.find((r) => r.id === editId) ?? null) : null;

  /**
   * DERIVED, never hand-assembled — Date and For, mirroring their `required`
   * props. A For changed on a work order that already has a BOM is refused by
   * the database (`iwo_for_lock`); saying so here, before Save, is the kinder
   * half.
   */
  const validity = sectionValidity({
    sections: [{ key: "header" }],
    values: form,
    fields: [
      { section: "header", id: "iwo-date", label: "Date", required: true, empty: (f) => !f.iwo_date },
      { section: "header", id: "iwo-for", label: "For", required: true, empty: (f) => !f.iwo_for },
    ],
    extra:
      editing?.bom && isIwoFor(editing.iwo_for) && form.iwo_for !== editing.iwo_for
        ? [
            {
              section: "header",
              label: "For",
              message: `This work order already has a ${bomOf(editing.iwo_for)?.label}, so its For cannot change. Delete that BOM first.`,
              kind: "custom" as const,
            },
          ]
        : [],
  });

  const revealFirstProblem = () => {
    const p = validity.first;
    if (!p) return;
    toastError(p.message);
    shellRef.current?.goToSection(p.section, p.fieldId ? { fieldId: p.fieldId } : "problem");
  };

  const payloadOf = (f: IwoFor): IwoInput => ({
    iwo_date: form.iwo_date,
    iwo_for: f,
    reference_no: form.reference_no.trim() || null,
    deli_date: form.deli_date || null,
    remarks: form.remarks.trim() || null,
  });

  function submit() {
    if (!iwoFor) return;
    const payload = payloadOf(iwoFor);
    start(async () => {
      const res = await saveInternalWorkOrder(editId, payload);
      if (res.ok) {
        success(editId ? "Work order updated" : "Work order created");
        setDirty(false);
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: IwoRow) {
    // No confirm() — <RowActions> asks in the row (LAYOUT.md §6a).
    start(async () => {
      const res = await deleteInternalWorkOrder(r.id);
      if (res.ok) {
        success("Work order deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function changeStatus(r: IwoRow, status: IwoStatus, msg: string) {
    start(async () => {
      const res = await setIwoStatus(r.id, status);
      if (res.ok) {
        success(msg);
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  /**
   * OPEN ITS BOM OR BUDGET STRAIGHT FROM HERE (user 2026-09-20: "if I choose
   * Yarn, Open Fabric BOM should work immediately — it asks me to save first").
   *
   * The BOM and budget hang off the SAVED work order (their rows carry its id),
   * so a new or edited work order is SAVED FIRST, by this button, and then the
   * screen opens — the operator never has to press Save and come back. The
   * form's own rules still apply: a missing Date or For is shown, not skipped.
   * An unchanged, saved work order just opens. The target follows For as it is
   * NOW on the form: Yarn / Fabric → IWO Fabric BOM, Accessories → IWO Material
   * BOM.
   */
  function saveThenOpen(target: "bom" | "budget") {
    if (!iwoFor) return;
    const f = iwoFor;
    const go = (id: string) =>
      router.push(target === "bom" ? bomHref(f, id) : `/orders/iwo-budgets?open=${id}`);
    if (editId && !dirty) {
      go(editId);
      return;
    }
    if (!validity.canSave) {
      revealFirstProblem();
      return;
    }
    start(async () => {
      const res = await saveInternalWorkOrder(editId, payloadOf(f));
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      setDirty(false);
      go(res.iwoId);
    });
  }

  // ---- the list ----------------------------------------------------------------

  const columns: Column<IwoRow>[] = [
    {
      header: "I.WO No",
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
    { header: "Date", cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.iwo_date)}</span> },
    {
      header: "For",
      cell: (r) => <span className="text-sm">{isIwoFor(r.iwo_for) ? IWO_FOR_LABELS[r.iwo_for] : "—"}</span>,
    },
    {
      header: "RE No",
      cell: (r) => <span className="font-mono text-xs">{r.reference_no ?? "—"}</span>,
    },
    { header: "Deli Dt", cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.deli_date)}</span> },
    {
      // Where the work order's PLAN stands — its Fabric or Material BOM.
      header: "BOM",
      cell: (r) => bomPill(r.bom),
    },
    // Where its BUDGET stands, and what it costs (0594/0595) — the Budget
    // screen's own figure (`listInternalWorkOrders` runs `budgetTotals`).
    { header: "Budget", cell: (r) => budgetPill(r.budget) },
    {
      header: "Budget Cost (INR)",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{r.budget?.cost == null ? "—" : fmtNumber(r.budget.cost)}</span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={iwoStatusTone(r.status)}>{IWO_STATUS_LABELS[r.status]}</StatusPill>
      ),
    },
    rowActionsColumn((r) => {
      // The status steps the old detail page carried as buttons live in the
      // row's ⋮, since the editor is a mode of this list.
      const menu: RowMenuItem[] = [];
      const b = isIwoFor(r.iwo_for) ? bomOf(r.iwo_for) : null;
      if (b && isIwoFor(r.iwo_for)) {
        const f = r.iwo_for;
        menu.push({ label: `Open ${b.label}`, onClick: () => router.push(bomHref(f, r.id)) });
        // The work order's budget, pulled from that BOM (0594).
        menu.push({ label: "Open Budget", onClick: () => router.push(`/orders/iwo-budgets?open=${r.id}`) });
      }
      if (perms.canEdit && r.status === "draft")
        menu.push({ label: "Issue", onClick: () => changeStatus(r, "issued", "Work order issued") });
      if (perms.canEdit && r.status === "issued")
        menu.push({
          label: "Mark complete",
          onClick: () => changeStatus(r, "completed", "Work order completed"),
        });
      if (perms.canEdit && (r.status === "draft" || r.status === "issued"))
        menu.push({
          label: "Cancel work order",
          danger: true,
          onClick: () => changeStatus(r, "cancelled", "Work order cancelled"),
        });
      return (
        <RowActions
          label={r.code}
          onEdit={() => openEdit(r)}
          canEdit={perms.canEdit}
          onDelete={() => del(r)}
          canDelete={perms.canDelete}
          isPending={isPending}
          menu={menu.length ? menu : undefined}
        />
      );
    }),
  ];

  // ---- the editor ----------------------------------------------------------------

  const code = editing?.code ?? null;
  const iwoNoShown = editId ? code : previewNo;
  const bom = bomOf(form.iwo_for);

  /**
   * ONE RAIL ROW — THE SCREEN'S OWN NAME (operator's rule 1). The header fields
   * are a section on the `<Field>` convention, and under them the one thing a
   * work order points to: its BOM.
   */
  const sections: FullScreenSection[] = [
    {
      key: "header",
      label: "Internal Work Order",
      icon: ClipboardList,
      done: !!form.iwo_date && !!form.iwo_for,
      content: (
        <SectionBody title="Internal Work Order">
          <div className={HEADER_W}>
            <FieldRow>
              {/* `Input readOnly` takes itself off the Tab path. */}
              <Field label="I.WO No" w="code" htmlFor="iwo-no">
                <Input id="iwo-no" readOnly value={iwoNoShown ?? ""} className="font-mono" />
              </Field>
              <Field label="Date" required w="code" htmlFor="iwo-date">
                <Input
                  id="iwo-date"
                  type="date"
                  value={form.iwo_date}
                  onChange={(e) => {
                    set({ iwo_date: e.target.value });
                    // The Date decides the fiscal year, so a new record's number
                    // is re-asked; a saved one keeps the number it already has.
                    if (!editId) askPreview(e.target.value);
                  }}
                />
              </Field>
              <Field label="For" required w="code" htmlFor="iwo-for">
                <Select
                  id="iwo-for"
                  value={form.iwo_for}
                  onChange={(e) => set({ iwo_for: isIwoFor(e.target.value) ? e.target.value : "" })}
                >
                  <option value=""></option>
                  {IWO_FOR.map((f) => (
                    <option key={f} value={f}>
                      {IWO_FOR_LABELS[f]}
                    </option>
                  ))}
                </Select>
              </Field>
              {/* TYPED, not picked (user 2026-09-20, 0597): a work order usually
                  comes before any buyer order, so its reference need not be an
                  RE No already in the order book. Capitals, like every value. */}
              <Field label="Reference (RE No)" w="party" htmlFor="iwo-ref">
                <Input
                  id="iwo-ref"
                  maxLength={60}
                  value={form.reference_no}
                  onChange={(e) => set({ reference_no: e.target.value })}
                />
              </Field>
              <Field label="Deli Dt" w="code" htmlFor="iwo-deli">
                <Input
                  id="iwo-deli"
                  type="date"
                  value={form.deli_date}
                  onChange={(e) => set({ deli_date: e.target.value })}
                />
              </Field>
              <Field label="Remarks" w="name" htmlFor="iwo-remarks">
                <Input
                  id="iwo-remarks"
                  value={form.remarks}
                  onChange={(e) => set({ remarks: e.target.value })}
                />
              </Field>
            </FieldRow>
          </div>

          {/* WHERE THE PLAN LIVES — the buttons follow For the moment it is
              chosen, on a new work order too; pressing one saves the work
              order first when it needs saving (`saveThenOpen`). */}
          {bom && isIwoFor(form.iwo_for) && (
              <div className="mt-4 space-y-2">
                {/* WHERE ITS PLAN STANDS — BOM, then budget (a saved one only). */}
                {editId && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{bom.label}</span>
                  {bomPill(editing?.bom ?? null)}
                  <span aria-hidden className="text-muted-foreground">→</span>
                  <span className="text-muted-foreground">Budget</span>
                  {budgetPill(editing?.budget ?? null)}
                  {editing?.budget?.cost != null && (
                    <span className="tabular-nums text-muted-foreground">₹ {fmtNumber(editing.budget.cost)}</span>
                  )}
                </div>
                )}
                <div>
                <Button type="button" variant="outline" disabled={isPending} onClick={() => saveThenOpen("bom")}>
                  Open {bom.label}
                </Button>
                {/* Its budget — the rates for the stock run (0594). */}
                <Button
                  type="button"
                  variant="outline"
                  className="ml-2"
                  disabled={isPending}
                  onClick={() => saveThenOpen("budget")}
                >
                  Open Budget
                </Button>
                </div>
                {(!editId || dirty) && (
                  <p className="text-xs text-muted-foreground">Opening it saves this work order first.</p>
                )}
              </div>
          )}
        </SectionBody>
      ),
    },
  ];

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title="Internal Work Order"
          description="Advance procurement of yarn, fabric and accessories before a buyer order exists."
          actions={
            perms.canCreate ? <Button onClick={openAdd}>New work order</Button> : undefined
          }
        />
        <DataTable
          columns={withCreatedColumns(columns, rows)}
          rows={rows}
          getKey={(r) => r.id}
          empty="No internal work orders yet."
        />
      </div>

      {/* A FULL-SCREEN TAKEOVER, not a page pane: the module sidebar beside a
          section rail is two navigation lists on one screen (operator's rule 3). */}
      <MasterFullScreen
        ref={shellRef}
        mount="overlay"
        open={mode === "edit"}
        onClose={() => setMode("list")}
        modeLabel={
          <>
            {editId ? "Editing" : "New"}{" "}
            <span className="font-semibold text-foreground">internal work order</span>
          </>
        }
        // An overlay covers the route's PageHeader, so without this band nothing
        // on screen names the record being edited.
        header={{
          initials: "IW",
          title: iwoNoShown ?? "New work order",
          badges: dirty ? (
            <span className="text-[11px] font-medium text-warning">● Unsaved</span>
          ) : null,
          meta: (
            <>
              <span>{iwoFor ? `For ${IWO_FOR_LABELS[iwoFor]}` : "For not chosen"}</span>
              {form.iwo_date && <span>· {fmtDate(form.iwo_date)}</span>}
              {form.reference_no.trim() && <span>· {form.reference_no.trim().toUpperCase()}</span>}
            </>
          ),
        }}
        sections={sections}
        footer={{
          status: dirty ? "Unsaved changes" : editId ? "All changes saved" : "New work order",
          onCancel: () => setMode("list"),
          onSave: submit,
          saveLabel: "Save work order",
          canSave: validity.canSave,
          // Keeps Save clickable when blocked, so it names the missing field and
          // steers there — and so Ctrl+S and Enter-off-the-last-field reach the
          // same handler.
          onBlockedSave: revealFirstProblem,
          isPending,
        }}
      />
    </>
  );
}
