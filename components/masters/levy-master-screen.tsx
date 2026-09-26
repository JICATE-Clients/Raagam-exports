"use client";

import { deletedToast } from "@/lib/masters/delete-message";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DataTable, type Column } from "@/components/ui/data-table";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { Field, FieldRow, FIELD_WIDTH, FIELD_WIDTH_CSS, type FieldWidth } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useBlockAction } from "@/components/masters/use-block-action";
import { StatusToggle } from "@/components/ui/status-toggle";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { fmtDate, fmtNumber } from "@/lib/format";
import { createLevy, updateLevy, deleteLevy } from "@/lib/masters/levy-actions";
import { AcHeadPicker } from "@/components/masters/ac-head-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import { DetailSection } from "@/components/masters/detail-section";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
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

/**
 * WIDTHS, NOT TWELFTHS (erp-form-compact). The editor was `cols={2}` / `cols={3}`
 * sections and `1fr` tracks, so a 2-digit percent and an account head each took
 * half the sheet.
 *
 *   Header    entry 72 + type 176 + date 144 + effective 144, 3 × 12 gaps = 572
 *   Annexure  no 144 + category 176 + slno 88 + calc 144,     3 × 12 gaps = 588
 *   Rate line pct 72 + ac head 200, 8 gap = 280 (Cess: 112 + 72 + 200, 2 × 8 = 400)
 *   Duty / TDS / Excise  3 × rate 88, 2 × 12 gaps = 288
 */
const FIELD_W = {
  entry: "num", //         72px — a 1-4 digit number
  type: "term", //        176px — "GST Intra State", "EXCISE DUTY"
  date: "code", //        144px — a native date control needs ~130px
  pct: "num", //           72px — a percent
  rate: "hug", //          88px — a percent under a two-word label ("EDU on BED %")
  cess_mode: "range", //  112px — Percent % · Flat
  ac_head: "party", //    200px — picker trigger; a GL account name
  annexure_no: "code", // 144px — a short code
  category: "term", //    176px — picker trigger; a duty category
  slno: "hug", //          88px — a number under "Category Slno"
  calc: "code", //        144px — Calculated · Exempted
  gst_total: "name", //   288px — its placeholder carries the worked split example
} satisfies Record<string, FieldWidth>;

/**
 * Every card AND the footer's buttons, from ONE string. Widest row is Annexure:
 *
 *   588 row + 2 × 8 card padding (compact) + 2 × 1 border = 606
 *
 * 38.5rem (616px) leaves room for the non-compact `p-2.5` density (+4px).
 */
const FORM_W = "max-w-[38.5rem]";

/** A rate line's hand-rolled tracks, from the vocabulary rather than `1fr`. */
const RATE_TRACKS = `${FIELD_WIDTH_CSS[FIELD_W.pct]} ${FIELD_WIDTH_CSS[FIELD_W.ac_head]}`;
const CESS_TRACKS = `${FIELD_WIDTH_CSS[FIELD_W.cess_mode]} ${FIELD_WIDTH_CSS[FIELD_W.pct]} ${FIELD_WIDTH_CSS[FIELD_W.ac_head]}`;

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

