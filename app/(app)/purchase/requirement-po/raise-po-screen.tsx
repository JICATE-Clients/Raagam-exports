"use client";

import { useMemo, useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { MasterListShell } from "@/components/masters/master-list-shell";
import { StatusSegment, type QuickCounts, type QuickWord } from "@/components/orders/bom-queue";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { fmtMoney } from "@/lib/format";
import { PO_STATUS_LABELS, type PoStatus } from "@/lib/purchase/types";
import { statusTone } from "@/lib/ui/status-tone";
import type { RaisedPo } from "@/lib/purchase/re-po/types";
import { RequirementPoForm } from "./requirement-po-form";

/**
 * RAISE PO — THE ORDERS SHAPE (user 2026-10-26: "if I raise a request in the Raise
 * PO page it went to the Purchase Order page — instead make it like the order
 * module, pending · updated · draft, in the Raise PO page"). A list first, the
 * editor opened from it, and Save returns HERE on the word the PO now counts as.
 *
 * What the three words mean on this screen:
 * - **Pending** — an RE / SWO / IWO with something still to buy: the work. Its
 *   pencil opens the editor with that order already chosen.
 * - **Updated** — a PO raised here and submitted (approved, with the MD, or on).
 * - **Draft** — a PO raised here and saved as draft.
 *
 * A PO row opens the PO itself on Purchase Orders — that is where it is
 * approved, printed and received; this screen only raises it.
 */

/* Same override the Purchase Orders list declares: Approved is a step, not the end. */
const PO_STATUS_TONE_OVERRIDES = { approved: "info" } as const;

type Row = {
  key: string;
  word: QuickWord;
  /** Pending → the order's id (opens the editor); Updated / Draft → the PO's id. */
  id: string;
  no: string;
  party: string;
  refs: string;
  /** Pending: lines still to buy. PO: its value. */
  amount: number;
  status: string;
  created_at: string | null;
  created_by: string | null;
};

const LABEL: Record<"pending" | "updated" | "draft", string> = { pending: "Pending", updated: "Updated", draft: "Draft" };

/** Everything the editor takes except the three this screen owns — passed through
 *  whole, so a prop the editor gains reaches it without this file changing. */
type FormProps = Omit<ComponentProps<typeof RequirementPoForm>, "initialOrderId" | "onSaved" | "onCancel">;

export function RaisePoScreen({ raised, form }: { raised: RaisedPo[]; form: FormProps }) {
  /** Requirement lines with a balance — Pending is built from these. */
  const lines = form.lines;
  const router = useRouter();
  const [word, setWord] = useState<QuickWord>("pending");
  /** null = the list; "" = a fresh PO; an id = a PO for that order. */
  const [editing, setEditing] = useState<string | null>(null);
  /** Remounts the form per open, so New starts blank (a useState seed fires once per mount). */
  const [openSeq, setOpenSeq] = useState(0);

  const rows = useMemo<Row[]>(() => {
    const byOrder = new Map<string, Row & { classes: Set<string> }>();
    for (const l of lines) {
      const o =
        byOrder.get(l.source_id) ??
        {
          key: `o:${l.source_id}`,
          word: "pending" as const,
          id: l.source_id,
          no: l.source_no,
          party: l.customer ?? "",
          refs: "",
          amount: 0,
          status: "",
          created_at: null,
          created_by: null,
          classes: new Set<string>(),
        };
      o.amount += 1;
      if (l.item_class) o.classes.add(l.item_class);
      byOrder.set(l.source_id, o);
    }
    const pending: Row[] = [...byOrder.values()]
      .map(({ classes, ...o }) => ({ ...o, refs: [...classes].sort().join(", ") }))
      .sort((a, b) => a.no.localeCompare(b.no));
    const pos: Row[] = raised
      .filter((p) => p.status !== "cancelled")
      .map((p) => ({
        key: `p:${p.id}`,
        word: p.status === "draft" ? ("draft" as const) : ("updated" as const),
        id: p.id,
        no: p.code ?? "—",
        party: p.vendor ?? "",
        refs: p.source_nos.join(", "),
        amount: p.total_amount,
        status: p.status,
        created_at: p.created_at,
        created_by: p.created_by,
      }));
    return [...pending, ...pos];
  }, [lines, raised]);

  const counts = useMemo<QuickCounts>(() => {
    const c: QuickCounts = {};
    for (const r of rows) c[r.word] = (c[r.word] ?? 0) + 1;
    return c;
  }, [rows]);
  const shown = useMemo(() => rows.filter((r) => r.word === word), [rows, word]);

  const isPendingView = word === "pending";
  const open = (r: Row) => {
    if (r.word === "pending") {
      setOpenSeq((n) => n + 1);
      setEditing(r.id);
    } else router.push(`/purchase/orders/${r.id}`);
  };

  if (editing !== null) {
    return (
      <RequirementPoForm
        key={openSeq}
        {...form}
        initialOrderId={editing || null}
        onCancel={() => setEditing(null)}
        onSaved={(w) => {
          setEditing(null);
          setWord(w);
          router.refresh();
        }}
      />
    );
  }

  const columns: Column<Row>[] = isPendingView
    ? [
        {
          header: "RE / SWO / IWO",
          cell: (r) => (
            <button type="button" className="font-mono text-xs font-medium text-primary hover:underline" onClick={() => open(r)}>
              {r.no}
            </button>
          ),
        },
        { header: "Buyer", cell: (r) => <Truncated>{r.party || "—"}</Truncated> },
        { header: "Item classes", cell: (r) => <Truncated>{r.refs || "—"}</Truncated> },
        { header: "Lines to buy", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.amount}</span> },
      ]
    : [
        {
          header: "PO No",
          cell: (r) => (
            <button type="button" className="font-mono text-xs font-medium text-primary hover:underline" onClick={() => open(r)}>
              {r.no}
            </button>
          ),
        },
        { header: "Vendor", cell: (r) => <Truncated>{r.party || "—"}</Truncated> },
        { header: "RE / SWO / IWO", cell: (r) => <Truncated>{r.refs || "—"}</Truncated> },
        { header: "Value", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.amount)}</span> },
        {
          header: "Status",
          cell: (r) => (
            <StatusPill tone={statusTone(r.status, PO_STATUS_TONE_OVERRIDES)}>
              {PO_STATUS_LABELS[r.status as PoStatus] ?? r.status}
            </StatusPill>
          ),
        },
      ];

  return (
    <MasterListShell<Row>
      rows={shown}
      filterLeading={
        <StatusSegment value={word} onChange={setWord} draft counts={counts} />
      }
      getKey={(r) => r.key}
      perms={{ canCreate: true, canEdit: true, canDelete: false }}
      addLabel="Raise PO"
      onAdd={() => {
        setOpenSeq((n) => n + 1);
        setEditing("");
      }}
      searchText={(r) => [r.no, r.party, r.refs].filter(Boolean).join(" ")}
      searchPlaceholder={isPendingView ? "Search RE No, buyer or class…" : "Search PO No, vendor or RE No…"}
      columns={columns}
      actions={{
        onEdit: open,
        /* PRINT PO (user 2026-10-27) — an icon on a raised PO's row, never a ⋮ (AGENTS, Row
           actions). Greyed until the PO is approved, saying why, rather than hidden: the
           row is the same PO either way, only its state differs. */
        menuAs: "icons",
        menu: (r) =>
          r.word === "pending"
            ? []
            : [
                {
                  label: r.status === "approved" ? "Print PO" : "Print opens after approval",
                  icon: Printer,
                  disabled: r.status !== "approved",
                  onClick: () => router.push(`/purchase/orders/${r.id}/print`),
                },
              ],
      }}
      rowLabel={(r) => r.no}
      empty={
        rows.length === 0
          ? "No requirement has anything left to buy, and no PO has been raised here yet."
          : `Nothing ${LABEL[word as keyof typeof LABEL] ?? ""} — the other words list the rest.`
      }
      mobile={{
        title: (r) => r.no,
        subtitle: (r) => r.party,
        meta: (r) =>
          r.word === "pending" ? `${r.amount} line(s) to buy · ${r.refs}` : `${r.refs} · ${fmtMoney(r.amount)}`,
        pill: (r) =>
          r.word === "pending" ? null : (
            <StatusPill tone={statusTone(r.status, PO_STATUS_TONE_OVERRIDES)}>
              {PO_STATUS_LABELS[r.status as PoStatus] ?? r.status}
            </StatusPill>
          ),
        onEdit: open,
      }}
    />
  );
}
