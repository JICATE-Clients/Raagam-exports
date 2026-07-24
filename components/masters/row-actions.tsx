"use client";

import { Pencil, Copy, Download, type LucideIcon } from "lucide-react";
import { DropdownMenu, type DropdownItem } from "@/components/ui/dropdown-menu";

/**
 * Per-row 3-dot quick-actions menu for master list rows (checklist "Quick
 * Actions"). Holds the non-destructive actions — Edit, Duplicate, Export row —
 * plus any `extra` items. Delete is intentionally NOT here: the app keeps its
 * two-step inline confirm (`DeleteConfirmButton`), which the row renders next to
 * this menu. Every handler is optional; the menu only shows what's wired.
 */
export function RowActions({
  onEdit,
  onDuplicate,
  onExport,
  canEdit = true,
  extra = [],
}: {
  onEdit?: () => void;
  onDuplicate?: () => void;
  onExport?: () => void;
  canEdit?: boolean;
  /** Screen-specific extra items (e.g. Print), appended after the defaults. */
  extra?: { label: string; icon?: LucideIcon; onClick: () => void; danger?: boolean }[];
}) {
  const items: DropdownItem[] = [];
  if (onEdit && canEdit) items.push({ label: "Edit", icon: Pencil, onClick: onEdit });
  if (onDuplicate && canEdit) items.push({ label: "Duplicate", icon: Copy, onClick: onDuplicate });
  if (onExport) items.push({ label: "Export row", icon: Download, onClick: onExport });
  items.push(...extra);
  if (items.length === 0) return null;
  return <DropdownMenu items={items} />;
}
