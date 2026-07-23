"use client";
import { deletedToast } from "@/lib/masters/delete-message";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/masters/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { fmtNumber } from "@/lib/format";
import { createLevy, updateLevy, deleteLevy } from "@/lib/masters/levy-actions";
import { AcHeadPicker } from "@/components/masters/ac-head-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-picker";
import { DetailSection } from "@/components/masters/detail-section";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import {
  LEVY_TYPES,
  CESS_MODES,
  CALC_EXEMPT_MODES,
  activeComponents,
  isDutyType,
  isTdsType,
  isExciseDutyType,
  isVatCstType,
  usesAnnexure,
  type Levy,
  type LevyType,
  type CessMode,
  type CalcExemptMode,
} from "@/lib/masters/levy-types";
import type { GlAccountForPicker } from "@/lib/finance/gl-service";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; isSuperAdmin?: boolean; canExport?: boolean };

type Form = {
  levy_date: string;
  type: LevyType;
  effective_from: string;
  vat_cst_pct: string;
  vat_cst_ac_head: string;
  cgst_pct: string;
  cgst_ac_head: string;
  sgst_pct: string;
  sgst_ac_head: string;
  igst_pct: string;
  igst_ac_head: string;
  cess_mode: CessMode;
  cess_value: string;
  cess_ac_head: string;
  bed_pct: string;
  edu_on_bed_pct: string;
  she_on_bed_pct: string;
  tds_pct: string;
  surcharge_pct: string;
  addnl_surcharge_pct: string;
  excise_duty_pct: string;
  excise_cess_pct: string;
  excise_edu_cess_pct: string;
  annexure_category_id: string;
  annexure_category_sno: string;
  annexure_no: string;
  calc_exempt: CalcExemptMode;
  annexure_ac_head: string;
  description: string;
  inactive: boolean;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

function blankForm(): Form {
  return {
    levy_date: todayISO(),
    type: "GST Intra State",
    effective_from: todayISO(),
    vat_cst_pct: "0",
    vat_cst_ac_head: "",
    cgst_pct: "0",
    cgst_ac_head: "",
    sgst_pct: "0",
    sgst_ac_head: "",
    igst_pct: "0",
    igst_ac_head: "",
    cess_mode: "percent",
    cess_value: "0",
    cess_ac_head: "",
    bed_pct: "0",
    edu_on_bed_pct: "0",
    she_on_bed_pct: "0",
    tds_pct: "0",
    surcharge_pct: "0",
    addnl_surcharge_pct: "0",
    excise_duty_pct: "0",
    excise_cess_pct: "0",
    excise_edu_cess_pct: "0",
    annexure_category_id: "",
    annexure_category_sno: "0",
    annexure_no: "",
    calc_exempt: "calculated",
    annexure_ac_head: "",
    description: "",
    inactive: false,
  };
}

export function LevyMasterScreen({
  rows,
  accounts,
  dutyCategories,
  perms,
}: {
  rows: Levy[];
  accounts: GlAccountForPicker[];
  dutyCategories: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editEntryNo, setEditEntryNo] = useState<number | null>(null);
  const [form, setForm] = useState<Form>(blankForm);
  // Convenience entry only — not persisted. Typing a total GST% auto-splits
  // into CGST+SGST halves (Intra-state) or fills IGST (Inter-state), per the
  // client's described logic (5%→2.5/2.5, 18%→9/9, 24%→12/12). The
  // individual fields stay visible/editable afterward, matching the legacy
  // 2-3 box layout — this just saves typing the same half twice.
  const [gstTotalPct, setGstTotalPct] = useState("");

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter(
    rows,
    {
      search: (r, q) =>
        [r.type, r.description, String(r.entry_no)].filter(Boolean).join(" ").toLowerCase().includes(q),
      filters: {
        status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
        type: (r, v) => r.type === v,
        annexureCategory: (r, v) => r.annexure_category_id === v,
      },
      initialFilters: { status: "", type: "", annexureCategory: "" },
    },
  );

  const pg = usePagination(filtered, 10);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  function applyGstTotal(v: string, type: LevyType) {
    setGstTotalPct(v);
    const n = Number(v) || 0;
    const act = activeComponents(type);
    if (act.igst) {
      set({ igst_pct: v });
    } else if (act.cgst || act.sgst) {
      const half = String(n / 2);
      set({ cgst_pct: half, sgst_pct: half });
    }
  }

  function openAdd() {
    setEditId(null);
    setEditEntryNo(null);
    setForm(blankForm());
    setGstTotalPct("");
    setOpen(true);
  }
  function openEdit(r: Levy) {
    setEditId(r.id);
    setEditEntryNo(r.entry_no);
    // Infer a total for the convenience field when the stored values are
    // consistent with a clean split; otherwise leave it blank.
    if (r.type === "GST Inter State" && r.igst_pct) {
      setGstTotalPct(String(r.igst_pct));
    } else if (r.type === "GST Intra State" && r.cgst_pct && r.cgst_pct === r.sgst_pct) {
      setGstTotalPct(String(r.cgst_pct * 2));
    } else {
      setGstTotalPct("");
    }
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
      vat_cst_pct: String(r.vat_cst_pct),
      vat_cst_ac_head: r.vat_cst_ac_head ?? "",
      cess_mode: r.cess_mode,
      cess_value: String(r.cess_value),
      cess_ac_head: r.cess_ac_head ?? "",
      bed_pct: String(r.bed_pct),
      edu_on_bed_pct: String(r.edu_on_bed_pct),
      she_on_bed_pct: String(r.she_on_bed_pct),
      tds_pct: String(r.tds_pct),
      surcharge_pct: String(r.surcharge_pct),
      addnl_surcharge_pct: String(r.addnl_surcharge_pct),
      excise_duty_pct: String(r.excise_duty_pct),
      excise_cess_pct: String(r.excise_cess_pct),
      excise_edu_cess_pct: String(r.excise_edu_cess_pct),
      annexure_category_id: r.annexure_category_id ?? "",
      annexure_category_sno: r.annexure_category_sno != null ? String(r.annexure_category_sno) : "0",
      annexure_no: r.annexure_no ?? "",
      calc_exempt: r.calc_exempt,
      annexure_ac_head: r.annexure_ac_head ?? "",
      description: r.description ?? "",
      inactive: r.inactive,
    });
    setOpen(true);
  }

  function submit() {
    const act = activeComponents(form.type);
    const isDuty = isDutyType(form.type);
    const isTds = isTdsType(form.type);
    const isExcise = isExciseDutyType(form.type);
    const isAnnexure = isDuty || isTds || isExcise;
    const isVatCst = isVatCstType(form.type);
    const num = (s: string) => Number(s) || 0;
    // Zero out components the Type doesn't use so the record stays clean —
    // GST types clear Duty/TDS/Excise/VAT-CST fields; Duty/TDS/Excise clear
    // the GST/Cess/VAT-CST fields and each other's rate fields, but share
    // the Annexure + Account Head block; VAT/CST clear everything else.
    const payload = {
      levy_date: form.levy_date,
      type: form.type,
      effective_from: form.effective_from,
      vat_cst_pct: isVatCst ? num(form.vat_cst_pct) : 0,
      vat_cst_ac_head: isVatCst ? form.vat_cst_ac_head || null : null,
      cgst_pct: act.cgst ? num(form.cgst_pct) : 0,
      cgst_ac_head: act.cgst ? form.cgst_ac_head || null : null,
      sgst_pct: act.sgst ? num(form.sgst_pct) : 0,
      sgst_ac_head: act.sgst ? form.sgst_ac_head || null : null,
      igst_pct: act.igst ? num(form.igst_pct) : 0,
      igst_ac_head: act.igst ? form.igst_ac_head || null : null,
      cess_mode: form.cess_mode,
      cess_value: isAnnexure || isVatCst ? 0 : num(form.cess_value),
      cess_ac_head: isAnnexure || isVatCst ? null : form.cess_ac_head || null,
      bed_pct: isDuty ? num(form.bed_pct) : 0,
      edu_on_bed_pct: isDuty ? num(form.edu_on_bed_pct) : 0,
      she_on_bed_pct: isDuty ? num(form.she_on_bed_pct) : 0,
      tds_pct: isTds ? num(form.tds_pct) : 0,
      surcharge_pct: isTds ? num(form.surcharge_pct) : 0,
      addnl_surcharge_pct: isTds ? num(form.addnl_surcharge_pct) : 0,
      excise_duty_pct: isExcise ? num(form.excise_duty_pct) : 0,
      excise_cess_pct: isExcise ? num(form.excise_cess_pct) : 0,
      excise_edu_cess_pct: isExcise ? num(form.excise_edu_cess_pct) : 0,
      annexure_category_id: isAnnexure ? form.annexure_category_id || null : null,
      annexure_category_sno: isAnnexure ? num(form.annexure_category_sno) : null,
      annexure_no: isAnnexure ? form.annexure_no.trim() || null : null,
      calc_exempt: form.calc_exempt,
      annexure_ac_head: isAnnexure ? form.annexure_ac_head || null : null,
      description: form.description.trim() || null,
      inactive: form.inactive,
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
        success(deletedToast("Levy", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const cess = (r: Levy) =>
    r.cess_value ? (r.cess_mode === "percent" ? `${fmtNumber(r.cess_value)}%` : fmtNumber(r.cess_value)) : "—";
  const pctCell = (v: number) => (v ? `${fmtNumber(v)}%` : "—");
  const categoryLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of dutyCategories) m.set(c.id, c.name);
    return m;
  }, [dutyCategories]);

  const columns: Column<Levy>[] = [
    { header: "Entry", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Date", cell: (r) => <span className="text-sm">{r.levy_date}</span> },
    { header: "Type", cell: (r) => <span className="text-sm">{r.type}</span> },
    {
      header: "Description",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.description || "—"}</span>,
    },
    { header: "Effective", cell: (r) => <span className="text-sm">{r.effective_from}</span> },
    { header: "Annexure", cell: (r) => <span className="text-sm">{r.annexure_no || "—"}</span> },
    {
      header: "Category",
      cell: (r) => (
        <span className="text-sm">
          {r.annexure_category_id ? (categoryLabel.get(r.annexure_category_id) ?? "—") : "—"}
        </span>
      ),
    },
    {
      header: "Category Slno",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.annexure_category_sno ?? "—"}</span>,
    },
    {
      header: "Calc/Exempt",
      cell: (r) => <span className="text-sm">{r.calc_exempt === "calculated" ? "Calculated" : "Exempted"}</span>,
    },
    { header: "Created User", cell: (r) => <span className="text-sm">{r.created_by_name || "—"}</span> },
    {
      header: "Inactive",
      cell: (r) => (
        <StatusPill tone={r.inactive ? "neutral" : "success"}>{r.inactive ? "Inactive" : "Active"}</StatusPill>
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
          {perms.canDelete && <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(r)} />}
        </div>
      ),
    },
  ];

  const act = activeComponents(form.type);
  const isDutyForm = isDutyType(form.type);
  const isTdsForm = isTdsType(form.type);
  const isExciseDutyForm = isExciseDutyType(form.type);
  const isVatCstForm = isVatCstType(form.type);
  const isAnnexureForm = usesAnnexure(form.type);
  const sheetTitle = isDutyForm
    ? "Duty Structure"
    : isTdsForm
      ? "TDS Structure"
      : isExciseDutyForm
        ? "Excise Duty Structure"
        : isVatCstForm
          ? `${form.type} Structure`
          : "GST Structure";

  function acSelect(value: string, onChange: (v: string) => void, disabled: boolean): ReactNode {
    return (
      <AcHeadPicker
        accounts={accounts}
        value={value || null}
        onChange={(id) => onChange(id ?? "")}
        disabled={disabled}
        compact
      />
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

  /** Duty/TDS/Excise Duty all show 3 plain % fields under their own title —
   *  only the labels + bound values differ per type. */
  function rateFieldsBlock(title: string, fields: [string, string, (v: string) => void][]) {
    return (
      <DetailSection label={title}>
        <div className="grid grid-cols-3 gap-2">
          {fields.map(([label, value, onChange]) => (
            <div key={label}>
              <Label>{label}</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="text-base md:text-sm"
              />
            </div>
          ))}
        </div>
      </DetailSection>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar
          search={query}
          onSearch={(v) => {
            setQuery(v);
            pg.setPage(1);
          }}
          searchPlaceholder="Search levies…"
          activeCount={activeCount}
          onReset={reset}
        >
          <div>
            <Label htmlFor="lv-filter-status">Status</Label>
            <Select
              id="lv-filter-status"
              value={filterValues.status}
              onChange={(e) => {
                setFilter("status", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="lv-filter-type">Type</Label>
            <Select
              id="lv-filter-type"
              value={filterValues.type}
              onChange={(e) => {
                setFilter("type", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              {LEVY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="lv-filter-cat">Annexure Category</Label>
            <Select
              id="lv-filter-cat"
              value={filterValues.annexureCategory}
              onChange={(e) => {
                setFilter("annexureCategory", e.target.value);
                pg.setPage(1);
              }}
              className="text-base md:text-sm"
            >
              <option value="">All</option>
              {dutyCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="levies" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Levy
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No levies yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No levies yet.
          </div>
        ) : (
          pg.paged.map((r) => {
            const parts = isDutyType(r.type)
              ? [pctCell(r.bed_pct) !== "—" && `BED ${pctCell(r.bed_pct)}`, pctCell(r.edu_on_bed_pct) !== "—" && `EDU ${pctCell(r.edu_on_bed_pct)}`, pctCell(r.she_on_bed_pct) !== "—" && `SHE ${pctCell(r.she_on_bed_pct)}`].filter(Boolean)
              : isTdsType(r.type)
                ? [pctCell(r.tds_pct) !== "—" && `TDS ${pctCell(r.tds_pct)}`, pctCell(r.surcharge_pct) !== "—" && `Surcharge ${pctCell(r.surcharge_pct)}`, pctCell(r.addnl_surcharge_pct) !== "—" && `Addnl ${pctCell(r.addnl_surcharge_pct)}`].filter(Boolean)
                : isExciseDutyType(r.type)
                  ? [pctCell(r.excise_duty_pct) !== "—" && `Excise ${pctCell(r.excise_duty_pct)}`, pctCell(r.excise_cess_pct) !== "—" && `Cess ${pctCell(r.excise_cess_pct)}`, pctCell(r.excise_edu_cess_pct) !== "—" && `EDU ${pctCell(r.excise_edu_cess_pct)}`].filter(Boolean)
                  : isVatCstType(r.type)
                    ? [pctCell(r.vat_cst_pct) !== "—" && `${r.type} ${pctCell(r.vat_cst_pct)}`].filter(Boolean)
                    : [pctCell(r.cgst_pct) !== "—" && `CGST ${pctCell(r.cgst_pct)}`, pctCell(r.sgst_pct) !== "—" && `SGST ${pctCell(r.sgst_pct)}`, pctCell(r.igst_pct) !== "—" && `IGST ${pctCell(r.igst_pct)}`, cess(r) !== "—" && `Cess ${cess(r)}`].filter(Boolean);
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
                  <StatusPill tone={r.inactive ? "neutral" : "success"}>{r.inactive ? "Inactive" : "Active"}</StatusPill>
                </div>
                {r.description && <div className="mt-2 text-[13px] text-foreground">{r.description}</div>}
                {parts.length > 0 && <div className="mt-1 text-[13px] text-muted-foreground">{parts.join(" · ")}</div>}
              </button>
            );
          })
        )}
      </div>

      <PaginationBar
        page={pg.page}
        pageCount={pg.pageCount}
        total={pg.total}
        pageSize={pg.pageSize}
        onPageChange={pg.setPage}
        onPageSizeChange={pg.setPageSize}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`${editId ? "Edit" : "New"} ${sheetTitle}`}
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
          <DetailSection label="Header">
            <div className="grid grid-cols-2 gap-3">
              {editEntryNo != null && (
                <div className="col-span-2">
                  <Label>Entry No</Label>
                  <div className="flex h-9 items-center rounded-md border border-border bg-surface-muted px-3 text-sm text-muted-foreground">
                    {editEntryNo}
                  </div>
                </div>
              )}
              <div className="col-span-2">
                <Label htmlFor="lv-type">Type</Label>
                <Select
                  id="lv-type"
                  value={form.type}
                  onChange={(e) => {
                    set({ type: e.target.value as LevyType });
                    setGstTotalPct("");
                  }}
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
          </DetailSection>

          {isVatCstForm && (
            <DetailSection label={`${form.type} Rate`}>
              {rateRow(`${form.type} %`, form.vat_cst_pct, (v) => set({ vat_cst_pct: v }), form.vat_cst_ac_head, (v) => set({ vat_cst_ac_head: v }), true)}
            </DetailSection>
          )}

          {!isAnnexureForm && !isVatCstForm && (
            <DetailSection label="Rates & account heads">
              {(act.cgst || act.igst) && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5">
                  <Label>GST % (auto-split)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder={act.igst ? "e.g. 18 → IGST 18%" : "e.g. 18 → CGST 9% + SGST 9%"}
                    value={gstTotalPct}
                    onChange={(e) => applyGstTotal(e.target.value, form.type)}
                    className="text-base md:text-sm"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {act.igst
                      ? "Fills IGST directly (inter-state — no split)."
                      : "Splits evenly into CGST + SGST (intra-state). You can still override either below."}
                  </p>
                </div>
              )}
              {rateRow("CGST %", form.cgst_pct, (v) => set({ cgst_pct: v }), form.cgst_ac_head, (v) => set({ cgst_ac_head: v }), act.cgst)}
              {rateRow("SGST %", form.sgst_pct, (v) => set({ sgst_pct: v }), form.sgst_ac_head, (v) => set({ sgst_ac_head: v }), act.sgst)}
              {rateRow("IGST %", form.igst_pct, (v) => set({ igst_pct: v }), form.igst_ac_head, (v) => set({ igst_ac_head: v }), act.igst)}

              {/* Cess (always available for GST types) */}
              <div>
                <Label>Cess</Label>
                <div className="grid grid-cols-[110px_90px_1fr] gap-2">
                  <Select value={form.cess_mode} onChange={(e) => set({ cess_mode: e.target.value as CessMode })}>
                    {CESS_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m === "percent" ? "Percent %" : "Flat"}
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
            </DetailSection>
          )}

          {isDutyForm &&
            rateFieldsBlock("Duty components", [
              ["BED %", form.bed_pct, (v) => set({ bed_pct: v })],
              ["EDU on BED %", form.edu_on_bed_pct, (v) => set({ edu_on_bed_pct: v })],
              ["SHE on BED %", form.she_on_bed_pct, (v) => set({ she_on_bed_pct: v })],
            ])}

          {isTdsForm &&
            rateFieldsBlock("TDS components", [
              ["TDS %", form.tds_pct, (v) => set({ tds_pct: v })],
              ["Surcharge %", form.surcharge_pct, (v) => set({ surcharge_pct: v })],
              ["Addnl Surcharge %", form.addnl_surcharge_pct, (v) => set({ addnl_surcharge_pct: v })],
            ])}

          {isExciseDutyForm &&
            rateFieldsBlock("Excise Duty components", [
              ["Excise Duty %", form.excise_duty_pct, (v) => set({ excise_duty_pct: v })],
              ["Cess %", form.excise_cess_pct, (v) => set({ excise_cess_pct: v })],
              ["Edu. Cess %", form.excise_edu_cess_pct, (v) => set({ excise_edu_cess_pct: v })],
            ])}

          {/* Annexure — shared by Duty, TDS and Excise Duty */}
          {isAnnexureForm && (
            <DetailSection label="Annexure">
              <div>
                <Label>Annexure No</Label>
                <Input
                  placeholder="e.g. I"
                  value={form.annexure_no}
                  onChange={(e) => set({ annexure_no: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <LookupDialogPicker
                  kind="duty_category"
                  label="Category"
                  options={dutyCategories}
                  value={form.annexure_category_id}
                  onChange={(v) => set({ annexure_category_id: v })}
                  canCreate={perms.canCreate}
                  canEdit={perms.canEdit}
                  canDelete={perms.canDelete}
                  isSuperAdmin={perms.isSuperAdmin}
                  adminOnly
                />
                <div>
                  <Label>Category Slno</Label>
                  <Input
                    type="number"
                    step="1"
                    value={form.annexure_category_sno}
                    onChange={(e) => set({ annexure_category_sno: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
              </div>
              <div>
                <Label>Calc/Exempt</Label>
                <Select value={form.calc_exempt} onChange={(e) => set({ calc_exempt: e.target.value as CalcExemptMode })}>
                  {CALC_EXEMPT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m === "calculated" ? "Calculated" : "Exempted"}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account Head</div>
              {acSelect(form.annexure_ac_head, (v) => set({ annexure_ac_head: v }), false)}
            </DetailSection>
          )}

          <DetailSection label="Description">
            <Textarea
              id="lv-desc"
              rows={2}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              className="text-base md:text-sm"
            />
          </DetailSection>

          {editId && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.inactive}
                onChange={(e) => set({ inactive: e.target.checked })}
              />
              <span className="text-sm text-foreground">Inactive</span>
            </label>
          )}
        </div>
      </Sheet>
    </div>
  );
}
