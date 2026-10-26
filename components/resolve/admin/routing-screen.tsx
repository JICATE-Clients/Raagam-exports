"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { type Column } from "@/components/ui/data-table";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { deleteRoutingOverride, saveRoutingOverride } from "@/lib/resolve/actions";
import type { RoutingOverrideRow } from "@/lib/resolve/service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type Option = { id: string; name: string; inactive?: boolean };

const blankForm = () => ({ trade_id: "", place_id: "", owner_id: "", note: "" });
type Form = ReturnType<typeof blankForm>;

function scopeWords(r: { trade_name: string | null; place_name: string | null }): string {
  if (r.place_name && r.trade_name) return `${r.trade_name} at ${r.place_name}`;
  if (r.place_name) return `Anything at ${r.place_name}`;
  return `${r.trade_name ?? "—"} anywhere in this unit`;
}

/**
 * Resolve Hub ▸ Administration ▸ Routing — routing rule 1, the explicit
 * owner. A rule names a trade, a place, or both; the most specific wins
 * (place + trade, then place, then trade) and beats the caretaker, the team
 * lead and the estate office. Rules belong to the current unit.
 *
 * created-by: the listing is a MasterListShell, which splices Created columns.
 */
export function RoutingScreen({
  rows,
  perms,
  people,
  trades,
  places,
}: {
  rows: RoutingOverrideRow[];
  perms: Perms;
  people: Option[];
  trades: Option[];
  places: Option[];
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
  const opts = (list: Option[], held: string) =>
    list.filter((o) => !o.inactive || o.id === held).map((o) => ({ value: o.id, label: o.name }));
  const tradeOptions = useMemo(() => opts(trades, form.trade_id), [trades, form.trade_id]);
  const placeOptions = useMemo(() => opts(places, form.place_id), [places, form.place_id]);
  const personOptions = useMemo(() => opts(people, form.owner_id), [people, form.owner_id]);

  // The same pair twice would make "which rule fired" a coin toss.
  const clash = rows.some(
    (r) => r.id !== editId && (r.trade_id ?? "") === form.trade_id && (r.place_id ?? "") === form.place_id,
  );
  const scoped = !!form.trade_id || !!form.place_id;
  const canSave = scoped && !!form.owner_id && !clash && !isPending;

  function openAdd() {
    setEditId(null);
    setForm(blankForm());
    setDirty(false);
    setOpen(true);
  }
  function openEdit(r: RoutingOverrideRow) {
    setEditId(r.id);
    setForm({ trade_id: r.trade_id ?? "", place_id: r.place_id ?? "", owner_id: r.owner_id, note: r.note ?? "" });
    setDirty(false);
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const res = await saveRoutingOverride({
        id: editId ?? undefined,
        trade_id: form.trade_id || null,
        place_id: form.place_id || null,
        owner_id: form.owner_id,
        note: form.note || null,
      });
      if (res.ok) {
        success(editId ? "Rule updated." : "Rule added.");
        setOpen(false);
        router.refresh();
      } else error(res.error);
    });
  }

  function remove(r: RoutingOverrideRow) {
    startTransition(async () => {
      const res = await deleteRoutingOverride(r.id);
      if (res.ok) {
        success("Rule removed — routing falls back to the caretaker, team and estate office.");
        router.refresh();
      } else error(res.error);
    });
  }

  const routingColumns: Column<RoutingOverrideRow>[] = [
    { header: "When", cell: (r) => <span className="text-sm font-semibold">{scopeWords(r)}</span> },
    { header: "Trade", cell: (r) => <span className="text-sm">{r.trade_name ?? "Any"}</span> },
    { header: "Place", cell: (r) => <span className="text-sm">{r.place_name ?? "Any"}</span> },
    { header: "Goes to", cell: (r) => <span className="text-sm">{r.owner_name ?? "—"}</span> },
    { header: "Note", cell: (r) => <span className="text-sm text-muted-foreground">{r.note ?? "—"}</span> },
  ];

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) => [r.trade_name, r.place_name, r.owner_name, r.note].filter(Boolean).join(" ")}
        searchPlaceholder="Search trade, place or owner…"
        addLabel="+ Add Rule"
        onAdd={perms.canCreate ? openAdd : undefined}
        columns={routingColumns}
        actions={{ onEdit: openEdit, onDelete: remove, menuAs: "icons" }}
        rowLabel={(r) => scopeWords(r)}
        empty="No routing rules — jobs go to the caretaker, the trade team, then the estate office."
        mobile={{
          title: (r) => scopeWords(r),
          meta: (r) => (r.owner_name ? `Goes to ${r.owner_name}` : ""),
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending}
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit routing rule" : "New routing rule"}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!canSave} onClick={submit}>
              {isPending ? "Saving…" : "Save rule"}
            </Button>
          </>
        }
      >
        {/* 176 trade + 288 place + 200 owner + 2 × 12px gap = 688px → 44rem. */}
        <div className="max-w-[44rem] space-y-4">
          <FieldRow>
            <Field label="Trade" w="term" htmlFor="rh-route-trade" error={clash ? "A rule for this trade and place already exists." : undefined}>
              <Combobox id="rh-route-trade" options={tradeOptions} value={form.trade_id} onChange={(v) => set({ trade_id: v })} clearable />
            </Field>
            <Field label="Place" w="name" htmlFor="rh-route-place" hint={scoped ? undefined : "Pick a trade, a place, or both"}>
              <Combobox id="rh-route-place" options={placeOptions} value={form.place_id} onChange={(v) => set({ place_id: v })} clearable />
            </Field>
            <Field label="Goes to" required w="party" htmlFor="rh-route-owner">
              <Combobox id="rh-route-owner" options={personOptions} value={form.owner_id} onChange={(v) => set({ owner_id: v })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Note" w="name" htmlFor="rh-route-note">
              <Input id="rh-route-note" value={form.note} onChange={(e) => set({ note: e.target.value })} />
            </Field>
          </FieldRow>
        </div>
      </Sheet>
    </div>
  );
}
