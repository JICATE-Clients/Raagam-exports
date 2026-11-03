"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldRow, FIELD_WIDTH_CSS } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { StoreBinPickCell } from "@/components/purchase/store-bin-editor";
import { DOC_BOTTOM_BAR, DOC_FRAME } from "@/components/purchase/doc-surface";
import { fmtDate, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";
import { useUnsavedGuard } from "@/lib/reload-guard";
import {
  cancelDepartmentReturn,
  postDepartmentReturn,
  saveDepartmentReturn,
} from "@/lib/stores/department-return-actions";
import {
  DEPARTMENT_RETURN_STATUS_LABELS,
  type DepartmentReturn,
  type DepartmentReturnLine,
  type ReturnableMrs,
  type ReturnableMrsLine,
} from "@/lib/stores/department-return-types";
import type { ReturnBinOption } from "@/lib/stores/department-return-service";

const BASE = "/purchase/department-returns";

type Entry = { qty: string; bin: string; lot: string };
type GridRow = ReturnableMrsLine & { key: string };

function entriesFrom(lines: DepartmentReturnLine[]): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  for (const l of lines) {
    out[l.mrs_line_id] = { qty: String(l.return_qty), bin: l.bin_id ?? "", lot: l.lot_no ?? "" };
  }
  return out;
}

/** Only what the operator typed — a line with no qty is not part of the return. */
function filled(entries: Record<string, Entry>): [string, Entry][] {
  return Object.entries(entries).filter(([, e]) => e.qty.trim() !== "" && Number(e.qty) > 0);
}

function stateKey(mrsId: string, date: string, reason: string, notes: string, entries: Record<string, Entry>) {
  const lines = filled(entries)
    .map(([k, e]) => [k, Number(e.qty), e.bin, e.lot.trim().toUpperCase()])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify([mrsId, date, reason.trim().toUpperCase(), notes.trim().toUpperCase(), lines]);
}

/**
 * DEPARTMENT RETURN — one screen for new, draft and posted (read-only).
 *
 * Pick an ISSUED requisition; its lines load with what was issued, what has already come
 * back (POSTED returns) and what is still returnable. The operator types a Return Qty on
 * the lines that come back, a Bin and Lot where known, and a mandatory Reason. Save keeps
 * a draft; Post writes the stock back (`department_return_post`, which re-checks every
 * qty with the MRS locked). Posted and cancelled returns are read-only.
 */
