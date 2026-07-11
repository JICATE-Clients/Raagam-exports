"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/ui/page-header";
import { fmtDate } from "@/lib/format";
import { CustomerPicker } from "@/components/masters/customer-picker";
import { CountryPicker } from "@/components/masters/country-picker";
import { RecordPicker } from "@/components/masters/record-picker";
import { LookupDialogPicker } from "@/components/masters/lookup-dialog-picker";
import {
  createGarmentStyle,
  updateGarmentStyle,
  deleteGarmentStyle,
} from "@/lib/orders/styles/actions";
import {
  STYLE_FOR_OPTIONS,
  SEASON_OPTIONS,
  TECH_PACK_OPTIONS,
  COMPONENT_TYPE_OPTIONS,
  RECEIPT_MODE_OPTIONS,
  styleStatusTone,
  styleStatusText,
  type GarmentStyle,
} from "@/lib/orders/styles/types";
import type { PickerRow, StyleFormData } from "@/lib/orders/styles/service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

interface Props {
  rows: GarmentStyle[];
  data: StyleFormData;
  perms: Perms;
  /** masters:create/edit — gates inline Add/Modify inside config-list pickers. */
  masterPerms: { canCreate: boolean; canEdit: boolean };
}

// ---- editable child-row shapes ----
type CoordRow = { key: string; coordinate_id: string | null; mlist_no: string };
type CompRow = {
  key: string;
  coordinate_id: string | null;
  component_id: string | null;
  structure_id: string | null;
  comp_type: string;
  trims: boolean;
  trims_category_id: string | null;
};
type SizeRow = { key: string; size_id: string | null };

type HeaderForm = {
  blocked: boolean;
  style_date: string;
  style_for: string;
  customer_id: string | null;
  approved_sample_id: string | null;
  style_name: string;
  season: string;
  style_year: string;
  article_no: string;
  style_category_id: string | null;
  style_description: string;
  tech_pack: string;
  unit_id: string | null;
  country_id: string | null;
  department_id: string | null;
  contact_id: string | null;
  customer_reference: string;
  received_date: string;
  receipt_mode: string;
  description: string;
};

const BLANK: HeaderForm = {
  blocked: false,
  style_date: "",
  style_for: "",
  customer_id: null,
  approved_sample_id: null,
  style_name: "",
  season: "",
  style_year: "",
  article_no: "",
  style_category_id: null,
  style_description: "",
  tech_pack: "",
  unit_id: null,
  country_id: null,
  department_id: null,
  contact_id: null,
  customer_reference: "",
  received_date: "",
  receipt_mode: "",
  description: "",
};

const today = () => new Date().toISOString().slice(0, 10);

