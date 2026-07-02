"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createFinanceNote,
  setFinanceNoteStatus,
  deleteFinanceNote,
} from "@/lib/finance/notes/actions";
import {
  NOTE_TYPES,
  NOTE_TYPE_LABELS,
  PARTY_TYPES,
  PARTY_TYPE_LABELS,
  NOTE_STATUSES,
  NOTE_STATUS_LABELS,
  noteStatusTone,
  type NoteType,
  type PartyType,
  type NoteStatus,
} from "@/lib/finance/notes/types";
import type { FinanceNoteRow, PartyOption } from "@/lib/finance/notes/service";
import type { CurrencyOption } from "@/lib/logistics/proforma/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtMoney } from "@/lib/format";

interface Props {
  notes: FinanceNoteRow[];
  vendors: PartyOption[];
  buyers: PartyOption[];
  currencies: CurrencyOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function FinanceNotesClient({
  notes,
  vendors,
  buyers,
  currencies,
  canCreate,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  const [noteType, setNoteType] = useState<NoteType>("debit");
  const [partyType, setPartyType] = useState<PartyType>("vendor");
  const [partyId, setPartyId] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [amount, setAmount] = useState("");
  const [noteDate, setNoteDate] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");

  const partyChoices = partyType === "vendor" ? vendors : buyers;

  function resetForm() {
    setNoteType("debit");
    setPartyType("vendor");
    setPartyId("");
    setCurrency("INR");
    setAmount("");
    setNoteDate("");
    setReference("");
    setReason("");
    setFormOpen(false);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createFinanceNote({
        note_type: noteType,
        party_type: partyType,
        vendor_id: partyType === "vendor" ? partyId || null : null,
        buyer_id: partyType === "buyer" ? partyId || null : null,
        currency_code: currency || null,
        amount: Number(amount) || 0,
        note_date: noteDate || null,
        reference: reference || null,
        reason: reason || null,
      });
      if (result.ok) {
        success("Note created");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleStatus(id: string, status: NoteStatus) {
    startTransition(async () => {
      const result = await setFinanceNoteStatus(id, status);
      if (result.ok) {
        success("Status updated");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteFinanceNote(id);
      if (result.ok) {
        success("Note removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<FinanceNoteRow>[] = [
    { header: "Code", cell: (n) => <span className="font-mono text-xs font-medium">{n.code ?? "—"}</span> },
    {
      header: "Type",
      cell: (n) => (
        <span className="text-sm">
          {NOTE_TYPE_LABELS[n.note_type]}
        </span>
      ),
    },
    {
      header: "Party",
      cell: (n) => (
        <span className="text-sm">
          {n.party_type === "vendor" ? n.vendors?.name : n.buyers?.name}
          <span className="ml-1 text-xs text-muted-foreground">
            ({PARTY_TYPE_LABELS[n.party_type]})
          </span>
        </span>
      ),
    },
    {
      header: "Amount",
      align: "right",
      cell: (n) => <span className="tabular-nums text-sm">{fmtMoney(n.amount, n.currency_code)}</span>,
    },
    {
      header: "Status",
      cell: (n) =>
        canEdit ? (
          <Select
            value={n.status}
            onChange={(e) => handleStatus(n.id, e.target.value as NoteStatus)}
            disabled={isPending}
            className="h-7 w-28 text-xs"
            aria-label="Note status"
          >
            {NOTE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {NOTE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        ) : (
          <StatusPill tone={noteStatusTone(n.status)}>{NOTE_STATUS_LABELS[n.status]}</StatusPill>
        ),
    },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (n: FinanceNoteRow) => (
              <Button size="sm" variant="ghost" onClick={() => handleDelete(n.id)} disabled={isPending} className="h-7 px-2 text-xs text-danger hover:opacity-80">
                Delete
              </Button>
            ),
          } satisfies Column<FinanceNoteRow>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          {formOpen ? (
            <Button variant="outline" size="sm" onClick={resetForm}>
              Cancel
            </Button>
          ) : (
            <Button onClick={() => setFormOpen(true)}>New note</Button>
          )}
        </div>
      )}

      {canCreate && formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>New debit / credit note</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="fn-type">Note type</Label>
                <Select id="fn-type" value={noteType} onChange={(e) => setNoteType(e.target.value as NoteType)}>
                  {NOTE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {NOTE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="fn-party-type">Party type</Label>
                <Select
                  id="fn-party-type"
                  value={partyType}
                  onChange={(e) => {
                    setPartyType(e.target.value as PartyType);
                    setPartyId("");
                  }}
                >
                  {PARTY_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {PARTY_TYPE_LABELS[p]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="fn-party">{PARTY_TYPE_LABELS[partyType]} *</Label>
                <Select id="fn-party" value={partyId} onChange={(e) => setPartyId(e.target.value)} required>
                  <option value="">— select —</option>
                  {partyChoices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="fn-cur">Currency</Label>
                <Select id="fn-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.length === 0 && <option value="INR">INR</option>}
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="fn-amt">Amount</Label>
                <Input id="fn-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="fn-date">Note date</Label>
                <Input id="fn-date" type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="fn-ref">Reference</Label>
                <Input id="fn-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bill / invoice ref" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="fn-reason">Reason</Label>
                <Input id="fn-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending || !partyId}>
                  {isPending ? "Creating…" : "Create note"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={notes}
        getKey={(n) => n.id}
        empty="No debit / credit notes yet."
      />
    </div>
  );
}
