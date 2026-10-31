"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, PackageCheck } from "lucide-react";
import { MasterListShell } from "@/components/masters/master-list-shell";
import type { Column } from "@/components/ui/data-table";
import { ToggleGroup } from "@/components/ui/segmented";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import { deleteProcessDc } from "@/lib/stores/process-dc-actions";
import type { OpenProcessOrder, ProcessDcRow } from "@/lib/stores/process-dc-service";
import { fmtDate, fmtNumber } from "@/lib/format";
import { statusTone } from "@/lib/ui/status-tone";

/**
 * PROCESS DC REGISTER (0786). Pending = issued Process Orders with something still to send
 * (its pencil opens a DC on that order); At Vendor = dispatched DCs whose goods have not all
 * come back; Returned = closed; Draft = not yet dispatched.
 */

type Word = "pending" | "at_vendor" | "returned" | "draft";
type Row = {
  key: string;
  word: Word;
  id: string;
  no: string;
  vendor: string;
  process: string;
  order: string | null;
  date: string | null;
  expected: string | null;
  qty: number;
  status: string;
  created_at?: string;
  created_by?: string | null;
};

const STATUS_LABEL: Record<string, string> = { draft: "Draft", issued: "At Vendor", partially_returned: "Part Returned", closed: "Returned" };

export function ProcessDcScreen({ dcs, orders, canCreate }: { dcs: ProcessDcRow[]; orders: OpenProcessOrder[]; canCreate: boolean }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [, startTransition] = useTransition();

  const rows = useMemo<Row[]>(() => {
    const pend: Row[] = orders.map((o) => ({
      key: `o-${o.id}`,
      word: "pending",
      id: o.id,
      no: o.code ?? "—",
      vendor: o.vendor_name,
      process: o.process_type,
      order: o.order_no,
      date: null,
      expected: o.expected_date,
      qty: o.lines.reduce((a, l) => a + l.balance, 0),
      status: o.status,
    }));
    const docs: Row[] = dcs.map((d) => ({
      key: d.id,
      word: d.status === "draft" ? "draft" : d.status === "closed" ? "returned" : "at_vendor",
      id: d.id,
      no: d.code ?? "—",
      vendor: d.vendor_name,
      process: d.process_type ?? "",
      order: d.process_order_code,
      date: d.dc_date,
      expected: d.expected_return_date,
      qty: d.sent_total,
      status: d.status,
      created_at: d.created_at,
      created_by: d.created_by,
    }));
    return [...pend, ...docs];
  }, [dcs, orders]);
  const counts = useMemo(() => {
    const c: Record<Word, number> = { pending: 0, at_vendor: 0, returned: 0, draft: 0 };
    for (const r of rows) c[r.word]++;
    return c;
  }, [rows]);
  const [word, setWord] = useState<Word>("pending");
  const shown = useMemo(() => rows.filter((r) => r.word === word), [rows, word]);

  const open = (r: Row) => {
    if (r.word === "pending") router.push(`/stores/process-dc?send=new&order=${r.id}`);
    else if (r.word === "draft") router.push(`/stores/process-dc?send=${r.id}`);
    else if (r.word === "at_vendor") router.push(`/stores/process-dc?receive=${r.id}`);
    else router.push(`/stores/process-dc/${r.id}/print`);
  };

  const columns: Column<Row>[] = [
    {
      header: word === "pending" ? "Process Order" : "DC No",
      cell: (r) => (
        <button type="button" className="font-mono text-xs font-medium text-primary hover:underline" onClick={() => open(r)}>
          {r.no}
        </button>
      ),
    },
    { header: "Vendor", cell: (r) => <Truncated>{r.vendor}</Truncated> },
    { header: "Process", cell: (r) => <span className="text-sm">{r.process.toUpperCase()}</span> },
    ...(word === "pending"
      ? [{ header: "RE No", cell: (r: Row) => <span className="text-sm">{r.order ?? "—"}</span> }]
      : [
          { header: "Process Order", cell: (r: Row) => <span className="font-mono text-xs">{r.order ?? "—"}</span> },
          { header: "DC Date", cell: (r: Row) => <span className="text-sm">{fmtDate(r.date)}</span> },
        ]),
    { header: "Expected Back", cell: (r) => <span className="text-sm">{fmtDate(r.expected)}</span> },
    {
      header: word === "pending" ? "To Send" : "Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.qty)}</span>,
    },
    ...(word === "pending"
      ? []
      : [
          {
            header: "Status",
            cell: (r: Row) => <StatusPill tone={statusTone(r.status === "issued" ? "in process" : r.status)}>{STATUS_LABEL[r.status] ?? r.status}</StatusPill>,
          },
        ]),
  ];

  return (
    <MasterListShell<Row>
      rows={shown}
      filterLeading={
        <ToggleGroup<Word>
          label="Process DCs"
          value={word}
          onChange={setWord}
          options={[
            { value: "pending", label: `Pending${counts.pending ? ` (${counts.pending})` : ""}` },
            { value: "at_vendor", label: `At Vendor${counts.at_vendor ? ` (${counts.at_vendor})` : ""}` },
            { value: "returned", label: "Returned" },
            { value: "draft", label: `Draft${counts.draft ? ` (${counts.draft})` : ""}` },
          ]}
        />
      }
      getKey={(r) => r.key}
      perms={{ canCreate, canEdit: true, canDelete: canCreate }}
      addLabel="New Process DC"
      onAdd={() => router.push("/stores/process-dc?send=new")}
      searchText={(r) => [r.no, r.vendor, r.process, r.order].filter(Boolean).join(" ")}
      searchPlaceholder="Search DC / order No, vendor or process…"
      columns={columns}
      actions={{
        onEdit: open,
        menuAs: "icons",
        menu: (r) => [
          ...(r.word === "at_vendor"
            ? [{ label: "Receive back", icon: PackageCheck, onClick: () => router.push(`/stores/process-dc?receive=${r.id}`) }]
            : []),
          ...(r.word === "at_vendor" || r.word === "returned"
            ? [{ label: "Print DC", icon: FileText, onClick: () => router.push(`/stores/process-dc/${r.id}/print`) }]
            : []),
        ],
        onDelete: (r) =>
          startTransition(async () => {
            const res = await deleteProcessDc(r.id);
            if (res.ok) {
              success("Draft deleted");
              router.refresh();
            } else toastError(res.error);
          }),
        deleteDisabledReason: (r) =>
          r.word === "draft" ? null : r.word === "pending" ? "A Process Order is cancelled on Process Orders, not here" : "A dispatched DC moved stock — it is not deleted",
      }}
      rowLabel={(r) => r.no}
      empty={
        word === "pending"
          ? "No issued Process Order has anything left to send."
          : word === "at_vendor"
            ? "Nothing is out at a processor."
            : word === "draft"
              ? "No draft waiting to be dispatched."
              : "No Process DC has come back yet."
      }
      mobile={{
        title: (r) => r.no,
        subtitle: (r) => r.vendor,
        meta: (r) => `${r.process.toUpperCase()} · ${fmtNumber(r.qty)}${r.expected ? ` · back ${fmtDate(r.expected)}` : ""}`,
        pill: (r) =>
          r.word === "pending" ? null : (
            <StatusPill tone={statusTone(r.status === "issued" ? "in process" : r.status)}>{STATUS_LABEL[r.status] ?? r.status}</StatusPill>
          ),
        onEdit: open,
      }}
    />
  );
}
