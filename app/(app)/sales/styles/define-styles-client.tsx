"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/masters/filter-bar";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtNumber } from "@/lib/format";
import { createStyle, updateStyle, deleteStyle } from "@/lib/sales/actions";
import {
  FABRIC_TYPES,
  FABRIC_SUBTYPES,
  SAMPLE_TYPES,
  type SampleType,
} from "@/lib/sales/types";
import type { StyleRegisterRow } from "@/lib/sales/service";
import type { OpportunityRow } from "@/lib/sales/service";
import type { Uom } from "@/lib/masters/types";

type FabricType = (typeof FABRIC_TYPES)[number];
type FabricSubtype = (typeof FABRIC_SUBTYPES)[number];

interface Props {
  styles: StyleRegisterRow[];
  opportunities: OpportunityRow[];
  uoms: Uom[];
  perms: { canCreate: boolean; canEdit: boolean; canDelete: boolean };
}

const EMPTY = {
  opportunity_id: "",
  style_code: "",
  name: "",
  fabric_type: "" as FabricType | "",
  fabric_subtype: "" as FabricSubtype | "",
  composition: "",
  sample_type: "" as SampleType | "",
  sample_qty: "",
  unit_id: "",
  action: "",
  description: "",
};

/** Legacy "Define Styles — By Enquiry No.": a flat register of style rows across
 *  enquiries (opportunities), with an editor that ties each style to an enquiry. */
