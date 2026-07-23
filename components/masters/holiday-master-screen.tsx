"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import { createHoliday, updateHoliday, deleteHoliday } from "@/lib/masters/holiday-actions";
import {
  HOLIDAY_CATEGORIES,
  HOLIDAY_PAY_TYPES,
  type HolidayCategory,
  type HolidayPayType,
  type Holiday,
  type HolidayInput,
} from "@/lib/masters/holiday-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const todayISO = () => new Date().toISOString().slice(0, 10);
const blankForm = () => ({
  entry_date: todayISO(),
  category: "National" as HolidayCategory,
  name: "",
  pay_type: "Paid Holiday" as HolidayPayType,
  is_date_range: false,
  holiday_date: todayISO(),
  end_date: "",
});

/** Human-readable holiday date (single, or from → to). */
function datePhrase(r: Pick<Holiday, "is_date_range" | "holiday_date" | "end_date">): string {
  return r.is_date_range && r.end_date ? `${r.holiday_date} → ${r.end_date}` : r.holiday_date;
}

/**
 * Legacy "Holiday" master (HR). Flat header form: auto Entry No, Date, a
 * category radio (National/Festival/Others), Holiday name, a Type radio (Paid
 * Holiday/LOP), and the holiday date — a single date or a from→to range when
 * "Date Range" is ticked.
 */
export function HolidayMasterScreen({ rows, perms }: { rows: Holiday[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editEntryNo, setEditEntryNo] = useState<number | null>(null);
  const [form, setForm] = useState(blankForm());

  const set = (patch: Partial<ReturnType<typeof blankForm>>) => setForm((f) => ({ ...f, ...patch }));

  function openAdd() {
    setEditId(null);
    setEditEntryNo(null);
    setForm(blankForm());
    setOpen(true);
  }
  function openEdit(r: Holiday) {
    setEditId(r.id);
    setEditEntryNo(r.entry_no);
    setForm({
      entry_date: r.entry_date,
      category: r.category ?? "National",
      name: r.name,
      pay_type: r.pay_type ?? "Paid Holiday",
      is_date_range: r.is_date_range,
      holiday_date: r.holiday_date,
      end_date: r.end_date ?? "",
    });
    setOpen(true);
  }

  function submit() {
    startTransition(async () => {
      const payload: HolidayInput = {
        entry_date: form.entry_date,
        category: form.category,
        name: form.name.trim(),
        pay_type: form.pay_type,
        is_date_range: form.is_date_range,
        holiday_date: form.holiday_date,
        end_date: form.is_date_range ? form.end_date || null : null,
      };
      const res = editId ? await updateHoliday(editId, payload) : await createHoliday(payload);
      if (res.ok) {
        success(editId ? "Holiday updated." : "Holiday added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: Holiday) {
    startTransition(async () => {
      const res = await deleteHoliday(r.id);
      if (res.ok) {
        success("Holiday deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<Holiday>[] = [
    { header: "Entry", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Holiday", cell: (r) => <span className="text-sm">{r.name}</span> },
    {
      header: "Category",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.category ?? "—"}</span>,
    },
    {
      header: "Date",
      cell: (r) => <span className="text-sm text-muted-foreground">{datePhrase(r)}</span>,
    },
    {
      header: "Type",
      cell: (r) => (
        <StatusPill tone={r.pay_type === "LOP" ? "warning" : "success"}>
          {r.pay_type ?? "—"}
        </StatusPill>
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

  return (
    <div className="space-y-4">
      <MasterListShell
        rows={rows}
        getKey={(r) => r.id}
        perms={perms}
        searchText={(r) =>
          [String(r.entry_no), r.name, r.category, r.pay_type, datePhrase(r)]
            .filter(Boolean)
            .join(" ")
        }
        searchPlaceholder="Search holiday…"
        addLabel="+ Add Holiday"
        onAdd={openAdd}
        columns={columns}
        empty="No holidays yet."
        mobile={{
          title: (r) => r.name,
          meta: (r) => `${r.category ?? "—"} · ${datePhrase(r)}`,
          pill: (r) => (
            <StatusPill tone={r.pay_type === "LOP" ? "warning" : "success"}>
              {r.pay_type ?? "—"}
            </StatusPill>
          ),
          onEdit: openEdit,
          onDelete: remove,
        }}
        isPending={isPending}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit Holiday #${editEntryNo}` : "New Holiday"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !form.name.trim() || !form.holiday_date}
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <div className="grid grid-cols-2 gap-3 sm:col-span-2">
            <div>
              <Label htmlFor="hd-entry">Entry No</Label>
              <Input id="hd-entry" value={editEntryNo ?? "(auto)"} disabled className="text-base md:text-sm" />
            </div>
            <div>
              <Label htmlFor="hd-date">Date</Label>
              <Input
                id="hd-date"
                type="date"
                value={form.entry_date}
                onChange={(e) => set({ entry_date: e.target.value })}
                className="text-base md:text-sm"
              />
            </div>
          </div>

          {/* Holiday category radio */}
          <div className="rounded-lg border border-border p-3 sm:col-span-2">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Holiday
            </div>
            <div className="flex flex-wrap gap-4">
              {HOLIDAY_CATEGORIES.map((c) => (
                <label key={c} className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="hd-category"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form.category === c}
                    onChange={() => set({ category: c })}
                  />
                  <span className="text-sm text-foreground">{c}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="hd-name">
              Holiday <span className="text-danger">*</span>
            </Label>
            <Input
              id="hd-name"
              uppercase
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              required
              className="text-base md:text-sm"
            />
          </div>

          {/* Type radio */}
          <div>
            <Label>Type</Label>
            <div className="mt-1 flex flex-wrap gap-4">
              {HOLIDAY_PAY_TYPES.map((t) => (
                <label key={t} className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="hd-paytype"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={form.pay_type === t}
                    onChange={() => set({ pay_type: t })}
                  />
                  <span className="text-sm text-foreground">{t}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Holiday date — single or range */}
          <div className="rounded-lg border border-border p-3 sm:col-span-2">
            <label className="mb-2 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={form.is_date_range}
                onChange={(e) => set({ is_date_range: e.target.checked })}
              />
              <span className="text-sm font-medium text-foreground">Date Range</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="hd-hdate">{form.is_date_range ? "From" : "Date"}</Label>
                <Input
                  id="hd-hdate"
                  type="date"
                  value={form.holiday_date}
                  onChange={(e) => set({ holiday_date: e.target.value })}
                  className="text-base md:text-sm"
                />
              </div>
              {form.is_date_range && (
                <div>
                  <Label htmlFor="hd-edate">To</Label>
                  <Input
                    id="hd-edate"
                    type="date"
                    value={form.end_date}
                    min={form.holiday_date || undefined}
                    onChange={(e) => set({ end_date: e.target.value })}
                    className="text-base md:text-sm"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