export function StyleMasterScreen({ rows, data, perms, masterPerms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<HeaderForm>(BLANK);
  const [coords, setCoords] = useState<CoordRow[]>([]);
  const [comps, setComps] = useState<CompRow[]>([]);
  const [sizes, setSizes] = useState<SizeRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  // config_lookups split by kind (one query, filtered per picker)
  const { lookups } = data;
  const styleCategories = useMemo(() => lookups.filter((l) => l.kind === "style_category"), [lookups]);
  const coordinateOpts = useMemo(() => lookups.filter((l) => l.kind === "coordinate"), [lookups]);
  const componentOpts = useMemo(() => lookups.filter((l) => l.kind === "style_component"), [lookups]);
  const structureOpts = useMemo(() => lookups.filter((l) => l.kind === "structure"), [lookups]);
  const trimsCatOpts = useMemo(() => lookups.filter((l) => l.kind === "trims_category"), [lookups]);
  const sizeOpts = useMemo(() => lookups.filter((l) => l.kind === "size"), [lookups]);
  const departmentOpts = useMemo(() => lookups.filter((l) => l.kind === "department"), [lookups]);

  // Contact options depend on the chosen customer (its contact grid).
  const contactItems: PickerRow[] = useMemo(() => {
    const c = data.customers.find((x) => x.id === form.customer_id);
    return (c?.contacts ?? []).map((ct) => ({
      id: ct.id,
      code: null,
      name: ct.contact_name ?? "(unnamed contact)",
    }));
  }, [data.customers, form.customer_id]);

  const set = (patch: Partial<HeaderForm>) => setForm((f) => ({ ...f, ...patch }));

  function openAdd() {
    setEditId(null);
    setForm({ ...BLANK, style_date: today() });
    setCoords([{ key: newKey(), coordinate_id: null, mlist_no: "" }]);
    setComps([
      {
        key: newKey(),
        coordinate_id: null,
        component_id: null,
        structure_id: null,
        comp_type: "",
        trims: false,
        trims_category_id: null,
      },
    ]);
    setSizes([{ key: newKey(), size_id: null }]);
    setMode("edit");
  }

  function openEdit(r: GarmentStyle) {
    setEditId(r.id);
    setForm({
      blocked: r.blocked,
      style_date: r.style_date ?? today(),
      style_for: r.style_for ?? "",
      customer_id: r.customer_id,
      approved_sample_id: r.approved_sample_id,
      style_name: r.style_name ?? "",
      season: r.season ?? "",
      style_year: r.style_year != null ? String(r.style_year) : "",
      article_no: r.article_no ?? "",
      style_category_id: r.style_category_id,
      style_description: r.style_description ?? "",
      tech_pack: r.tech_pack ?? "",
      unit_id: r.unit_id,
      country_id: r.country_id,
      department_id: r.department_id,
      contact_id: r.contact_id,
      customer_reference: r.customer_reference ?? "",
      received_date: r.received_date ?? "",
      receipt_mode: r.receipt_mode ?? "",
      description: r.description ?? "",
    });
    setCoords(
      r.coordinates.map((c) => ({
        key: newKey(),
        coordinate_id: c.coordinate_id,
        mlist_no: c.mlist_no ?? "",
      })),
    );
    setComps(
      r.components.map((c) => ({
        key: newKey(),
        coordinate_id: c.coordinate_id,
        component_id: c.component_id,
        structure_id: c.structure_id,
        comp_type: c.comp_type ?? "",
        trims: c.trims,
        trims_category_id: c.trims_category_id,
      })),
    );
    setSizes(r.sizes.map((s) => ({ key: newKey(), size_id: s.size_id })));
    setMode("edit");
  }

  function submit(asDraft: boolean) {
    const payload = {
      blocked: form.blocked,
      style_date: form.style_date,
      style_for: form.style_for || null,
      customer_id: form.customer_id,
      approved_sample_id: form.approved_sample_id,
      style_name: form.style_name,
      season: form.season || null,
      style_year: form.style_year ? Number(form.style_year) : null,
      article_no: form.article_no || null,
      style_category_id: form.style_category_id,
      style_description: form.style_description || null,
      tech_pack: form.tech_pack || null,
      unit_id: form.unit_id,
      country_id: form.country_id,
      department_id: form.department_id,
      contact_id: form.contact_id,
      customer_reference: form.customer_reference || null,
      received_date: form.received_date || null,
      receipt_mode: form.receipt_mode || null,
      description: form.description || null,
      is_draft: asDraft,
      coordinates: coords.map((c) => ({
        sno: 0,
        coordinate_id: c.coordinate_id,
        mlist_no: c.mlist_no || null,
      })),
      components: comps.map((c) => ({
        sno: 0,
        coordinate_id: c.coordinate_id,
        component_id: c.component_id,
        structure_id: c.structure_id,
        comp_type: c.comp_type || null,
        trims: c.trims,
        trims_category_id: c.trims_category_id,
      })),
      sizes: sizes.map((s) => ({ sno: 0, size_id: s.size_id })),
    };
    start(async () => {
      const res = editId
        ? await updateGarmentStyle(editId, payload)
        : await createGarmentStyle(payload);
      if (res.ok) {
        success(editId ? "Style updated" : "Style created");
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: GarmentStyle) {
    if (!confirm(`Delete style ${r.code ?? r.style_name ?? ""}?`)) return;
    start(async () => {
      const res = await deleteGarmentStyle(r.id);
      if (res.ok) {
        success("Style deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---------------- LIST MODE ----------------
  if (mode === "list") {
    const columns: Column<GarmentStyle>[] = [
      {
        header: "Code",
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
      { header: "Style", cell: (r) => <span className="text-sm">{r.style_name ?? "—"}</span> },
      {
        header: "Customer",
        cell: (r) => <span className="text-sm">{r.customer?.name ?? "—"}</span>,
      },
      {
        header: "Season",
        cell: (r) => <span className="text-sm text-muted-foreground">{r.season ?? "—"}</span>,
      },
      {
        header: "Status",
        cell: (r) => (
          <StatusPill tone={styleStatusTone(r)}>{styleStatusText(r)}</StatusPill>
        ),
      },
      {
        header: "Created",
        align: "right",
        cell: (r) => (
          <span className="tabular-nums text-xs text-muted-foreground">
            {fmtDate(r.created_at)}
          </span>
        ),
      },
      {
        header: "",
        align: "right",
        cell: (r) => (
          <div className="flex justify-end gap-1">
            {perms.canEdit && (
              <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                Edit
              </Button>
            )}
            {perms.canDelete && (
              <Button variant="outline" size="sm" onClick={() => del(r)}>
                Delete
              </Button>
            )}
          </div>
        ),
      },
    ];

    return (
      <div className="space-y-4">
        <PageHeader
          title="Style"
          description="Garment style master — coordinates, components and sizes."
          actions={
            perms.canCreate ? <Button onClick={openAdd}>New Style</Button> : undefined
          }
        />
        <DataTable
          columns={columns}
          rows={rows}
          getKey={(r) => r.id}
          empty="No styles yet. Use 'New Style' to create the first."
        />
      </div>
    );
  }

  // ---------------- EDIT MODE ----------------
  const canSave = !!form.style_name.trim() && !!form.style_date;

  return (
    <div className="space-y-4">
      <PageHeader
        title={editId ? "Edit Style" : "New Style"}
        description="Wire each ⓘ field from stored data. Blank grid rows are ignored."
        actions={
          <Button variant="outline" size="sm" onClick={() => setMode("list")}>
            ← Back to list
          </Button>
        }
      />

      {/* Header */}
      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="st-name">Style *</Label>
            <Input
              id="st-name"
              value={form.style_name}
              onChange={(e) => set({ style_name: e.target.value })}
              placeholder="Style name"
            />
          </div>
          <div>
            <Label htmlFor="st-date">Date *</Label>
            <Input
              id="st-date"
              type="date"
              value={form.style_date}
              onChange={(e) => set({ style_date: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="st-for">For</Label>
            <Select id="st-for" value={form.style_for} onChange={(e) => set({ style_for: e.target.value })}>
              <option value="">—</option>
              {STYLE_FOR_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </div>
          <CustomerPicker
            customers={data.customers}
            value={form.customer_id}
            onChange={(id) => set({ customer_id: id, contact_id: null })}
            label="Customer"
          />
          <RecordPicker
            label="Approved Sample No"
            items={data.samples}
            value={form.approved_sample_id}
            onChange={(id) => set({ approved_sample_id: id })}
          />
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              checked={form.blocked}
              onChange={(e) => set({ blocked: e.target.checked })}
              className="h-4 w-4 rounded border-border"
            />
            Blocked
          </label>
        </CardBody>
      </Card>

      {/* General */}
      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="st-season">Season</Label>
            <Select id="st-season" value={form.season} onChange={(e) => set({ season: e.target.value })}>
              <option value="">—</option>
              {SEASON_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="st-year">Year</Label>
            <Input
              id="st-year"
              type="number"
              value={form.style_year}
              onChange={(e) => set({ style_year: e.target.value })}
              placeholder="e.g. 2026"
            />
          </div>
          <div>
            <Label htmlFor="st-article">Article No.</Label>
            <Input id="st-article" value={form.article_no} onChange={(e) => set({ article_no: e.target.value })} />
          </div>
          <LookupDialogPicker
            kind="style_category"
            label="Style Category"
            options={styleCategories}
            value={form.style_category_id}
            onChange={(id) => set({ style_category_id: id })}
            canCreate={masterPerms.canCreate}
            canEdit={masterPerms.canEdit}
          />
          <div>
            <Label htmlFor="st-tech">Tech pack</Label>
            <Select id="st-tech" value={form.tech_pack} onChange={(e) => set({ tech_pack: e.target.value })}>
              <option value="">—</option>
              {TECH_PACK_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </div>
          <RecordPicker
            label="Unit"
            items={data.uoms}
            value={form.unit_id}
            onChange={(id) => set({ unit_id: id })}
          />
          <div className="sm:col-span-2 lg:col-span-3">
            <Label htmlFor="st-styledesc">Style Description</Label>
            <Input
              id="st-styledesc"
              value={form.style_description}
              onChange={(e) => set({ style_description: e.target.value })}
            />
          </div>
          <CountryPicker
            countries={data.countries}
            value={form.country_id}
            onChange={(id) => set({ country_id: id })}
            canCreate={masterPerms.canCreate}
            canEdit={masterPerms.canEdit}
          />
          <LookupDialogPicker
            kind="department"
            label="Department"
            options={departmentOpts}
            value={form.department_id}
            onChange={(id) => set({ department_id: id })}
            canCreate={masterPerms.canCreate}
            canEdit={masterPerms.canEdit}
          />
          <RecordPicker
            label="Contact"
            items={contactItems}
            value={form.contact_id}
            onChange={(id) => set({ contact_id: id })}
          />
          <div>
            <Label htmlFor="st-custref">Customer Reference</Label>
            <Input
              id="st-custref"
              value={form.customer_reference}
              onChange={(e) => set({ customer_reference: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="st-recdate">Received Date</Label>
            <Input
              id="st-recdate"
              type="date"
              value={form.received_date}
              onChange={(e) => set({ received_date: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="st-recmode">Receipt Mode</Label>
            <Select id="st-recmode" value={form.receipt_mode} onChange={(e) => set({ receipt_mode: e.target.value })}>
              <option value="">—</option>
              {RECEIPT_MODE_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </div>
        </CardBody>
      </Card>

      {/* Coordinates grid */}
      <GridCard
        title="Coordinates"
        onAdd={() => setCoords((xs) => [...xs, { key: newKey(), coordinate_id: null, mlist_no: "" }])}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                <th className="px-3 py-1.5 text-left font-medium">Coordinate</th>
                <th className="px-3 py-1.5 text-left font-medium">M.List No</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {coords.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-0">
                  <td className="px-3 py-1">
                    <LookupDialogPicker
                      kind="coordinate"
                      label="Coordinate"
                      options={coordinateOpts}
                      value={r.coordinate_id}
                      onChange={(id) =>
                        setCoords((xs) => xs.map((x) => (x.key === r.key ? { ...x, coordinate_id: id } : x)))
                      }
                      canCreate={masterPerms.canCreate}
                      canEdit={masterPerms.canEdit}
                      compact
                    />
                  </td>
                  <td className="px-3 py-1">
                    <Input
                      value={r.mlist_no}
                      onChange={(e) =>
                        setCoords((xs) => xs.map((x) => (x.key === r.key ? { ...x, mlist_no: e.target.value } : x)))
                      }
                      className="h-8"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <RowRemove onClick={() => setCoords((xs) => xs.filter((x) => x.key !== r.key))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GridCard>

      {/* Components grid */}
      <GridCard
        title="Components"
        onAdd={() =>
          setComps((xs) => [
            ...xs,
            {
              key: newKey(),
              coordinate_id: null,
              component_id: null,
              structure_id: null,
              comp_type: "",
              trims: false,
              trims_category_id: null,
            },
          ])
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                <th className="px-2 py-1.5 text-left font-medium">Coordinate</th>
                <th className="px-2 py-1.5 text-left font-medium">Component</th>
                <th className="px-2 py-1.5 text-left font-medium">Structure</th>
                <th className="px-2 py-1.5 text-left font-medium">Type</th>
                <th className="px-2 py-1.5 text-center font-medium">Trims</th>
                <th className="px-2 py-1.5 text-left font-medium">Trims Category</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {comps.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-0">
                  <td className="px-2 py-1">
                    <LookupDialogPicker
                      kind="coordinate" label="Coordinate" options={coordinateOpts}
                      value={r.coordinate_id}
                      onChange={(id) => setComps((xs) => xs.map((x) => (x.key === r.key ? { ...x, coordinate_id: id } : x)))}
                      canCreate={masterPerms.canCreate} canEdit={masterPerms.canEdit} compact
                    />
                  </td>
                  <td className="px-2 py-1">
                    <LookupDialogPicker
                      kind="style_component" label="Component" options={componentOpts}
                      value={r.component_id}
                      onChange={(id) => setComps((xs) => xs.map((x) => (x.key === r.key ? { ...x, component_id: id } : x)))}
                      canCreate={masterPerms.canCreate} canEdit={masterPerms.canEdit} compact
                    />
                  </td>
                  <td className="px-2 py-1">
                    <LookupDialogPicker
                      kind="structure" label="Structure" options={structureOpts}
                      value={r.structure_id}
                      onChange={(id) => setComps((xs) => xs.map((x) => (x.key === r.key ? { ...x, structure_id: id } : x)))}
                      canCreate={masterPerms.canCreate} canEdit={masterPerms.canEdit} compact
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Select
                      value={r.comp_type}
                      onChange={(e) => setComps((xs) => xs.map((x) => (x.key === r.key ? { ...x, comp_type: e.target.value } : x)))}
                      className="h-8"
                    >
                      <option value="">—</option>
                      {COMPONENT_TYPE_OPTIONS.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={r.trims}
                      onChange={(e) => setComps((xs) => xs.map((x) => (x.key === r.key ? { ...x, trims: e.target.checked } : x)))}
                      className="h-4 w-4 rounded border-border"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <LookupDialogPicker
                      kind="trims_category" label="Trims Category" options={trimsCatOpts}
                      value={r.trims_category_id}
                      onChange={(id) => setComps((xs) => xs.map((x) => (x.key === r.key ? { ...x, trims_category_id: id } : x)))}
                      canCreate={masterPerms.canCreate} canEdit={masterPerms.canEdit} compact
                    />
                  </td>
                  <td className="px-2 py-1">
                    <RowRemove onClick={() => setComps((xs) => xs.filter((x) => x.key !== r.key))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GridCard>

      {/* Sizes grid */}
      <GridCard
        title="Sizes"
        onAdd={() => setSizes((xs) => [...xs, { key: newKey(), size_id: null }])}
      >
        <div className="max-w-md space-y-2">
          {sizes.map((r) => (
            <div key={r.key} className="flex items-center gap-2">
              <div className="flex-1">
                <LookupDialogPicker
                  kind="size" label="Size" options={sizeOpts}
                  value={r.size_id}
                  onChange={(id) => setSizes((xs) => xs.map((x) => (x.key === r.key ? { ...x, size_id: id } : x)))}
                  canCreate={masterPerms.canCreate} canEdit={masterPerms.canEdit} compact
                />
              </div>
              <RowRemove onClick={() => setSizes((xs) => xs.filter((x) => x.key !== r.key))} />
            </div>
          ))}
        </div>
      </GridCard>

      {/* Description */}
      <Card>
        <CardBody>
          <Label htmlFor="st-desc">Description</Label>
          <Textarea
            id="st-desc"
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            rows={3}
          />
        </CardBody>
      </Card>

      {/* Footer */}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface/95 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => setMode("list")}>
          Cancel
        </Button>
        {perms.canCreate && (
          <Button variant="outline" disabled={isPending || !canSave} onClick={() => submit(true)}>
            Save as Draft
          </Button>
        )}
        <Button disabled={isPending || !canSave} onClick={() => submit(false)}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ---------- small building blocks ----------

function GridCard({
  title,
  onAdd,
  children,
}: {
  title: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardBody>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <Button type="button" variant="subtle" size="sm" onClick={onAdd}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add row
          </Button>
        </div>
        {children}
      </CardBody>
    </Card>
  );
}

function RowRemove({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove row"
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-danger"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
