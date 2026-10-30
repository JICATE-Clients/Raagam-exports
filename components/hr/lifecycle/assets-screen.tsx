"use client";

import { PackageCheck } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field, FieldRow } from "@/components/ui/field";
import { Segmented, ToggleGroup } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { useToast } from "@/components/ui/toast";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { today } from "@/lib/calendar";
import { fmtDate, fmtMoney } from "@/lib/format";
import { deleteAsset, issueAsset, returnAsset, updateAsset } from "@/lib/hr/lifecycle-actions";
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  lifecycleLabel,
  lifecycleTone,
  type Asset,
  type AssetCategory,
} from "@/lib/hr/lifecycle-types";
import { personKey, type PersonOption } from "@/lib/hr/timeoff-types";
import { PersonCombobox } from "./shared";

/**
 * HR ▸ Team Lifecycle ▸ Assets Issued (0771). MyJKKN's "My Assets" only READ
 * another module's table and had no link to the exit; here HR issues and takes
 * back company property, and an exit's "Company assets returned" step is
 * refused while anything is still issued. A lost or damaged item carries a
 * recovery amount, which the full & final settlement picks up.
 */

type Props = {
  rows: Asset[];
  people: PersonOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

type Draft = {
  person: string;
  asset_name: string;
  category: AssetCategory;
  serial_no: string;
  issued_on: string;
  issue_condition: string;
  value: string;
  note: string;
};
type Back = { status: "returned" | "lost" | "damaged"; returned_on: string; return_condition: string; recovery_amount: string };

export function AssetsScreen({ rows, people, canCreate, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const t0 = today();

  const [scope, setScope] = useState<"issued" | "all">("issued");
  const visible = useMemo(() => (scope === "issued" ? rows.filter((r) => r.status === "issued") : rows), [rows, scope]);

  const blank = (): Draft => ({
    person: "",
    asset_name: "",
    category: "id_card",
    serial_no: "",
    issued_on: t0,
    issue_condition: "NEW",
    value: "",
    note: "",
  });

  // ── issue / edit ──
  const [editId, setEditId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Draft>(blank);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard((open && dirty) || isPending);
  const put = (patch: Partial<Draft>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };

  function openIssue() {
    setEditId(null);
    setD(blank());
    setDirty(false);
    setOpen(true);
  }
  function openEdit(a: Asset) {
    setEditId(a.id);
    setD({
      person: a.staff_id ? personKey("staff", a.staff_id) : personKey("worker", a.worker_id as string),
      asset_name: a.asset_name,
      category: a.category,
      serial_no: a.serial_no ?? "",
      issued_on: a.issued_on,
      issue_condition: a.issue_condition ?? "",
      value: a.value == null ? "" : String(a.value),
      note: a.note ?? "",
    });
    setDirty(false);
    setOpen(true);
  }
  useCreateIntent(() => openIssue());

  function save() {
    const payload = { ...d, value: d.value === "" ? null : Number(d.value) };
    startTransition(async () => {
      const r = editId ? await updateAsset(editId, payload) : await issueAsset(payload);
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setDirty(false);
      setOpen(false);
      success(editId ? "Saved" : "Asset issued");
      router.refresh();
    });
  }

  // ── return / lost ──
  const [backFor, setBackFor] = useState<Asset | null>(null);
  const [back, setBack] = useState<Back>({ status: "returned", returned_on: t0, return_condition: "", recovery_amount: "" });
  function openBack(a: Asset) {
    setBack({ status: "returned", returned_on: t0, return_condition: "", recovery_amount: a.value == null ? "" : String(a.value) });
    setBackFor(a);
  }
  function saveBack() {
    if (!backFor) return;
    const id = backFor.id;
    startTransition(async () => {
      const r = await returnAsset(id, {
        ...back,
        recovery_amount: back.status === "returned" || back.recovery_amount === "" ? null : Number(back.recovery_amount),
      });
      if (!r.ok) {
        toastError(r.error);
        return;
      }
      setBackFor(null);
      success(back.status === "returned" ? "Marked returned" : `Marked ${back.status}`);
      router.refresh();
    });
  }

  function remove(a: Asset) {
    startTransition(async () => {
      const r = await deleteAsset(a.id);
      if (!r.ok) toastError(r.error);
      else {
        success("Deleted");
        router.refresh();
      }
    });
  }

  const columns: Column<Asset>[] = [
    { header: "Code", cell: (a) => <span className="font-mono text-xs font-medium">{a.code ?? "—"}</span> },
    {
      header: "Person",
      cell: (a) => (
        <span className="text-sm">
          <span className="font-medium">{a.person_name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{a.worker_id ? "Worker" : "Staff"}</span>
        </span>
      ),
    },
    { header: "Asset", cell: (a) => <span className="text-sm">{a.asset_name}</span> },
    { header: "Category", cell: (a) => <span className="text-sm">{ASSET_CATEGORY_LABELS[a.category]}</span> },
    { header: "Serial No", cell: (a) => <span className="text-sm">{a.serial_no ?? "—"}</span> },
    { header: "Issued", cell: (a) => <span className="text-sm tabular-nums">{fmtDate(a.issued_on)}</span> },
    {
      header: "Back / Recovery",
      cell: (a) =>
        a.status === "issued" ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          <span className="text-sm tabular-nums">
            {a.returned_on ? fmtDate(a.returned_on) : "—"}
            {a.recovery_amount ? ` · ${fmtMoney(a.recovery_amount)}` : ""}
          </span>
        ),
    },
  ];
  const statusColumn: Column<Asset> = {
    header: "Status",
    cell: (a) => <StatusPill tone={lifecycleTone(a.status)}>{lifecycleLabel(a.status)}</StatusPill>,
  };
  const actions = rowActionsColumn<Asset>((a) => (
    <RowActions
      label={a.asset_name}
      view={false}
      onEdit={() => openEdit(a)}
      canEdit={canEdit}
      editDisabledReason={a.status !== "issued" ? "Already returned or written off" : undefined}
      onDelete={() => remove(a)}
      canDelete={canDelete}
      isPending={isPending}
      menu={
        canEdit && a.status === "issued"
          ? [{ label: "Take back / write off", icon: PackageCheck, onClick: () => openBack(a) }]
          : []
      }
    />
  ));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup
          label="Show"
          value={scope}
          onChange={setScope}
          options={[
            { value: "issued", label: "Still issued" },
            { value: "all", label: "All" },
          ]}
        />
        {canCreate && <Button onClick={openIssue}>+ Issue Asset</Button>}
      </div>

      <DataTable
        columns={[...withCreatedColumns(columns, visible), statusColumn, actions]}
        rows={visible}
        getKey={(a) => a.id}
        empty={scope === "issued" ? "Nothing is issued right now." : "No assets issued yet."}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit ${d.asset_name}` : "Issue an asset"}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={isPending || !d.person || !d.asset_name.trim() || !d.issued_on} onClick={save}>
              {isPending ? "Saving…" : editId ? "Save" : "Issue"}
            </Button>
          </div>
        }
      >
        {/* 288 person + 288 asset + 176 category ≈ 800px → cap 52rem */}
        <div className="max-w-[52rem] space-y-4">
          <FieldRow>
            <Field label="Person" w="name" required>
              <PersonCombobox people={people} value={d.person} onChange={(v) => put({ person: v })} disabled={!!editId} />
            </Field>
            <Field label="Category" w="term">
              <Select value={d.category} onChange={(e) => put({ category: e.target.value as AssetCategory })}>
                {ASSET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {ASSET_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Asset" w="name" required>
              <Input value={d.asset_name} onChange={(e) => put({ asset_name: e.target.value })} />
            </Field>
            <Field label="Serial / Tag No" w="term">
              <Input value={d.serial_no} onChange={(e) => put({ serial_no: e.target.value })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Issued on" w="code" required>
              <Input type="date" value={d.issued_on} onChange={(e) => put({ issued_on: e.target.value })} />
            </Field>
            <Field label="Condition" w="term">
              <Input value={d.issue_condition} onChange={(e) => put({ issue_condition: e.target.value })} />
            </Field>
            <Field label="Value (₹)" w="num">
              <Input type="number" min="0" step="0.01" value={d.value} onChange={(e) => put({ value: e.target.value })} />
            </Field>
          </FieldRow>
          <Field label="Note">
            <Input value={d.note} onChange={(e) => put({ note: e.target.value })} />
          </Field>
        </div>
      </Sheet>

      <Sheet
        open={!!backFor}
        onClose={() => setBackFor(null)}
        title={backFor ? `${backFor.asset_name} — ${backFor.person_name}` : "Take back"}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBackFor(null)}>
              Cancel
            </Button>
            <Button disabled={isPending || !back.returned_on} onClick={saveBack}>
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="What happened">
            <Segmented
              name="asset-back"
              value={back.status}
              onChange={(v) => setBack((b) => ({ ...b, status: v }))}
              options={[
                { value: "returned", label: "Returned" },
                { value: "damaged", label: "Damaged" },
                { value: "lost", label: "Lost" },
              ]}
            />
          </Field>
          <FieldRow>
            <Field label={back.status === "returned" ? "Returned on" : "Noted on"} w="code" required>
              <Input type="date" value={back.returned_on} onChange={(e) => setBack((b) => ({ ...b, returned_on: e.target.value }))} />
            </Field>
            {back.status !== "returned" && (
              <Field label="Recover (₹)" w="num" hint="Deducted in the full & final">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={back.recovery_amount}
                  onChange={(e) => setBack((b) => ({ ...b, recovery_amount: e.target.value }))}
                />
              </Field>
            )}
          </FieldRow>
          <Field label="Condition / note">
            <Input value={back.return_condition} onChange={(e) => setBack((b) => ({ ...b, return_condition: e.target.value }))} />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}
