"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DEFAULT_COLUMNS } from "@/lib/masters/packing-format-columns-types";
import type { PackingFormatColumn } from "@/lib/masters/packing-format-columns-types";
import {
  savePackingFormatColumns,
  initPackingFormatColumns,
} from "@/lib/masters/packing-format-columns-actions";

type Props = {
  formatId: string | null;
  savedColumns: PackingFormatColumn[];
  open: boolean;
  onClose: () => void;
  canEdit: boolean;
};

type ColRow = {
  column_key: string;
  display_name: string;
  is_visible: boolean;
};

export function PackingFormatColumnsDialog({ formatId, savedColumns, open, onClose, canEdit }: Props) {
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [columns, setColumns] = useState<ColRow[]>([]);

  useEffect(() => {
    if (!open) return;
    if (savedColumns.length > 0) {
      setColumns(
        savedColumns
          .slice()
          .sort((a, b) => a.display_order - b.display_order)
          .map((c) => ({
            column_key: c.column_key,
            display_name: c.display_name,
            is_visible: c.is_visible,
          })),
      );
    } else {
      setColumns(
        DEFAULT_COLUMNS.map((c) => ({
          column_key: c.column_key,
          display_name: c.display_name,
          is_visible: c.is_visible,
        })),
      );
    }
  }, [open, savedColumns]);

  function toggle(key: string) {
    setColumns((cols) =>
      cols.map((c) => (c.column_key === key ? { ...c, is_visible: !c.is_visible } : c)),
    );
  }

  function rename(key: string, name: string) {
    setColumns((cols) =>
      cols.map((c) => (c.column_key === key ? { ...c, display_name: name } : c)),
    );
  }

  function moveUp(idx: number) {
    if (idx <= 0) return;
    setColumns((cols) => {
      const next = [...cols];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }

  function moveDown(idx: number) {
    setColumns((cols) => {
      if (idx >= cols.length - 1) return cols;
      const next = [...cols];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }

  function save() {
    if (!formatId) return;
    startTransition(async () => {
      // Initialize if first time
      if (savedColumns.length === 0) {
        await initPackingFormatColumns(formatId);
      }
      const res = await savePackingFormatColumns(
        formatId,
        columns.map((c, i) => ({
          column_key: c.column_key,
          display_name: c.display_name,
          display_order: i + 1,
          is_visible: c.is_visible,
        })),
      );
      if (res.ok) {
        success("Column configuration saved.");
        onClose();
      } else {
        error(res.error);
      }
    });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Packing List Columns"
      size="sm"
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>Cancel</Button>
          {canEdit && (
            <Button size="md" disabled={isPending || !formatId} onClick={save}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-1">
        {!formatId && (
          <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-muted-foreground">
            Select a Packing List Format first, then configure columns.
          </p>
        )}
        {formatId && columns.map((c, i) => (
          <div key={c.column_key} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-muted/50">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-primary"
                checked={c.is_visible}
                onChange={() => toggle(c.column_key)}
                disabled={!canEdit}
              />
            </label>
            <Input
              value={c.display_name}
              onChange={(e) => rename(c.column_key, e.target.value)}
              disabled={!canEdit}
              className="flex-1 text-sm"
            />
            <span className="w-16 text-center text-xs text-muted-foreground">{c.column_key}</span>
            <div className="flex gap-0.5">
              <Button type="button" variant="ghost" size="sm" disabled={i === 0 || !canEdit} onClick={() => moveUp(i)} className="px-1 text-xs">
                ↑
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={i === columns.length - 1 || !canEdit} onClick={() => moveDown(i)} className="px-1 text-xs">
                ↓
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