// dup-check: exempt -- a levy is a DATED rate version. The same tax name at a new
// effective-from date is how a rate revision is entered (an 18% GST becoming 12%
// is a second LEVY row, not an edit of the first), so a name check here would
// refuse the only way this master is meant to be used.
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
  /** Active / Inactive from the listing's Status SWITCH (client 2026-09-26: every
   *  Materials-module Inactive switch moves out of the form, the 08-17
   *  rule). `form.inactive` still round-trips on save, so editing a
   *  blocked row does not switch it back on. */
  const { setStatus, isPending: statusPending } = useBlockAction("levy");
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

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, dateFilter } = useMasterFilter(
    rows,
    {
      searchKey: (r) => [r.type, r.description, String(r.entry_no)].filter(Boolean).join(" "),
      filters: {
        status: (r, v) => (v === "active" ? !r.inactive : v === "inactive" ? !!r.inactive : true),
        type: (r, v) => r.type === v,
        annexureCategory: (r, v) => r.annexure_category_id === v,
      },
      initialFilters: { status: "", type: "", annexureCategory: "" },
    },
  );

  const pg = usePagination(filtered);

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
        // "GST", not "Levy", everywhere the operator can read it (client
        // 2026-08-01) — see the label in lib/masters/registry.ts. The per-row
        // sheet title still names the actual structure being edited (Duty /
        // TDS / VAT …), so nothing is lost by the list-level wording.
        success(editId ? "GST updated." : "GST added.");
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
        success(deletedToast("GST", res));
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
    { header: "Date", cell: (r) => <span className="text-sm">{fmtDate(r.levy_date)}</span> },
    { header: "Type", cell: (r) => <span className="text-sm">{r.type}</span> },
    {
      header: "Description",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.description || "—"}</span>,
    },
    { header: "Effective", cell: (r) => <span className="text-sm">{fmtDate(r.effective_from)}</span> },
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
    {
      /* A SWITCH, not a pill (client 2026-09-26: "velya table la active
         inactive switch pandara mari venum"). Same `StatusToggle` the
         Country / Customer lists draw; blocking is the destructive
         direction, so it is gated on delete, as `setMasterActive` is. */
      header: "Status",
      className: "w-32",
      cell: (r) => (
        <StatusToggle
          row={r}
          label={String(r.entry_no)}
          disabled={!perms.canDelete || statusPending}
          onChange={(active) => setStatus(r, active, { label: String(r.entry_no) })}
        />
      ),
    },
    rowActionsColumn((r) => (
      <RowActions
        label={String(r.entry_no)}
        onEdit={() => openEdit(r)}
        onDelete={() => remove(r)}
        canEdit={perms.canEdit}
        canDelete={perms.canDelete}
        isPending={isPending}
      />
    )),
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
        <div className="grid gap-2" style={{ gridTemplateColumns: RATE_TRACKS }}>
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
      <DetailSection label={title} cols={1} className={FORM_W}>
        <FieldRow>
          {fields.map(([label, value, onChange], i) => (
            <Field key={label} label={label} w={FIELD_W.rate} htmlFor={`lv-rate-${i}`}>
              <Input
                id={`lv-rate-${i}`}
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="text-base md:text-sm"
              />
            </Field>
          ))}
        </FieldRow>
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
          searchPlaceholder="Search GST entries…"
          activeCount={activeCount}
          dateFilter={{
            ...dateFilter,
            onChange: (v) => {
              dateFilter.onChange(v);
              pg.setPage(1);
            },
          }}
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
              + Add GST
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={withCreatedColumns(columns, rows)} rows={pg.paged}
        paginate={false} getKey={(r) => r.id} empty="No GST entries yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No GST entries yet.
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
                      Entry #{r.entry_no} · from {fmtDate(r.effective_from)}
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
          /* `mr-auto` parks this box at the footer's left, so the buttons end
             where the cards end. Same `FORM_W`. */
          <div className={`mr-auto flex w-full ${FORM_W} items-center justify-end gap-2`}>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={isPending} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Header" cols={1} className={FORM_W}>
            <FieldRow>
              {editEntryNo != null && (
                <Field label="Entry No" w={FIELD_W.entry}>
                  <div className="flex h-9 items-center rounded-md border border-border bg-surface-muted px-3 text-sm text-muted-foreground @2xl/editor:h-8">
                    {editEntryNo}
                  </div>
                </Field>
              )}
              {/* `<Field required>` draws the star from the same declaration the
                  control's `required` holds with — the hand `*`s are gone. */}
              <Field label="Type" w={FIELD_W.type} required htmlFor="lv-type">
                {/* `levyInput.type` is a bare `z.enum` — mandatory. The hold itself
                    is inert here because this Select has no blank option, so
                    `holdEmpty` never sees an empty value; `required` is carried
                    anyway so the `*` and the schema agree, and so it starts holding
                    by itself the day someone adds a "— Select —" row. */}
                <Select
                  id="lv-type"
                  required
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
              </Field>
              <Field label="Date" w={FIELD_W.date} required htmlFor="lv-date">
                <Input
                  id="lv-date"
                  type="date"
                  // `.min(1)` in `levyInput` — see useRequiredHold.
                  required
                  value={form.levy_date}
                  onChange={(e) => set({ levy_date: e.target.value })}
                  className="text-base md:text-sm"
                />
              </Field>
              <Field label="Effective From" w={FIELD_W.date} required htmlFor="lv-eff">
                <Input
                  id="lv-eff"
                  type="date"
                  // `.min(1)` in `levyInput`.
                  required
                  value={form.effective_from}
                  onChange={(e) => set({ effective_from: e.target.value })}
                  className="text-base md:text-sm"
                />
              </Field>
            </FieldRow>
          </DetailSection>

          {isVatCstForm && (
            <DetailSection label={`${form.type} Rate`} className={FORM_W}>
              {rateRow(`${form.type} %`, form.vat_cst_pct, (v) => set({ vat_cst_pct: v }), form.vat_cst_ac_head, (v) => set({ vat_cst_ac_head: v }), true)}
            </DetailSection>
          )}

          {!isAnnexureForm && !isVatCstForm && (
            <DetailSection label="Rates & account heads" className={FORM_W}>
              {(act.cgst || act.igst) && (
                <div className="w-fit rounded-lg border border-primary/30 bg-primary/5 p-2.5">
                  <Label className="flex items-center gap-1">
                    GST % (auto-split)
                    <span
                      title={
                        act.igst
                          ? "Fills IGST directly (inter-state — no split)."
                          : "Splits evenly into CGST + SGST (intra-state). You can still override either below."
                      }
                      className="cursor-help text-muted-foreground"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </span>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder={act.igst ? "e.g. 18 → IGST 18%" : "e.g. 18 → CGST 9% + SGST 9%"}
                    value={gstTotalPct}
                    onChange={(e) => applyGstTotal(e.target.value, form.type)}
                    className={`text-base md:text-sm ${FIELD_WIDTH[FIELD_W.gst_total]}`}
                  />
                </div>
              )}
              {rateRow("CGST %", form.cgst_pct, (v) => set({ cgst_pct: v }), form.cgst_ac_head, (v) => set({ cgst_ac_head: v }), act.cgst)}
              {rateRow("SGST %", form.sgst_pct, (v) => set({ sgst_pct: v }), form.sgst_ac_head, (v) => set({ sgst_ac_head: v }), act.sgst)}
              {rateRow("IGST %", form.igst_pct, (v) => set({ igst_pct: v }), form.igst_ac_head, (v) => set({ igst_ac_head: v }), act.igst)}

              {/* Cess (always available for GST types) */}
              <div>
                <Label>Cess</Label>
                <div className="grid gap-2" style={{ gridTemplateColumns: CESS_TRACKS }}>
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
            <DetailSection label="Annexure" className={FORM_W}>
              <FieldRow>
                <Field label="Annexure No" w={FIELD_W.annexure_no} htmlFor="lv-annexure-no">
                  <Input
                    id="lv-annexure-no"
                    uppercase
                    value={form.annexure_no}
                    onChange={(e) => set({ annexure_no: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </Field>
                {/* The picker renders its own label; the Field only sizes it. */}
                <Field w={FIELD_W.category}>
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
                </Field>
                <Field label="Category Slno" w={FIELD_W.slno} htmlFor="lv-cat-sno">
                  <Input
                    id="lv-cat-sno"
                    type="number"
                    step="1"
                    value={form.annexure_category_sno}
                    onChange={(e) => set({ annexure_category_sno: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </Field>
                <Field label="Calc/Exempt" w={FIELD_W.calc} htmlFor="lv-calc">
                  <Select
                    id="lv-calc"
                    value={form.calc_exempt}
                    onChange={(e) => set({ calc_exempt: e.target.value as CalcExemptMode })}
                  >
                    {CALC_EXEMPT_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m === "calculated" ? "Calculated" : "Exempted"}
                      </option>
                    ))}
                  </Select>
                </Field>
              </FieldRow>
              {/* A `compact` picker draws no label of its own, so the Field's is it. */}
              <FieldRow>
                <Field label="Account Head" w={FIELD_W.ac_head}>
                  {acSelect(form.annexure_ac_head, (v) => set({ annexure_ac_head: v }), false)}
                </Field>
              </FieldRow>
            </DetailSection>
          )}

          {/* A sentence, so it takes the whole of FORM_W rather than a step. */}
          <DetailSection label="Description" className={FORM_W}>
            <Textarea
              id="lv-desc"
              rows={2}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              className="text-base md:text-sm"
            />
          </DetailSection>
          {/* No Inactive switch — Active / Inactive is the listing's Status switch now (`useBlockAction` above, client 2026-09-26). */}
        </div>
      </Sheet>
    </div>
  );
}