export function DefineStylesClient({ styles, opportunities, uoms, perms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [search, setSearch] = useState("");
  const [season, setSeason] = useState<"all" | string>("all");
  const [sampleType, setSampleType] = useState<"all" | SampleType>("all");
  const [fabric, setFabric] = useState<"all" | FabricType>("all");

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });

  const seasons = useMemo(
    () =>
      [...new Set(styles.map((s) => s.season).filter((v): v is string => !!v))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [styles],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return styles.filter((s) => {
      if (season !== "all" && s.season !== season) return false;
      if (sampleType !== "all" && s.sample_type !== sampleType) return false;
      if (fabric !== "all" && s.fabric_type !== fabric) return false;
      if (q) {
        const hay = [s.style_code, s.name, s.enquiry_code, s.buyer_name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [styles, search, season, sampleType, fabric]);

  const activeCount =
    (season !== "all" ? 1 : 0) +
    (sampleType !== "all" ? 1 : 0) +
    (fabric !== "all" ? 1 : 0);

  function openCreate() {
    setEditId(null);
    setForm({ ...EMPTY });
    setOpen(true);
  }

  function openEdit(s: StyleRegisterRow) {
    setEditId(s.id);
    setForm({
      opportunity_id: s.opportunity_id,
      style_code: s.style_code ?? "",
      name: s.name,
      fabric_type: s.fabric_type ?? "",
      fabric_subtype: s.fabric_subtype ?? "",
      composition: s.composition ?? "",
      sample_type: s.sample_type ?? "",
      sample_qty: s.sample_qty != null ? String(s.sample_qty) : "",
      unit_id: s.unit_id ?? "",
      action: s.action ?? "",
      description: s.description ?? "",
    });
    setOpen(true);
  }

  function save() {
    if (!form.opportunity_id || !form.name.trim()) return;
    const payload = {
      opportunity_id: form.opportunity_id,
      style_code: form.style_code || null,
      name: form.name,
      fabric_type: form.fabric_type || null,
      fabric_subtype: form.fabric_subtype || null,
      composition: form.composition || null,
      sample_type: form.sample_type || null,
      sample_qty: form.sample_qty ? Number(form.sample_qty) : null,
      unit_id: form.unit_id || null,
      action: form.action || null,
      description: form.description || null,
    };
    start(async () => {
      const res = editId
        ? await updateStyle(editId, payload)
        : await createStyle(payload);
      if (res.ok) {
        success(editId ? "Style updated." : "Style added.");
        setOpen(false);
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function remove(s: StyleRegisterRow) {
    if (!window.confirm(`Delete style "${s.name}"? This cannot be undone.`)) return;
    start(async () => {
      const res = await deleteStyle(s.id);
      if (res.ok) {
        success("Style deleted.");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  const dash = <span className="text-muted-foreground">—</span>;
  const columns: Column<StyleRegisterRow>[] = [
    { header: "Enquiry No", cell: (s) => <span className="font-mono text-xs">{s.enquiry_code ?? "—"}</span> },
    { header: "Enquiry Dt", cell: (s) => <span className="tabular-nums text-xs">{fmtDate(s.enquiry_date)}</span> },
    { header: "Customer", cell: (s) => s.buyer_name ?? dash },
    { header: "Sample Type", cell: (s) => (s.sample_type ? s.sample_type.toUpperCase() : dash) },
    { header: "Style", cell: (s) => <span className="font-mono text-xs">{s.style_code ?? "—"}</span> },
    { header: "Style Description", cell: (s) => s.name },
    { header: "Fabric", cell: (s) => (s.fabric_type ? s.fabric_type.replace("_", " ") : dash) },
    { header: "Composition", cell: (s) => s.composition ?? dash },
    { header: "Sample Qty", align: "right", cell: (s) => (s.sample_qty != null ? <span className="tabular-nums">{fmtNumber(s.sample_qty)}</span> : dash) },
    { header: "Unit", cell: (s) => s.unit_code ?? dash },
    { header: "Action", cell: (s) => s.action ?? dash },
    {
      header: "",
      align: "right",
      cell: (s) => (
        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
          {perms.canEdit && (
            <Button variant="outline" size="sm" onClick={() => openEdit(s)}>
              Edit
            </Button>
          )}
          {perms.canDelete && (
            <Button variant="outline" size="sm" onClick={() => remove(s)} disabled={isPending}>
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Define Styles"
        description="Style cards against enquiries — style, fabric, composition, sample type & qty."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/sales">
              <Button variant="outline" size="sm">
                ← Sales Pipeline
              </Button>
            </Link>
            {perms.canCreate && (
              <Button size="sm" onClick={openCreate}>
                Add Style
              </Button>
            )}
          </div>
        }
      />

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search style, description, enquiry, customer…"
        activeCount={activeCount}
        onReset={() => {
          setSeason("all");
          setSampleType("all");
          setFabric("all");
        }}
        right={`${filtered.length} of ${styles.length}`}
      >
        <div>
          <Label htmlFor="flt-season">Season</Label>
          <Select id="flt-season" value={season} onChange={(e) => setSeason(e.target.value)}>
            <option value="all">All</option>
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="flt-sample">Sample Type</Label>
          <Select
            id="flt-sample"
            value={sampleType}
            onChange={(e) => setSampleType(e.target.value as "all" | SampleType)}
          >
            <option value="all">All</option>
            {SAMPLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.toUpperCase()}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="flt-fabric">Fabric</Label>
          <Select
            id="flt-fabric"
            value={fabric}
            onChange={(e) => setFabric(e.target.value as "all" | FabricType)}
          >
            <option value="all">All</option>
            {FABRIC_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={filtered}
        getKey={(s) => s.id}
        empty="No styles defined yet. Add one against an enquiry to get started."
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Style" : "Define Style"}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={isPending || !form.opportunity_id || !form.name.trim()}
            >
              {isPending ? "Saving…" : editId ? "Save" : "Add Style"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="f-enq">Enquiry *</Label>
            <Select
              id="f-enq"
              value={form.opportunity_id}
              onChange={(e) => set("opportunity_id", e.target.value)}
            >
              <option value="">Select enquiry…</option>
              {opportunities.map((o) => (
                <option key={o.id} value={o.id}>
                  {(o.code ?? "—") +
                    (o.buyer_name ? ` · ${o.buyer_name}` : "") +
                    (o.season ? ` · ${o.season}` : "")}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="f-style">Style</Label>
              <Input
                id="f-style"
                value={form.style_code}
                onChange={(e) => set("style_code", e.target.value)}
                placeholder="e.g. PLO-001"
              />
            </div>
            <div>
              <Label htmlFor="f-sampletype">Sample Type</Label>
              <Select
                id="f-sampletype"
                value={form.sample_type}
                onChange={(e) => set("sample_type", e.target.value as SampleType | "")}
              >
                <option value="">Select…</option>
                {SAMPLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.toUpperCase()}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="f-desc">Style Description *</Label>
            <Input
              id="f-desc"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Core Polo"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="f-fabric">Fabric</Label>
              <Select
                id="f-fabric"
                value={form.fabric_type}
                onChange={(e) => set("fabric_type", e.target.value as FabricType | "")}
              >
                <option value="">Select…</option>
                {FABRIC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace("_", " ")}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="f-subtype">Fabric Subtype</Label>
              <Select
                id="f-subtype"
                value={form.fabric_subtype}
                onChange={(e) => set("fabric_subtype", e.target.value as FabricSubtype | "")}
              >
                <option value="">Select…</option>
                {FABRIC_SUBTYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace("_", " ")}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="f-composition">Composition</Label>
            <Input
              id="f-composition"
              value={form.composition}
              onChange={(e) => set("composition", e.target.value)}
              placeholder="e.g. 100% Cotton"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="f-qty">Sample Qty</Label>
              <Input
                id="f-qty"
                type="number"
                min={0}
                value={form.sample_qty}
                onChange={(e) => set("sample_qty", e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <Label htmlFor="f-unit">Unit</Label>
              <Select
                id="f-unit"
                value={form.unit_id}
                onChange={(e) => set("unit_id", e.target.value)}
              >
                <option value="">Select…</option>
                {uoms.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="f-action">Action</Label>
            <Input
              id="f-action"
              value={form.action}
              onChange={(e) => set("action", e.target.value)}
              placeholder="Legacy 'Action' value"
            />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
