"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldRow, LockScope } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { DetailSection } from "@/components/masters/detail-section";
import { MasterListShell, type ShellExtraFilter } from "@/components/masters/master-list-shell";
import type { Column } from "@/components/ui/data-table";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { fmtDateTime } from "@/lib/format";
import { isInactive } from "@/lib/masters/inactive";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { cancelRequisition, saveRequisition } from "@/lib/logistics/transport/actions";
import {
  REQUISITION_STATUSES,
  TRANSPORT_SOURCE_KINDS,
  TRANSPORT_SOURCE_KIND_LABEL,
  TRANSPORT_STATUS_LABEL,
  type OrderSourceOption,
  type PlaceOption,
  type Requisition,
  type TransportSourceKind,
} from "@/lib/logistics/transport/types";
import { TransportStatusPill, fmtKg } from "../_shared/transport-ui";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type Form = {
  source_kind: TransportSourceKind | "";
  source_id: string;
  origin_place_id: string;
  destination_place_id: string;
  material_type: string;
  material_weight_kg: string;
  /** `<input type="datetime-local">` value, the operator's LOCAL time. */
  required_dispatch_at: string;
  remarks: string;
};
type FormField = keyof Form;

// Every key blank (AGENTS.md "Editable sub-tables": a default is a value the
// operator did not choose). Order type included — RE is the commonest, and
// defaulting it would book an HO movement against an RE nobody picked.
const BLANK: Form = {
  source_kind: "",
  source_id: "",
  origin_place_id: "",
  destination_place_id: "",
  material_type: "",
  material_weight_kg: "",
  required_dispatch_at: "",
  remarks: "",
};

/** A stored timestamp as a datetime-local value in the browser's own zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Only a request no vehicle has taken yet can be changed or withdrawn. */
const isOpen = (r: Requisition) => r.status === "pending" || r.status === "pooled";

const STATUS_FILTER: ShellExtraFilter<Requisition> = {
  key: "status",
  label: "Status",
  options: REQUISITION_STATUSES.map((s) => ({ value: s, label: TRANSPORT_STATUS_LABEL[s] })),
  predicate: (r, v) => r.status === v,
};
const KIND_FILTER: ShellExtraFilter<Requisition> = {
  key: "kind",
  label: "Order Type",
  options: TRANSPORT_SOURCE_KINDS.map((k) => ({ value: k, label: TRANSPORT_SOURCE_KIND_LABEL[k] })),
  predicate: (r, v) => r.source_kind === v,
};

/**
 * Logistics ▸ Transport ▸ Trip Requests — the booking that replaces a WhatsApp
 * message (spec §1). Modelled on Admin ▸ Permission Overrides: `MasterListShell`
 * register (icons, no ⋮) + one `Sheet` editor, laid out with `FieldRow` +
 * `<Field w>` steps.
 *
 * THE ORDER IS A PAIR, NOT AN ID (plan D2): Order Type picks the table (RE ·
 * IWO · SWO, the same three Raise PO lists) and Order picks the row; HO is a
 * movement charged to no order, so its Order box is not asked for.
 *
 * Every mandatory field is declared once with `required` — the star, the cursor
 * hold and the Save gate all come from it. The server's `requisitionInput`
 * repeats every rule; the messages here only arrive sooner, under the field.
 */
