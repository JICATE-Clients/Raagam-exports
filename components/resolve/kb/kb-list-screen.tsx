"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { ToggleGroup } from "@/components/ui/segmented";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { hugCreated, withCreatedColumns } from "@/components/ui/created-columns";
import { KB_STATUS_LABEL, type KbListRow, type KbStatus, type OpenServiceCategory } from "@/lib/resolve/desk-types";
import { KbEditorSheet } from "./kb-editor-sheet";
import { kbStatusTone } from "./kb-status";

const EMPTY: Record<KbStatus, string> = {
  published: "No published articles yet. They are written from resolved IT requests.",
  draft: "No drafts waiting to be published.",
  retired: "Nothing has been retired.",
};

/**
 * THE KNOWLEDGE BASE (service-desk-plan §6) — published articles for everyone;
 * Drafts and Retired for `resolve:edit`, whose tab is a URL (`?status=`) so the
 * server reads that list (`rh_kb_list` refuses the other two to anyone else).
 * Search filters the rows already on screen, at once — the same articles the
 * request form suggests with full-text search.
 */
export function KbListScreen({
  rows,
  status,
  canEdit,
  categories,
}: {
  rows: KbListRow[];
  status: KbStatus;
  canEdit: boolean;
  categories: OpenServiceCategory[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const catName = useMemo(() => new Map(categories.map((c) => [c.code, c.name])), [categories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.title, r.problem, r.category_code, ...(r.tags ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  const columns: Column<KbListRow>[] = [
    {
      header: "Code",
      className: "w-px whitespace-nowrap",
      cell: (r) => (
        <Link href={`/resolve/kb/${r.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
          {r.code}
        </Link>
      ),
    },
    { header: "Title", cell: (r) => <Truncated>{r.title}</Truncated> },
    {
      header: "Category",
      className: "w-px whitespace-nowrap",
      cell: (r) => (r.category_code ? (catName.get(r.category_code) ?? r.category_code) : "Any"),
    },
    { header: "Steps", align: "right", className: "w-px", cell: (r) => <span className="tabular-nums">{r.step_count}</span> },
    { header: "Used", align: "right", className: "w-px", cell: (r) => <span className="tabular-nums">{r.used_count}</span> },
    {
      header: "Helpful",
      align: "right",
      className: "w-px whitespace-nowrap",
      cell: (r) => (
        <span className="tabular-nums text-xs">
          {r.helpful_count} yes · {r.not_helpful_count} no
        </span>
      ),
    },
    ...(canEdit
      ? [
          {
            header: "Status",
            className: "w-px",
            cell: (r: KbListRow) => <StatusPill tone={kbStatusTone(r.status)}>{KB_STATUS_LABEL[r.status]}</StatusPill>,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-3">
      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search title, problem, tag…"
        leading={
          canEdit ? (
            <ToggleGroup<KbStatus>
              label="Articles"
              role="tablist"
              value={status}
              onChange={(s) => router.push(s === "published" ? "/resolve/kb" : `/resolve/kb?status=${s}`)}
              options={(["published", "draft", "retired"] as const).map((s) => ({ value: s, label: KB_STATUS_LABEL[s] }))}
            />
          ) : undefined
        }
        right={
          canEdit ? (
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              New article
            </Button>
          ) : undefined
        }
      />
      <DataTable
        columns={hugCreated(withCreatedColumns(columns, rows))}
        rows={filtered}
        getKey={(r) => r.id}
        onRowHref={(r) => `/resolve/kb/${r.id}`}
        empty={search.trim() ? "No articles match that search." : EMPTY[status]}
      />
      {creating ? (
        <KbEditorSheet
          draft={{ title: "", problem: "", steps: [], tags: [], category_code: null, source_ticket_id: null }}
          categories={categories}
          onClose={() => setCreating(false)}
          onSaved={(id) => router.push(`/resolve/kb/${id}`)}
        />
      ) : null}
    </div>
  );
}
