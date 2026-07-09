"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import { createLevy, updateLevy, deleteLevy } from "@/lib/masters/levy-actions";
import {
  LEVY_TYPES,
  CESS_MODES,
  activeComponents,
  type Levy,
  type LevyType,
  type CessMode,
} from "@/lib/masters/levy-types";
import type { GlAccountForPicker } from "@/lib/finance/gl-service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type Form = {
  levy_date: string;
  type: LevyType;
  effective_from: string;
  cgst_pct: string;
  cgst_ac_head: string;
  sgst_pct: string;
  sgst_ac_head: string;
  igst_pct: string;
  igst_ac_head: string;
  cess_mode: CessMode;
  cess_value: string;
  cess_ac_head: string;
  description: string;
  blocked: boolean;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

function blankForm(): Form {
  return {
    levy_date: todayISO(),
    type: "GST Intra State",
    effective_from: todayISO(),
    cgst_pct: "0",
    cgst_ac_head: "",
    sgst_pct: "0",
    sgst_ac_head: "",
    igst_pct: "0",
    igst_ac_head: "",
    cess_mode: "percent",
    cess_value: "0",
    cess_ac_head: "",
    description: "",
    blocked: false,
  };
}

export function LevyMasterScreen({
  rows,
  accounts,
  perms,
}: {
  rows: Levy[];
  accounts: GlAccountForPicker[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(blankForm);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.type, r.description, String(r.entry_no)].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  function openAdd() {
    setEditId(null);
    setForm(blankForm());
    setOpen(true);
  }
  function openEdit(r: Levy) {
    setEditId(r.id);
    setForm({
      levy_date: r.levy_date,
      type: (LEVY_TYPES as readonly string[]).includes(r.type) ? (r.type as LevyType) : "GST Intra State",
      effective_from: r.effective_from,
      cgst_pct: String(r.cgst_pct),
      cgst_ac_head: r.cgst_ac_head ?? "",
      sgst_pct: String(r.sgst_pct),
      sgst_ac_head: r.sgst_ac_head ?? "",
      igst_pct: String(r.igst_pct),
      igst_ac_head: r.igst_ac_head ?? "",
      cess_mode: r.cess_mode,
      cess_value: String(r.cess_value),
      cess_ac_head: r.cess_ac_head ?? "",
      description: r.description ?? "",
      blocked: r.blocked,
    });
    setOpen(true);
  }

  function submit() {
    const act = activeComponents(form.type);
    const num = (s: string) => Number(s) || 0;
    // Zero out components the Type doesn't use so the record stays clean.
    const payload = {
      levy_date: form.levy_date,
      type: form.type,
      effective_from: form.effective_from,
      cgst_pct: act.cgst ? num(form.cgst_pct) : 0,
      cgst_ac_head: act.cgst ? form.cgst_ac_head || null : null,
      sgst_pct: act.sgst ? num(form.sgst_pct) : 0,
      sgst_ac_head: act.sgst ? form.sgst_ac_head || null : null,
      igst_pct: act.igst ? num(form.igst_pct) : 0,
      igst_ac_head: act.igst ? form.igst_ac_head || null : null,
      cess_mode: form.cess_mode,
      cess_value: num(form.cess_value),
      cess_ac_head: form.cess_ac_head || null,
      description: form.description.trim() || null,
      blocked: form.blocked,
    };
    startTransition(async () => {
      const res = editId ? await updateLevy(editId, payload) : await createLevy(payload);
      if (res.ok) {
        success(editId ? "Levy updated." : "Levy added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Levy) {
    startTransition(async () => {
      const res = await deleteLevy(r.id);
      if (res.ok) {
        success("Levy deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const cess = (r: Levy) =>
    r.cess_value ? (r.cess_mode === "percent" ? `${fmtNumber(r.cess_value)}%` : fmtNumber(r.cess_value)) : "—";
  const pctCell = (v: number) => (v ? `${fmtNumber(v)}%` : "—");

  const columns: Column<Levy>[] = [
    { header: "Entry", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Type", cell: (r) => <span className="text-sm">{r.type}</span> },
    { header: "Effective", cell: (r) => <span className="text-sm">{r.effective_from}</span> },
    { header: "CGST", align: "right", cell: (r) => <span className="tabular-nums text-sm">{pctCell(r.cgst_pct)}</span> },
    { header: "SGST", align: "right", cell: (r) => <span className="tabular-nums text-sm">{pctCell(r.sgst_pct)}</span> },
    { header: "IGST", align: "right", cell: (r) => <span className="tabular-nums text-sm">{pctCell(r.igst_pct)}</span> },
    { header: "Cess", align: "right", cell: (r) => <span className="tabular-nums text-sm">{cess(r)}</span> },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.blocked ? "neutral" : "success"}>{r.blocked ? "Blocked" : "Active"}</StatusPill>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {perms.canEdit && (
            <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
              Edit
            </Button>
          )}
          {perms.canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-danger"
              disabled={isPending}
              onClick={() => remove(r)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  const act = activeComponents(form.type);

  function acSelect(value: string, onChange: (v: string) => void, disabled: boolean): ReactNode {
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">— No account —</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} — {a.name}
          </option>
        ))}
      </Select>
    );
  }

  function rateRow(
    label: string,
    pctVal: string,
    onPct: (v: string) => void,
    acVal: string,
    onAc: (v: string) => void,
    enabled: boolean,
  ) {
    return (
      <div className={enabled ? "" : "opacity-50"}>
        <Label>{label}</Label>
        <div className="grid grid-cols-[90px_1fr] gap-2">
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={pctVal}
            onChange={(e) => onPct(e.target.value)}
            disabled={!enabled}
            className="text-base md:text-sm"
          />
          {acSelect(acVal, onAc, !enabled)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search levies…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Levy
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No levies yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No levies yet.
          </div>
        ) : (
          filtered.map((r) => {
            const parts = [pctCell(r.cgst_pct) !== "—" && `CGST ${pctCell(r.cgst_pct)}`, pctCell(r.sgst_pct) !== "—" && `SGST ${pctCell(r.sgst_pct)}`, pctCell(r.igst_pct) !== "—" && `IGST ${pctCell(r.igst_pct)}`, cess(r) !== "—" && `Cess ${cess(r)}`].filter(Boolean);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => perms.canEdit && openEdit(r)}
                className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-foreground">{r.type}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Entry #{r.entry_no} · from {r.effective_from}
                    </div>
                  </div>
                  <StatusPill tone={r.blocked ? "neutral" : "success"}>{r.blocked ? "Blocked" : "Active"}</StatusPill>
                </div>
                {parts.length > 0 && <div className="mt-2 text-[13px] text-muted-foreground">{parts.join(" · ")}</div>}
              </button>
            );
          })
        )}
      </div>

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Levy" : "New Levy"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label htmlFor="lv-type">Type</Label>
              <Select
                id="lv-type"
                value={form.type}
                onChange={(e) => set({ type: e.target.value as LevyType })}
              >
                {LEVY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="lv-date">Date</Label>
              <Input
                id="lv-date"
                type="date"
                value={form.levy_date}
                onChange={(e) => set({ levy_date: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="lv-eff">Effective From</Label>
              <Input
                id="lv-eff"
                type="date"
                value={form.effective_from}
                onChange={(e) => set({ effective_from: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </div>

          <div className="space-y-3 border-t border-border pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Rates &amp; account heads
            </div>
            {rateRow("CGST %", form.cgst_pct, (v) => set({ cgst_pct: v }), form.cgst_ac_head, (v) => set({ cgst_ac_head: v }), act.cgst)}
            {rateRow("SGST %", form.sgst_pct, (v) => set({ sgst_pct: v }), form.sgst_ac_head, (v) => set({ sgst_ac_head: v }), act.sgst)}
            {rateRow("IGST %", form.igst_pct, (v) => set({ igst_pct: v }), form.igst_ac_head, (v) => set({ igst_ac_head: v }), act.igst)}

            {/* Cess (always available) */}
            <div>
              <Label>Cess</Label>
              <div className="grid grid-cols-[110px_90px_1fr] gap-2">
                <Select value={form.cess_mode} onChange={(e) => set({ cess_mode: e.target.value as CessMode })}>
                  {CESS_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m === "percent" ? "Percent %" : "Amount"}
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.cess_value}
                  onChange={(e) => set({ cess_value: e.target.value })}
                  className="text-base md:text-sm"
                />
                {acSelect(form.cess_ac_head, (v) => set({ cess_ac_head: v }), false)}
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <Label htmlFor="lv-desc">Description</Label>
            <Textarea
              id="lv-desc"
              rows={2}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              className="text-base md:text-sm"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={form.blocked}
              onChange={(e) => set({ blocked: e.target.checked })}
            />
            <span className="text-sm text-foreground">Blocked (inactive)</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
