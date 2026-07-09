"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { createCurrency, updateCurrency, deleteCurrency } from "@/lib/masters/extras-actions";
import type { Currency } from "@/lib/masters/types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const blankForm = () => ({ code: "", name: "", symbol: "" });

/**
 * Currency master (Currencies submodule). Flat master over the existing
 * `currencies` table (PK = code): Code · Name · Symbol. The same table the
 * app-wide `CurrencyPicker` (Currency 1/2/3 fields) adds to — so a currency
 * created here appears everywhere immediately. On edit the Code is locked
 * because it is the primary key other tables reference.
 */
export function CurrencyMasterScreen({ rows, perms }: { rows: Currency[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm());

  const set = (patch: Partial<ReturnType<typeof blankForm>>) => setForm((f) => ({ ...f, ...patch }));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...rows].sort((a, b) => a.code.localeCompare(b.code));
    if (!q) return sorted;
    return sorted.filter((r) =>
      [r.code, r.name, r.symbol].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditCode(null);
    setForm(blankForm());
    setOpen(true);
  }
  function openEdit(r: Currency) {
    setEditCode(r.code);
    setForm({ code: r.code, name: r.name, symbol: r.symbol ?? "" });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        symbol: form.symbol.trim() || null,
      };
      const res = editCode
        ? await updateCurrency(editCode, payload)
        : await createCurrency(payload);
      if (res.ok) {
        success(editCode ? "Currency updated." : "Currency added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Currency) {
    startTransition(async () => {
      const res = await deleteCurrency(r.code);
      if (res.ok) {
        success("Currency deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Currency>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Symbol",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.symbol ?? "—"}</span>,
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

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search currency…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Currency
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.code} empty="No currencies yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No currencies yet.
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.code}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-foreground">
                    {r.code} · {r.name}
                  </div>
                </div>
                <span className="text-lg text-muted-foreground">{r.symbol ?? "—"}</span>
              </div>
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editCode ? `Edit Currency — ${editCode}` : "New Currency"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.code.trim() || !form.name.trim()}
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cur-code">
                Code <span className="text-danger">*</span>
              </Label>
              <Input
                id="cur-code"
                value={form.code}
                onChange={(e) => set({ code: e.target.value.toUpperCase() })}
                disabled={!!editCode}
                maxLength={8}
                placeholder="INR"
                className="font-mono text-base md:text-sm"
              />
              {editCode && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Code is the identifier and can&apos;t be changed.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="cur-symbol">Symbol</Label>
              <Input
                id="cur-symbol"
                value={form.symbol}
                onChange={(e) => set({ symbol: e.target.value })}
                placeholder="₹"
                className="text-base md:text-sm"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="cur-name">
              Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="cur-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Indian Rupee"
              className="text-base md:text-sm"
            />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
