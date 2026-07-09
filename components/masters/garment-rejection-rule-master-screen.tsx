"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  createGarmentRejectionRule,
  updateGarmentRejectionRule,
  deleteGarmentRejectionRule,
} from "@/lib/masters/garment-rejection-rule-actions";
import type {
  GarmentRejectionRule,
  GarmentRejectionRuleInput,
} from "@/lib/masters/garment-rejection-rule-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const todayISO = () => new Date().toISOString().slice(0, 10);

type LineRow = {
  key: string;
  range_label: string;
  from_value: string;
  to_value: string;
  rejection_allowance: string;
};
const blankLine = (key: string): LineRow => ({
  key,
  range_label: "",
  from_value: "",
  to_value: "",
  rejection_allowance: "",
});

/**
 * Legacy "Garment rejection rule" master (System). Master-detail: header (auto
 * Entry No · Effective From · Rule · Blocked) + a Details grid of tiers
 * (Range · From · To · Rejection Allowance).
 */
export function GarmentRejectionRuleMasterScreen({
  rows,
  perms,
}: {
  rows: GarmentRejectionRule[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editEntryNo, setEditEntryNo] = useState<number | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [rule, setRule] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [String(r.entry_no), r.rule, r.effective_from].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setEditEntryNo(null);
    setEffectiveFrom(todayISO());
    setRule("");
    setBlocked(false);
    setLines([blankLine(newKey())]);
    setOpen(true);
  }
  function openEdit(r: GarmentRejectionRule) {
    setEditId(r.id);
    setEditEntryNo(r.entry_no);
    setEffectiveFrom(r.effective_from);
    setRule(r.rule ?? "");
    setBlocked(r.blocked);
    setLines(
      r.lines.map((l) => ({
        key: newKey(),
        range_label: l.range_label ?? "",
        from_value: l.from_value != null ? String(l.from_value) : "",
        to_value: l.to_value != null ? String(l.to_value) : "",
        rejection_allowance: l.rejection_allowance != null ? String(l.rejection_allowance) : "",
      })),
    );
    setOpen(true);
  }

  function addLine() {
    setLines((ls) => [...ls, blankLine(newKey())]);
  }
  function setLineAt(key: string, patch: Partial<LineRow>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

  function submit() {
    startTransition(async () => {
      const payload: GarmentRejectionRuleInput = {
        effective_from: effectiveFrom,
        rule: rule.trim(),
        blocked,
        lines: lines.map((l, i) => ({
          sno: i + 1,
          range_label: l.range_label.trim() || null,
          from_value: numOrNull(l.from_value),
          to_value: numOrNull(l.to_value),
          rejection_allowance: numOrNull(l.rejection_allowance),
        })),
      };
      const res = editId
        ? await updateGarmentRejectionRule(editId, payload)
        : await createGarmentRejectionRule(payload);
      if (res.ok) {
        success(editId ? "Rejection rule updated." : "Rejection rule added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: GarmentRejectionRule) {
    startTransition(async () => {
      const res = await deleteGarmentRejectionRule(r.id);
      if (res.ok) {
        success("Rejection rule deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<GarmentRejectionRule>[] = [
    { header: "Entry", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Rule", cell: (r) => <span className="text-sm">{r.rule ?? "—"}</span> },
    {
      header: "Effective From",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.effective_from}</span>,
    },
    {
      header: "Tiers",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.lines.length}</span>,
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.blocked ? "danger" : "success"}>{r.blocked ? "Blocked" : "Active"}</StatusPill>
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
          placeholder="Search rejection rule…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Rule
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No rejection rules yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No rejection rules yet.
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-foreground">
                    {r.rule ?? `Rule #${r.entry_no}`}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    #{r.entry_no} · {r.effective_from} · {r.lines.length} tier{r.lines.length === 1 ? "" : "s"}
                  </div>
                </div>
                <StatusPill tone={r.blocked ? "danger" : "success"}>
                  {r.blocked ? "Blocked" : "Active"}
                </StatusPill>
              </div>
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit Rejection Rule #${editEntryNo}` : "New Rejection Rule"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !rule.trim() || !effectiveFrom}
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
              <Label htmlFor="grr-entry">Entry No</Label>
              <Input id="grr-entry" value={editEntryNo ?? "(auto)"} disabled className="text-base md:text-sm" />
            </div>
            <div>
              <Label htmlFor="grr-eff">Effective From</Label>
              <Input
                id="grr-eff"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="text-base md:text-sm"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="grr-rule">
              Rule <span className="text-danger">*</span>
            </Label>
            <Input
              id="grr-rule"
              value={rule}
              onChange={(e) => setRule(e.target.value)}
              required
              className="text-base md:text-sm"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer accent-primary"
              checked={blocked}
              onChange={(e) => setBlocked(e.target.checked)}
            />
            <span className="text-sm text-foreground">Blocked</span>
          </label>

          {/* Details grid */}
          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
              Details
            </div>
            <div className="space-y-3 p-3">
              {lines.length === 0 && <p className="text-xs text-muted-foreground">No tiers yet.</p>}
              {lines.map((l, i) => (
                <div key={l.key} className="space-y-2 rounded-md border border-border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Tier #{i + 1}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-danger"
                      onClick={() => removeLine(l.key)}
                      aria-label="Remove tier"
                    >
                      ✕
                    </Button>
                  </div>
                  <Input
                    placeholder="Range"
                    value={l.range_label}
                    onChange={(e) => setLineAt(l.key, { range_label: e.target.value })}
                    className="text-base md:text-sm"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      type="number"
                      placeholder="From"
                      value={l.from_value}
                      onChange={(e) => setLineAt(l.key, { from_value: e.target.value })}
                      className="text-base md:text-sm"
                    />
                    <Input
                      type="number"
                      placeholder="To"
                      value={l.to_value}
                      onChange={(e) => setLineAt(l.key, { to_value: e.target.value })}
                      className="text-base md:text-sm"
                    />
                    <Input
                      type="number"
                      placeholder="Allowance"
                      value={l.rejection_allowance}
                      onChange={(e) => setLineAt(l.key, { rejection_allowance: e.target.value })}
                      className="text-base md:text-sm"
                    />
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                + Add tier
              </Button>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
