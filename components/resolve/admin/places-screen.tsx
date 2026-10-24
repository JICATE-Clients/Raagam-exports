"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Printer, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { type Column } from "@/components/ui/data-table";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { ActiveField } from "@/components/ui/active-field";
import { DuplicateError } from "@/components/ui/duplicate-error";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { fmtDate } from "@/lib/format";
import { useDuplicateName, dupFieldProps } from "@/lib/masters/use-duplicate-check";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { activeTone } from "@/lib/ui/status-tone";
import { issueQr, savePlace, setPlaceInactive } from "@/lib/resolve/actions";
import type { PlaceKind } from "@/lib/resolve/types";
import type { PlaceRow } from "@/lib/resolve/service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type Option = { id: string; name: string; inactive?: boolean };

export const PLACE_KINDS: { value: PlaceKind; label: string }[] = [
  { value: "building", label: "Building" },
  { value: "floor", label: "Floor" },
  { value: "room", label: "Room" },
  { value: "area", label: "Area" },
  { value: "machine", label: "Machine" },
  { value: "asset", label: "Asset" },
];
const KIND_LABEL = Object.fromEntries(PLACE_KINDS.map((k) => [k.value, k.label])) as Record<PlaceKind, string>;

const blankForm = () => ({
  code: "",
  name: "",
  kind: "room" as PlaceKind,
  parent_id: "",
  caretaker_id: "",
  default_trade_id: "",
  asset_id: "",
  inactive: false,
});
type Form = ReturnType<typeof blankForm>;

/** A switched-off option is offered only while the record already holds it
 *  (AGENTS "Disabled rows"). */
function optionsOf(list: Option[], held: string, exclude?: string) {
  return list
    .filter((o) => o.id !== exclude && (!o.inactive || o.id === held))
    .map((o) => ({ value: o.id, label: o.inactive ? `${o.name} (inactive)` : o.name }));
}

function qrState(r: PlaceRow): { tone: "neutral" | "warning" | "success"; text: string } {
  if (!r.qr_token) return { tone: "neutral", text: "Not issued" };
  if (!r.qr_printed_at) return { tone: "warning", text: "Not printed" };
  return { tone: "success", text: `Printed ${fmtDate(r.qr_printed_at)}` };
}

/**
 * Resolve Hub ▸ Administration ▸ Places & QR — the rooms, machines and assets
 * a problem can be reported against, in the current unit. A place's QR token
 * is minted by the server (`rh_issue_qr`, ≥128-bit random) — never derived
 * from its code — so a sticker cannot be guessed from its neighbour's.
 * Regenerating kills the old sticker, which is the point when one is lost.
 *
 * Tick places and "Print stickers" opens the printable sheet; printing it is
 * what records `qr_printed_at`.
 */