export function RequestsScreen({
  rows,
  perms,
  orders,
  places,
}: {
  rows: Requisition[];
  perms: Perms;
  orders: OrderSourceOption[];
  places: PlaceOption[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Requisition | null>(null);
  const [form, setForm] = useState<Form>(BLANK);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});

  // AGENTS.md "Auto-reload guard" — keyed on real edits, never on the sheet
  // being open, so an untouched form does not pin the silent update off.
  useUnsavedGuard((open && dirty) || isPending);

  const locked = !!editing && !isOpen(editing);

  // AGENTS.md "Disabled rows": a retired place is not offered, but the one the
  // request already holds stays on the field (greyed in the label) so an edit
  // does not blank it.
  const placeOptions = useMemo(
    () =>
      places
        .filter((p) => !isInactive(p) || p.id === form.origin_place_id || p.id === form.destination_place_id)
        .map((p) => ({ value: p.id, label: isInactive(p) ? `${p.name} (inactive)` : p.name, disabled: isInactive(p) })),
    [places, form.origin_place_id, form.destination_place_id],
  );
  const orderOptions = useMemo(
    () =>
      form.source_kind && form.source_kind !== "ho"
        ? orders
            .filter((o) => o.source_kind === form.source_kind)
            .map((o) => ({ value: o.source_id, label: o.source_no, sublabel: o.customer ?? undefined }))
        : [],
    [orders, form.source_kind],
  );

  function set<K extends FormField>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setDirty(true);
  }

  function openAdd() {
    setEditing(null);
    setForm(BLANK);
    setErrors({});
    setDirty(false);
    setOpen(true);
  }
  function openEdit(r: Requisition) {
    setEditing(r);
    setForm({
      source_kind: r.source_kind,
      source_id: r.source_id ?? "",
      origin_place_id: r.origin_place_id,
      destination_place_id: r.destination_place_id,
      material_type: r.material_type,
      material_weight_kg: String(r.material_weight_kg),
      required_dispatch_at: toLocalInput(r.required_dispatch_at),
      remarks: r.remarks ?? "",
    });
    setErrors({});
    setDirty(false);
    setOpen(true);
  }

  const needsOrder = !!form.source_kind && form.source_kind !== "ho";
  const kg = Number(form.material_weight_kg);

  function problems(): Partial<Record<FormField, string>> {
    return {
      source_kind: form.source_kind ? undefined : "Pick the order type",
      source_id: needsOrder && !form.source_id ? "Pick the order this movement is for" : undefined,
      origin_place_id: form.origin_place_id ? undefined : "Pick where the material is collected",
      destination_place_id: !form.destination_place_id
        ? "Pick where it is going"
        : form.destination_place_id === form.origin_place_id
          ? "From and To are the same place"
          : undefined,
      material_type: form.material_type.trim() ? undefined : "Say what is being moved",
      material_weight_kg: form.material_weight_kg && Number.isFinite(kg) && kg > 0 ? undefined : "Weight must be more than 0 kg",
      required_dispatch_at: form.required_dispatch_at ? undefined : "Say when it must leave",
    };
  }

  function submit() {
    const next = problems();
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    const source = orders.find((o) => o.source_kind === form.source_kind && o.source_id === form.source_id);
    start(async () => {
      const res = await saveRequisition(
        {
        source_kind: form.source_kind as TransportSourceKind,
        source_id: needsOrder ? form.source_id : null,
        source_no: needsOrder ? (source?.source_no ?? null) : null,
        origin_place_id: form.origin_place_id,
        destination_place_id: form.destination_place_id,
        material_type: form.material_type,
        material_weight_kg: kg,
        // Local wall-clock → UTC at the boundary, never before.
        required_dispatch_at: new Date(form.required_dispatch_at).toISOString(),
        remarks: form.remarks,
        },
        editing?.id,
      );
      if (res.ok) {
        success(editing ? "Trip request updated" : "Trip request booked");
        setOpen(false);
        setDirty(false);
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function cancel(r: Requisition) {
    if (!window.confirm(`Cancel trip request ${r.req_no}?`)) return;
    start(async () => {
      const res = await cancelRequisition(r.id);
      if (res.ok) {
        success("Trip request cancelled");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  const columns: Column<Requisition>[] = [
    {
      header: "Request No",
      cell: (r) => (
        <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => openEdit(r)}>
          {r.req_no}
        </button>
      ),
    },
    {
      header: "Order",
      cell: (r) => (
        <span className="text-sm">{r.source_kind === "ho" ? TRANSPORT_SOURCE_KIND_LABEL.ho : (r.source_no ?? "—")}</span>
      ),
    },
    {
      header: "From → To",
      cell: (r) => <Truncated text={`${r.origin_name} → ${r.destination_name}`} className="max-w-[18rem] text-sm" />,
    },
    { header: "Material", cell: (r) => <Truncated text={r.material_type} className="max-w-[10rem] text-sm" /> },
    { header: "Weight", align: "right", cell: (r) => <span className="text-sm tabular-nums">{fmtKg(r.material_weight_kg)}</span> },
    { header: "Leaves By", cell: (r) => <span className="text-sm tabular-nums">{fmtDateTime(r.required_dispatch_at)}</span> },
    {
      header: "Trip",
      cell: (r) =>
        r.trip_id ? (
          <Link href={`/logistics/transport/trips/${r.trip_id}`} className="text-sm text-primary hover:underline">
            Open trip
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    { header: "Status", cell: (r) => <TransportStatusPill status={r.status} /> },
  ];

  return (
    <>
      <MasterListShell<Requisition>
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) =>
          [r.req_no, r.source_no, r.origin_name, r.destination_name, r.material_type, r.remarks].filter(Boolean).join(" ")
        }
        extraFilters={[STATUS_FILTER, KIND_FILTER]}
        columns={columns}
        addLabel="+ Book Trip"
        onAdd={perms.canCreate ? openAdd : undefined}
        view={false}
        actions={{
          menuAs: "icons",
          onEdit: perms.canEdit ? openEdit : undefined,
          menu: (r) =>
            // cancelRequisition is a `create` right — whoever may book may withdraw.
            perms.canCreate
              ? [{ label: "Cancel request", icon: Ban, danger: true, disabled: !isOpen(r), onClick: () => cancel(r) }]
              : [],
        }}
        rowLabel={(r) => r.req_no}
        mobile={{
          title: (r) => r.req_no,
          subtitle: (r) => `${r.origin_name} → ${r.destination_name}`,
          pill: (r) => <TransportStatusPill status={r.status} />,
          meta: (r) => `${r.material_type} · ${fmtKg(r.material_weight_kg)} · ${fmtDateTime(r.required_dispatch_at)}`,
        }}
        isPending={isPending}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        size="md"
        /* SIZED TO ITS FIELDS (user 2026-10-29, screenshot 3839: "excess blank
           field"). `md` is 1152px and the sections were capped at 656px, so half
           the card was empty. 46rem = 736px: − body px-5 and border = 694px, −
           section p-2.5 and border = 672px of field track, which holds the widest
           row (Leaves By name 288 + Material term 176 + Weight range 112 + 2 ×
           12px gap = 600px) with room to spare. */
        maxWidthClass="max-w-[46rem]"
        title={editing ? `Trip Request ${editing.req_no}` : "Book a Trip"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {!locked && (
              <Button size="md" disabled={isPending} onClick={submit}>
                {isPending ? "Saving…" : editing ? "Save request" : "Book trip"}
              </Button>
            )}
          </>
        }
      >
        {locked && editing && (
          <p className="mb-3 text-sm text-muted-foreground">
            This request is {TRANSPORT_STATUS_LABEL[editing.status].toLowerCase()} — it can no longer be changed.
          </p>
        )}
        {/* Rows (each fits the 672px track above): Order Type code 144 + Order
            name 288 · From party 200 + To party 200 · Leaves By name 288 +
            Material term 176 + Weight range 112 · Remarks, full width. The old
            41rem section cap lost its 20px of padding to the arithmetic, so the
            From / To / Leaves By row wrapped into a column. */}
        <LockScope locked={locked}>
          <DetailSection label="Order" cols={1}>
            <FieldRow align="start">
              <Field label="Order Type" required w="code" htmlFor="tr-kind" error={errors.source_kind}>
                <Select
                  id="tr-kind"
                  required
                  value={form.source_kind}
                  onChange={(e) => {
                    set("source_kind", e.target.value as TransportSourceKind | "");
                    set("source_id", "");
                  }}
                >
                  <option value=""></option>
                  {TRANSPORT_SOURCE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {TRANSPORT_SOURCE_KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              {needsOrder && (
                <Field
                  label="Order"
                  required
                  w="name"
                  htmlFor="tr-order"
                  error={errors.source_id}
                  // An empty list is a real answer (no open order of this type) — say
                  // what to do instead of leaving a picker with nothing in it.
                  hint={orderOptions.length === 0 ? "No open orders of this type — book it as HO if it isn't for an order" : undefined}
                >
                  <Combobox
                    id="tr-order"
                    required
                    options={orderOptions}
                    value={form.source_id}
                    onChange={(v) => set("source_id", v)}
                  />
                </Field>
              )}
            </FieldRow>
          </DetailSection>

          <DetailSection label="Movement" cols={1}>
            <FieldRow align="start">
              <Field label="From" required w="party" htmlFor="tr-from" error={errors.origin_place_id}>
                <Combobox
                  id="tr-from"
                  required
                  options={placeOptions}
                  value={form.origin_place_id}
                  onChange={(v) => set("origin_place_id", v)}
                />
              </Field>
              <Field label="To" required w="party" htmlFor="tr-to" error={errors.destination_place_id}>
                <Combobox
                  id="tr-to"
                  required
                  options={placeOptions}
                  value={form.destination_place_id}
                  onChange={(v) => set("destination_place_id", v)}
                />
              </Field>
            </FieldRow>
            <FieldRow align="start">
              {/* `name` (288px), not `party`: a date AND a time — at 200px the
                  time half was cut off and the box read "dd-mm-yyyy" alone. */}
              <Field label="Leaves By" required w="name" htmlFor="tr-at" error={errors.required_dispatch_at}>
                <Input
                  id="tr-at"
                  type="datetime-local"
                  value={form.required_dispatch_at}
                  onChange={(e) => set("required_dispatch_at", e.target.value)}
                />
              </Field>
              <Field label="Material Type" required w="term" htmlFor="tr-mat" error={errors.material_type}>
                <Input id="tr-mat" value={form.material_type} onChange={(e) => set("material_type", e.target.value)} />
              </Field>
              <Field label="Weight (kg)" required w="range" htmlFor="tr-kg" error={errors.material_weight_kg}>
                <Input
                  id="tr-kg"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={form.material_weight_kg}
                  onChange={(e) => set("material_weight_kg", e.target.value)}
                />
              </Field>
            </FieldRow>
            <Field label="Remarks" htmlFor="tr-remarks">
              <Textarea id="tr-remarks" rows={2} value={form.remarks} onChange={(e) => set("remarks", e.target.value)} />
            </Field>
          </DetailSection>
        </LockScope>
      </Sheet>
    </>
  );
}
