"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Printer, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { type Column } from "@/components/ui/data-table";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { ToggleGroup } from "@/components/ui/segmented";
import { Truncated } from "@/components/ui/truncated";
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

/** The chips above the list. "No sticker" is a place still taking reports whose
 *  sticker has not been printed — no QR yet, or a QR nobody has printed. */
type Chip = "all" | "nosticker" | "off";
const needsSticker = (r: PlaceRow) => !r.inactive && !r.qr_printed_at;

/** "Inside · caretaker" — the second line of a place on a phone. */
function whereWho(r: PlaceRow): string {
  return [r.parent_name ? `In ${r.parent_name}` : KIND_LABEL[r.kind], r.caretaker_name].filter(Boolean).join(" · ");
}

/**
 * Resolve Hub ▸ Administration ▸ Places & QR — the rooms, machines and assets
 * a problem can be reported against, in the current unit. A place's QR token
 * is minted by the server (`rh_issue_qr`, ≥128-bit random) — never derived
 * from its code — so a sticker cannot be guessed from its neighbour's.
 * Regenerating kills the old sticker, which is the point when one is lost.
 *
 * PRINTING IS A MODE, NOT A COLUMN (mobile redesign, 2026-10-26). "Select"
 * turns the list into tick boxes — on a phone the card itself is what you tap
 * — and the bar docked under the list carries the count and "Print stickers".
 * Before Select, the same bar says how many places are waiting for a sticker
 * and picks exactly those. Printing the sheet is what records `qr_printed_at`.
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
  const [chip, setChip] = useState<Chip>("all");
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
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

  const counts = {
    all: rows.length,
    nosticker: rows.filter(needsSticker).length,
    off: rows.filter((r) => r.inactive).length,
  };
  const shown = chip === "nosticker" ? rows.filter(needsSticker) : chip === "off" ? rows.filter((r) => r.inactive) : rows;
  /** Waiting for a sticker AND able to print one — a place with no QR needs Generate QR first. */
  const printable = rows.filter((r) => needsSticker(r) && !!r.qr_token);

  function togglePick(r: PlaceRow) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(r.id)) next.delete(r.id);
      else next.add(r.id);
      return next;
    });
  }
  function startSelect(preselect: PlaceRow[]) {
    setPicked(new Set(preselect.map((r) => r.id)));
    setSelecting(true);
  }
  function stopSelect() {
    setPicked(new Set());
    setSelecting(false);
  }

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

  function printStickers() {
    const ids = rows.filter((r) => picked.has(r.id) && r.qr_token).map((r) => r.id);
    if (!ids.length) {
      error("None of the picked places has a QR yet — generate one first.");
      return;
    }
    stopSelect();
    router.push(`/resolve/setup/places/stickers?ids=${ids.join(",")}`);
  }

  const qrPill = (r: PlaceRow) => {
    const q = qrState(r);
    return <StatusPill tone={q.tone}>{q.text}</StatusPill>;
  };

  const pickColumn: Column<PlaceRow> = {
    header: "",
    className: "w-10",
    cell: (r) => (
      <input
        type="checkbox"
        className="size-4 accent-(--primary)"
        aria-label={`Pick ${r.name}`}
        checked={picked.has(r.id)}
        onChange={() => togglePick(r)}
      />
    ),
  };
  const placeColumns: Column<PlaceRow>[] = [
    ...(selecting ? [pickColumn] : []),
    {
      header: "Place",
      cell: (r) => (
        <span className="block min-w-0">
          <Truncated text={r.name} className="text-sm font-semibold" />
          <span className="block font-mono text-xs text-muted-foreground">
            {r.code} · {KIND_LABEL[r.kind] ?? r.kind}
          </span>
        </span>
      ),
    },
    { header: "Inside", cell: (r) => <span className="text-sm text-muted-foreground">{r.parent_name ?? "—"}</span> },
    { header: "Caretaker", cell: (r) => <span className="text-sm">{r.caretaker_name ?? "—"}</span> },
    { header: "Default Trade", cell: (r) => <span className="text-sm">{r.default_trade_name ?? "—"}</span> },
    { header: "QR", cell: qrPill },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={activeTone(!r.inactive)}>{r.inactive ? "Inactive" : "Active"}</StatusPill>,
    },
  ];

  return (
    <div className="space-y-4">
      <ToggleGroup<Chip>
        label="Show"
        value={chip}
        onChange={setChip}
        options={[
          { value: "all", label: "All", count: counts.all },
          { value: "nosticker", label: "No sticker", count: counts.nosticker },
          { value: "off", label: "Switched off", count: counts.off },
        ]}
      />
      <MasterListShell
        rows={shown}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) => [r.code, r.name, r.parent_name, r.caretaker_name].filter(Boolean).join(" ")}
        searchPlaceholder="Search places, inside or caretaker…"
        statusOf={(r) => (r.inactive ? "inactive" : "active")}
        addLabel={selecting ? undefined : "+ Add Place"}
        onAdd={perms.canCreate && !selecting ? openAdd : undefined}
        toolbarExtra={
          selecting ? null : (
            <Button variant="outline" onClick={() => startSelect([])}>
              <Check aria-hidden />
              Select
            </Button>
          )
        }
        columns={placeColumns}
        view={selecting ? false : undefined}
        actions={
          selecting
            ? undefined
            : {
                onEdit: openEdit,
                onDelete: remove,
                menuAs: "icons",
                menu: (r) =>
                  perms.canEdit && !r.inactive
                    ? [{ label: r.qr_token ? "Regenerate QR" : "Generate QR", icon: QrCode, onClick: () => regenerate(r) }]
                    : [],
              }
        }
        rowLabel={(r) => r.name}
        empty={chip === "all" ? "No places in this unit yet." : "No places to show here."}
        mobile={{
          title: (r) => r.name,
          subtitle: (r) => whereWho(r) || r.code,
          meta: (r) => [r.code, r.default_trade_name].filter(Boolean).join(" · "),
          pill: (r) =>
            selecting ? (
              <span
                aria-hidden
                className={
                  picked.has(r.id)
                    ? "flex size-5 items-center justify-center rounded-md bg-primary text-primary-foreground"
                    : "block size-5 rounded-md border border-border bg-surface"
                }
              >
                {picked.has(r.id) && <Check className="size-3.5" />}
              </span>
            ) : r.inactive ? (
              <StatusPill tone={activeTone(false)}>Inactive</StatusPill>
            ) : (
              qrPill(r)
            ),
          // In Select mode the card IS the tick box: a tap picks it.
          onEdit: selecting ? togglePick : openEdit,
          onDelete: selecting ? undefined : remove,
        }}
        isPending={isPending}
      />

      {/* Docked under the list. Before Select it says how many are waiting and
          picks exactly those; while selecting it carries the count and the one
          action, so the operator never scrolls back up to print. */}
      {(selecting || printable.length > 0) && (
        <div
          role="region"
          aria-label="Print stickers"
          className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-sm"
        >
          <span className="mr-auto text-sm font-semibold">
            {selecting
              ? `${picked.size} picked`
              : `${printable.length} ${printable.length === 1 ? "place" : "places"} without a sticker`}
          </span>
          {selecting ? (
            <>
              <Button variant="ghost" onClick={stopSelect}>
                Done
              </Button>
              <Button disabled={picked.size === 0} onClick={printStickers}>
                <Printer aria-hidden />
                Print stickers
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => startSelect(printable)}>
              <Printer aria-hidden />
              Print stickers
            </Button>
          )}
        </div>
      )}

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