export function PlacesScreen({
  rows,
  perms,
  people,
  trades,
  assets,
}: {
  rows: PlaceRow[];
  perms: Perms;
  people: Option[];
  trades: Option[];
  assets: Option[];
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(blankForm);
  const [dirty, setDirty] = useState(false);
  useUnsavedGuard(open && (dirty || isPending));

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const editing = editId ? rows.find((r) => r.id === editId) ?? null : null;

  const nameError = useDuplicateName({
    table: "rh_places",
    name: form.name,
    label: "name",
    excludeId: editId ?? undefined,
    enabled: open && !!form.name.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.name,
  });
  const codeError = useDuplicateName({
    table: "rh_places",
    name: form.code,
    nameColumn: "code",
    label: "code",
    excludeId: editId ?? undefined,
    enabled: open && !!form.code.trim(),
    rows,
    rowId: (r) => r.id,
    rowValue: (r) => r.code,
  });

  const placeOptions = useMemo(
    () => optionsOf(rows.map((r) => ({ id: r.id, name: r.name, inactive: r.inactive })), form.parent_id, editId ?? undefined),
    [rows, form.parent_id, editId],
  );
  const personOptions = useMemo(() => optionsOf(people, form.caretaker_id), [people, form.caretaker_id]);
  const tradeOptions = useMemo(() => optionsOf(trades, form.default_trade_id), [trades, form.default_trade_id]);
  const assetOptions = useMemo(() => optionsOf(assets, form.asset_id), [assets, form.asset_id]);

  function openAdd() {
    setEditId(null);
    setForm(blankForm());
    setDirty(false);
    setOpen(true);
  }
  function openEdit(r: PlaceRow) {
    setEditId(r.id);
    setForm({
      code: r.code,
      name: r.name,
      kind: r.kind,
      parent_id: r.parent_id ?? "",
      caretaker_id: r.caretaker_id ?? "",
      default_trade_id: r.default_trade_id ?? "",
      asset_id: r.asset_id ?? "",
      inactive: r.inactive,
    });
    setDirty(false);
    setOpen(true);
  }

  const canSave = !!form.code.trim() && !!form.name.trim() && !nameError && !codeError && !isPending;

  function submit() {
    startTransition(async () => {
      const res = await savePlace({
        id: editId ?? undefined,
        code: form.code,
        name: form.name,
        kind: form.kind,
        parent_id: form.parent_id || null,
        caretaker_id: form.caretaker_id || null,
        default_trade_id: form.default_trade_id || null,
        asset_id: form.asset_id || null,
        inactive: form.inactive,
      });
      if (res.ok) {
        success(editId ? "Place updated." : "Place added.");
        setOpen(false);
        router.refresh();
      } else error(res.error);
    });
  }

  function remove(r: PlaceRow) {
    startTransition(async () => {
      const res = await setPlaceInactive(r.id, true);
      if (res.ok) {
        success(`${r.name} switched off — its sticker stops taking reports.`);
        router.refresh();
      } else error(res.error);
    });
  }

  function regenerate(r: { id: string; name: string; qr_token: string | null }) {
    startTransition(async () => {
      const res = await issueQr(r.id);
      if (res.ok) {
        success(r.qr_token ? `New QR for ${r.name} — reprint its sticker; the old one no longer works.` : `QR issued for ${r.name}.`);
        router.refresh();
      } else error(res.error);
    });
  }

  function printStickers(selected: PlaceRow[], clear: () => void) {
    const ids = selected.filter((r) => r.qr_token).map((r) => r.id);
    if (!ids.length) {
      error("None of the ticked places has a QR yet — generate one first.");
      return;
    }
    clear();
    router.push(`/resolve/setup/places/stickers?ids=${ids.join(",")}`);
  }

  const placeColumns: Column<PlaceRow>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Name", cell: (r) => <span className="text-sm font-semibold">{r.name}</span> },
    { header: "Kind", cell: (r) => <span className="text-sm">{KIND_LABEL[r.kind] ?? r.kind}</span> },
    { header: "Inside", cell: (r) => <span className="text-sm text-muted-foreground">{r.parent_name ?? "—"}</span> },
    { header: "Caretaker", cell: (r) => <span className="text-sm">{r.caretaker_name ?? "—"}</span> },
    { header: "Default Trade", cell: (r) => <span className="text-sm">{r.default_trade_name ?? "—"}</span> },
    {
      header: "QR",
      cell: (r) => {
        const q = qrState(r);
        return <StatusPill tone={q.tone}>{q.text}</StatusPill>;
      },
    },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={activeTone(!r.inactive)}>{r.inactive ? "Inactive" : "Active"}</StatusPill>,
    },
  ];

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) => [r.code, r.name, r.parent_name, r.caretaker_name].filter(Boolean).join(" ")}
        searchPlaceholder="Search code, name, parent or caretaker…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        addLabel="+ Add Place"
        onAdd={perms.canCreate ? openAdd : undefined}
        columns={placeColumns}
        actions={{
          onEdit: openEdit,
          onDelete: remove,
          menuAs: "icons",
          menu: (r) =>
            perms.canEdit && !r.inactive
              ? [{ label: r.qr_token ? "Regenerate QR" : "Generate QR", icon: QrCode, onClick: () => regenerate(r) }]
              : [],
        }}
        bulkActions={(selected, clear) => (
          <Button size="sm" variant="outline" onClick={() => printStickers(selected, clear)}>
            <Printer aria-hidden />
            Print stickers
          </Button>
        )}
        rowLabel={(r) => r.name}
        empty="No places in this unit yet."
        mobile={{
          title: (r) => r.name,
          subtitle: (r) => r.code,
          meta: (r) => [KIND_LABEL[r.kind], r.caretaker_name, qrState(r).text].filter(Boolean).join(" · "),
          pill: (r) => <StatusPill tone={activeTone(!r.inactive)}>{r.inactive ? "Inactive" : "Active"}</StatusPill>,
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit ${editing?.name ?? "Place"}` : "New Place"}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!canSave} onClick={submit}>
              {isPending ? "Saving…" : "Save place"}
            </Button>
          </>
        }
      >
        {/* 288 name + 176 term + 144 code + 2 × 12px gap = 632px → 40rem. */}
        <div className="max-w-[40rem] space-y-4">
          <FieldRow>
            <ActiveField id="rh-place-active" active={!form.inactive} onChange={(on) => set({ inactive: !on })} isNew={!editId} />
            <Field label="Code" required w="code" htmlFor="rh-place-code">
              <Input
                id="rh-place-code"
                value={form.code}
                onChange={(e) => set({ code: e.target.value })}
                {...dupFieldProps(codeError, "rh-place-code")}
              />
              <DuplicateError error={codeError} id="rh-place-code" />
            </Field>
            <Field label="Name" required w="name" htmlFor="rh-place-name">
              <Input
                id="rh-place-name"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                {...dupFieldProps(nameError, "rh-place-name")}
              />
              <DuplicateError error={nameError} id="rh-place-name" />
            </Field>
            <Field label="Kind" required w="term" htmlFor="rh-place-kind">
              <Select id="rh-place-kind" value={form.kind} onChange={(e) => set({ kind: e.target.value as PlaceKind })}>
                {PLACE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Inside" w="name" htmlFor="rh-place-parent">
              <Combobox id="rh-place-parent" options={placeOptions} value={form.parent_id} onChange={(v) => set({ parent_id: v })} clearable />
            </Field>
            <Field label="Caretaker" w="party" htmlFor="rh-place-caretaker">
              <Combobox id="rh-place-caretaker" options={personOptions} value={form.caretaker_id} onChange={(v) => set({ caretaker_id: v })} clearable />
            </Field>
            <Field label="Default Trade" w="term" htmlFor="rh-place-trade">
              <Combobox id="rh-place-trade" options={tradeOptions} value={form.default_trade_id} onChange={(v) => set({ default_trade_id: v })} clearable />
            </Field>
            {assets.length > 0 && (
              <Field label="Asset" w="party" htmlFor="rh-place-asset">
                <Combobox id="rh-place-asset" options={assetOptions} value={form.asset_id} onChange={(v) => set({ asset_id: v })} clearable />
              </Field>
            )}
          </FieldRow>
          {editing && (
            <FieldRow>
              <Field label="QR sticker" w="party">
                <span className="flex min-h-9 items-center">
                  <StatusPill tone={qrState(editing).tone}>{qrState(editing).text}</StatusPill>
                </span>
              </Field>
              <Button variant="outline" disabled={isPending || editing.inactive} onClick={() => regenerate(editing)}>
                <QrCode aria-hidden />
                {editing.qr_token ? "Regenerate QR" : "Generate QR"}
              </Button>
            </FieldRow>
          )}
        </div>
      </Sheet>
    </div>
  );
}
