"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { usePermission } from "@/lib/auth/permission-context";
import { fmtDate } from "@/lib/format";
import { createIndentApproval, approveIndent, rejectIndent, addIndentApprovalItem, deleteIndentApproval } from "@/lib/planning/indent-actions";
import { APPROVAL_TYPES } from "@/lib/planning/indent-types";
import type { IndentApprovalRow } from "@/lib/planning/indent-service";
import type { StatusTone } from "@/components/ui/status-pill";

const STATUS_TONE: Record<string, StatusTone> = { pending: "neutral", approved: "success", rejected: "danger" };

export function IndentApprovalClient({ rows }: { rows: IndentApprovalRow[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const canApprove = usePermission("planning", "approve");
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const [itemForm, setItemForm] = useState({ category_name: "", item_description: "", uom_id: "", qty: "", is_approved: "" });
  const [form, setForm] = useState({
    indent_id: "",
    approval_type: "" as string,
    remarks: "",
    items: [] as { category_name: string; item_description: string; uom_id: string; qty: string; is_approved: string }[],
  });

  function addFormItem() {
    setForm({ ...form, items: [...form.items, { category_name: "", item_description: "", uom_id: "", qty: "0", is_approved: "" }] });
  }
  function removeFormItem(i: number) { setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) }); }
  function updateFormItem(i: number, field: string, val: string) {
    setForm({ ...form, items: form.items.map((it, idx) => idx === i ? { ...it, [field]: val } : it) });
  }

  function submit() {
    startTransition(async () => {
      const res = await createIndentApproval({
        indent_id: form.indent_id,
        approval_type: form.approval_type as (typeof APPROVAL_TYPES)[number],
        remarks: form.remarks || null,
        items: form.items.map(it => ({
          category_name: it.category_name || null,
          item_description: it.item_description || null,
          uom_id: it.uom_id || null,
          qty: Number(it.qty) || 0,
          is_approved: it.is_approved === "true" ? true : it.is_approved === "false" ? false : null,
        })),
      });
      if (res.ok) { success("Created."); setOpen(false); setForm({ indent_id: "", approval_type: "", remarks: "", items: [] }); router.refresh(); }
      else error(res.error);
    });
  }

  function submitItem() {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await addIndentApprovalItem(selectedId, {
        category_name: itemForm.category_name || null,
        item_description: itemForm.item_description || null,
        uom_id: itemForm.uom_id || null,
        qty: Number(itemForm.qty) || 0,
        is_approved: itemForm.is_approved === "true" ? true : itemForm.is_approved === "false" ? false : null,
      });
      if (res.ok) { success("Item added."); setAddingItem(false); setItemForm({ category_name: "", item_description: "", uom_id: "", qty: "", is_approved: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<IndentApprovalRow>[] = [
    { header: "Indent", cell: (r) => <button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.indent_code ?? "—"}</button> },
    { header: "Type", cell: (r) => r.approval_type },
    { header: "Status", cell: (r) => <StatusPill tone={STATUS_TONE[r.approval_status] ?? "neutral"}>{r.approval_status}</StatusPill> },
    { header: "Remarks", cell: (r) => <span className="text-xs text-muted-foreground line-clamp-1">{r.remarks ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.created_at)}</span> },
    {
      header: "", align: "right", cell: (r) => (
        <div className="flex justify-end gap-1">
          {canApprove && r.approval_status === "pending" && <>
            <Button variant="ghost" size="sm" onClick={() => startTransition(async () => { const res = await approveIndent(r.id); if (res.ok) { success("Approved."); router.refresh(); } else error(res.error); })} disabled={isPending}>Approve</Button>
            <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await rejectIndent(r.id); if (res.ok) { success("Rejected."); router.refresh(); } else error(res.error); })} disabled={isPending}>Reject</Button>
          </>}
          {r.approval_status === "pending" && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deleteIndentApproval(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Approval</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No indent approvals yet." />

      {/* Child items panel */}
      {selectedId && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Items for: {rows.find(r => r.id === selectedId)?.indent_code ?? "—"}</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddingItem(!addingItem)}>{addingItem ? "Cancel" : "+ Add Item"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          </div>
          {addingItem && (
            <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
              <div><Label>Category</Label><Input className="w-24" value={itemForm.category_name} onChange={(e) => setItemForm({ ...itemForm, category_name: e.target.value })} /></div>
              <div><Label>Description</Label><Input className="w-32" value={itemForm.item_description} onChange={(e) => setItemForm({ ...itemForm, item_description: e.target.value })} /></div>
              <div><Label>UOM</Label><Input className="w-16" value={itemForm.uom_id} onChange={(e) => setItemForm({ ...itemForm, uom_id: e.target.value })} /></div>
              <div><Label>Qty</Label><Input className="w-20" type="number" value={itemForm.qty} onChange={(e) => setItemForm({ ...itemForm, qty: e.target.value })} /></div>
              <div><Label>Approved?</Label><Select className="w-20" value={itemForm.is_approved} onChange={(e) => setItemForm({ ...itemForm, is_approved: e.target.value })}><option value="">—</option><option value="true">Yes</option><option value="false">No</option></Select></div>
              <Button size="sm" disabled={isPending} onClick={submitItem}>{isPending ? "Adding…" : "Add"}</Button>
            </div>
          )}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="New Indent Approval" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending || !form.indent_id || !form.approval_type} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Header">
            <div><Label>Indent ID *</Label><Input value={form.indent_id} onChange={(e) => setForm({ ...form, indent_id: e.target.value })} placeholder="UUID" /></div>
            <div><Label>Approval Type *</Label><Select value={form.approval_type} onChange={(e) => setForm({ ...form, approval_type: e.target.value })}><option value="">Select…</option>{APPROVAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</Select></div>
            <div><Label>Remarks</Label><Input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
          </DetailSection>
          <DetailSection label="Items">
            <div className="flex justify-end mb-2"><Button type="button" variant="outline" size="sm" onClick={addFormItem}>+ Add Item</Button></div>
            {form.items.map((it, i) => (
              <div key={i} className="flex gap-2 items-end mb-2">
                <div><Label>Category</Label><Input className="w-20" value={it.category_name} onChange={(e) => updateFormItem(i, "category_name", e.target.value)} /></div>
                <div className="flex-1"><Label>Description</Label><Input value={it.item_description} onChange={(e) => updateFormItem(i, "item_description", e.target.value)} /></div>
                <div><Label>UOM</Label><Input className="w-14" value={it.uom_id} onChange={(e) => updateFormItem(i, "uom_id", e.target.value)} /></div>
                <div><Label>Qty</Label><Input className="w-16" type="number" value={it.qty} onChange={(e) => updateFormItem(i, "qty", e.target.value)} /></div>
                <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => removeFormItem(i)}>x</Button>
              </div>
            ))}
            {form.items.length === 0 && <p className="text-xs text-muted-foreground">No items. Add items to approve.</p>}
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