export function DepartmentReturnEditor({
  doc,
  lines,
  requisitions,
  bins: initialBins,
  today = "",
  canEdit,
  canPost,
}: {
  doc: DepartmentReturn | null;
  lines: DepartmentReturnLine[];
  requisitions: ReturnableMrs[];
  bins: ReturnBinOption[];
  today?: string;
  canEdit: boolean;
  canPost: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const readOnly = !canEdit || (!!doc && doc.status !== "draft");

  const [mrsId, setMrsId] = useState(doc?.material_requisition_id ?? "");
  const [returnDate, setReturnDate] = useState(doc?.return_date ?? today);
  const [reason, setReason] = useState(doc?.reason ?? "");
  const [notes, setNotes] = useState(doc?.notes ?? "");
  const [entries, setEntries] = useState<Record<string, Entry>>(() => entriesFrom(lines));
  const [bins, setBins] = useState(initialBins);
  const [baseline, setBaseline] = useState(() =>
    stateKey(doc?.material_requisition_id ?? "", doc?.return_date ?? today, doc?.reason ?? "", doc?.notes ?? "", entriesFrom(lines)),
  );
  const [confirm, setConfirm] = useState<"post" | "cancel" | null>(null);

  const current = stateKey(mrsId, returnDate, reason, notes, entries);
  const dirty = !readOnly && current !== baseline;
  useUnsavedGuard(dirty || isPending);

  const mrs = requisitions.find((m) => m.id === mrsId) ?? null;

  // Read-only: the saved lines, named from the save itself (the MRS may be fully returned).
  const savedById = useMemo(() => new Map(lines.map((l) => [l.mrs_line_id, l])), [lines]);
  const rows: GridRow[] = readOnly
    ? lines.map((l) => {
        const src = mrs?.lines.find((x) => x.mrs_line_id === l.mrs_line_id);
        return {
          key: l.mrs_line_id,
          mrs_line_id: l.mrs_line_id,
          item_id: l.item_id,
          item_name: src?.item_name ?? l.item_name ?? "—",
          item_code: src?.item_code ?? null,
          issued_qty: src?.issued_qty ?? 0,
          returned_qty: src?.returned_qty ?? 0,
          returnable_qty: src?.returnable_qty ?? 0,
        };
      })
    : (mrs?.lines ?? []).map((l) => ({ ...l, key: l.mrs_line_id }));

  const overBy = (r: GridRow): boolean => {
    const q = Number(entries[r.mrs_line_id]?.qty ?? "");
    return Number.isFinite(q) && q > r.returnable_qty + 1e-9;
  };
  const anyOver = !readOnly && rows.some(overBy);
  const lineCount = filled(entries).length;
  const canSave = !readOnly && !!mrsId && !!returnDate && !!reason.trim() && lineCount > 0 && !anyOver;

  function setEntry(id: string, patch: Partial<Entry>) {
    setEntries((m) => ({ ...m, [id]: { ...(m[id] ?? { qty: "", bin: "", lot: "" }), ...patch } }));
  }

  function pickMrs(id: string) {
    setMrsId(id);
    setEntries({});
  }

  function save() {
    if (!canSave) return;
    start(async () => {
      const res = await saveDepartmentReturn(doc?.id ?? null, {
        material_requisition_id: mrsId,
        return_date: returnDate,
        reason,
        notes: notes.trim() || null,
        lines: filled(entries).map(([id, e]) => ({
          mrs_line_id: id,
          return_qty: Number(e.qty),
          bin_id: e.bin || null,
          lot_no: e.lot.trim() || null,
        })),
      });
      if (!res.ok) return toastError(res.error);
      success("Department return saved");
      setBaseline(current);
      if (!doc) router.replace(`${BASE}/${res.id}`);
      else router.refresh();
    });
  }

  function post() {
    if (!doc) return;
    start(async () => {
      const res = await postDepartmentReturn(doc.id);
      setConfirm(null);
      if (!res.ok) return toastError(res.error);
      success("Posted — the material is back in the store");
      router.refresh();
    });
  }

  function cancelReturn() {
    if (!doc) return;
    start(async () => {
      const res = await cancelDepartmentReturn(doc.id);
      setConfirm(null);
      if (!res.ok) return toastError(res.error);
      success("Department return cancelled");
      router.refresh();
    });
  }

  /*
   * 288 + 88 + 88 + 88 + 112 + 144 + 144 = 952, + 40 chrome (the `#`; no ✕ — `hideRemove`)
   * = 992 <= 1155 -> tableFrom="5xl".
   */
  const returnLineColumns: ChildGridColumn<GridRow>[] = [
    {
      header: "Item",
      width: FIELD_WIDTH_CSS.name,
      cell: (r) => <span className="text-sm">{r.item_name}</span>,
    },
    {
      header: "Issued",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.issued_qty)}</span>,
    },
    {
      header: "Returned",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.returned_qty)}</span>,
    },
    {
      header: "Returnable",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm font-semibold">{fmtNumber(r.returnable_qty)}</span>,
    },
    {
      header: "Return Qty",
      width: FIELD_WIDTH_CSS.range,
      align: "right",
      cell: (r) =>
        readOnly ? (
          <span className="tabular-nums text-sm font-semibold">{fmtNumber(savedById.get(r.mrs_line_id)?.return_qty ?? 0)}</span>
        ) : (
          <Input
            type="number"
            min="0"
            max={r.returnable_qty}
            step="any"
            aria-label={`Return qty for ${r.item_name}`}
            aria-invalid={overBy(r) || undefined}
            title={overBy(r) ? `At most ${fmtNumber(r.returnable_qty)} can come back` : undefined}
            disabled={r.returnable_qty <= 0}
            value={entries[r.mrs_line_id]?.qty ?? ""}
            onChange={(e) => setEntry(r.mrs_line_id, { qty: e.target.value })}
          />
        ),
    },
    {
      // GRN's one-line button (user 2026-11-03, screenshot 095545). The store is the header's
      // (the requisition's), so the button names it and the pop-up edits the bin only.
      header: "Store · Bin",
      width: FIELD_WIDTH_CSS.term,
      // pick-once: exempt -- one bin can take several returned items
      cell: (r) =>
        readOnly ? (
          <span className="text-sm">{savedById.get(r.mrs_line_id)?.bin_code ?? "—"}</span>
        ) : (
          <StoreBinPickCell
            description={r.item_name}
            parent="Return"
            stores={mrs?.store_name ? [{ id: "header", name: mrs.store_name }] : undefined}
            storeId="header"
            bins={bins}
            binId={entries[r.mrs_line_id]?.bin ?? ""}
            onBin={(v) => setEntry(r.mrs_line_id, { bin: v })}
            onBinCreated={(b) => setBins((list) => [...list, { id: b.id, code: b.code, description: null }])}
          />
        ),
    },
    {
      header: "Lot No",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) =>
        readOnly ? (
          <span className="text-sm">{savedById.get(r.mrs_line_id)?.lot_no ?? "—"}</span>
        ) : (
          <Input
            aria-label={`Lot no for ${r.item_name}`}
            value={entries[r.mrs_line_id]?.lot ?? ""}
            onChange={(e) => setEntry(r.mrs_line_id, { lot: e.target.value })}
          />
        ),
    },
  ];

  const status = doc?.status ?? "draft";
  const title = doc ? (doc.code ?? "Department Return") : "New Department Return";

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={
          doc ? `${doc.department} — against ${mrs?.code ?? "requisition"}` : "Material a department gives back against an issued requisition"
        }
        actions={doc ? <StatusPill tone={statusTone(status)}>{DEPARTMENT_RETURN_STATUS_LABELS[status]}</StatusPill> : null}
      />

      {/* 72rem: the 992px line grid plus the frame's padding. */}
      <form
        className={`${DOC_FRAME} max-w-[72rem]`}
        data-focus-scope=""
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="space-y-4 p-4">
          {/* 288 + 144 + 200 + 200 = 832 + 3 × 12 gap = 868px. */}
          <FieldRow>
            <Field label="Requisition (MRS)" required w="name">
              {readOnly || !!doc ? (
                <Input readOnly value={mrs ? `${mrs.code ?? ""} — ${mrs.department}` : "—"} />
              ) : (
                <Select value={mrsId} onChange={(e) => pickMrs(e.target.value)} required>
                  <option value=""></option>
                  {requisitions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code ?? m.id.slice(0, 8)} — {m.department}
                      {m.store_name ? ` (${m.store_name})` : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Return Date" required w="code">
              <Input type="date" value={returnDate} readOnly={readOnly} onChange={(e) => setReturnDate(e.target.value)} required />
            </Field>
            <Field label="Store" w="party">
              <Input readOnly value={mrs?.store_name ?? ""} />
            </Field>
            <Field label="Department" w="party">
              <Input readOnly value={mrs?.department ?? doc?.department ?? ""} />
            </Field>
          </FieldRow>

          {!readOnly && !doc && requisitions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No issued requisition has anything left to return. A return is raised against an MRS once it is issued.
            </p>
          ) : null}

          {rows.length > 0 ? (
            // default-row: exempt -- rows are the issued requisition's own lines; the grid cannot grow
            <ChildGrid<GridRow>
              label={readOnly ? "Returned lines" : "Enter the qty coming back on each line"}
              columns={returnLineColumns}
              rows={rows}
              tableFrom="5xl"
              flatRows
              hideAdd
              hideRemove
              keepOne={false}
              onAdd={() => false}
              onRemove={() => {}}
            />
          ) : null}
          {anyOver ? <p className="text-sm text-destructive">A return qty is more than can come back on that line.</p> : null}

          {/* 288 + 12 + 288 = 588px. */}
          <FieldRow>
            <Field label="Reason" required w="name">
              <Input value={reason} readOnly={readOnly} onChange={(e) => setReason(e.target.value)} required />
            </Field>
            <Field label="Notes" w="name">
              <Textarea rows={1} value={notes} readOnly={readOnly} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </FieldRow>

          {doc?.posted_at ? (
            <p className="text-xs text-muted-foreground">Posted {fmtDate(doc.posted_at)} — the material is back in the store.</p>
          ) : null}
        </div>

        <div className={DOC_BOTTOM_BAR} data-focus-region="footer">
          {!readOnly && doc ? (
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => setConfirm("cancel")}
              disabled={isPending}
            >
              Cancel this return
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <Link href={BASE} className={buttonClasses({ variant: "outline" })}>
              {readOnly ? "Close" : "Cancel"}
            </Link>
            {!readOnly ? (
              <Button type="submit" variant={doc && !dirty ? "outline" : "primary"} disabled={isPending || !canSave || (!!doc && !dirty)}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            ) : null}
            {!readOnly && doc && !dirty && canPost ? (
              <Button type="button" disabled={isPending || anyOver || lines.length === 0} onClick={() => setConfirm("post")}>
                Post
              </Button>
            ) : null}
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={confirm === "post"}
        title={`Post ${doc?.code ?? "this return"}?`}
        body="The returned qty goes back into the store's stock. A posted return cannot be changed."
        confirmLabel="Post"
        tone="primary"
        isPending={isPending}
        onConfirm={post}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        title={`Cancel ${doc?.code ?? "this return"}?`}
        body="Nothing has moved in stock yet. A cancelled return stays on the list, read-only."
        confirmLabel="Cancel return"
        cancelLabel="Keep"
        isPending={isPending}
        onConfirm={cancelReturn}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
