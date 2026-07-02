"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { createEpcg, setEpcgStatus, deleteEpcg } from "@/lib/logistics/epcg/actions";
import {
  EPCG_STATUSES,
  EPCG_STATUS_LABELS,
  epcgStatusTone,
  obligationPct,
  type EpcgDeclaration,
  type EpcgStatus,
} from "@/lib/logistics/epcg/types";
import type { CurrencyOption } from "@/lib/logistics/proforma/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtMoney, fmtDate } from "@/lib/format";

interface Props {
  declarations: EpcgDeclaration[];
  currencies: CurrencyOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function EpcgClient({
  declarations,
  currencies,
  canCreate,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  useCreateIntent(() => setFormOpen(true));
  const [licenseNumber, setLicenseNumber] = useState("");
  const [authDate, setAuthDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [dutySaved, setDutySaved] = useState("");
  const [obligation, setObligation] = useState("");
  const [fulfilled, setFulfilled] = useState("");
  const [remarks, setRemarks] = useState("");

  function resetForm() {
    setLicenseNumber("");
    setAuthDate("");
    setExpiryDate("");
    setCurrency("USD");
    setDutySaved("");
    setObligation("");
    setFulfilled("");
    setRemarks("");
    setFormOpen(false);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createEpcg({
        license_number: licenseNumber || null,
        authorisation_date: authDate || null,
        expiry_date: expiryDate || null,
        currency_code: currency || null,
        duty_saved: Number(dutySaved) || 0,
        export_obligation: Number(obligation) || 0,
        obligation_fulfilled: Number(fulfilled) || 0,
        remarks: remarks || null,
      });
      if (result.ok) {
        success("EPCG declaration created");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleStatus(id: string, status: EpcgStatus) {
    startTransition(async () => {
      const result = await setEpcgStatus(id, status);
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
      const result = await deleteEpcg(id);
      if (result.ok) {
        success("Declaration removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<EpcgDeclaration>[] = [
    {
      header: "Code",
      cell: (e) => <span className="font-mono text-xs font-medium">{e.code ?? "—"}</span>,
    },
    {
      header: "Licence",
      cell: (e) => <span className="font-mono text-xs">{e.license_number ?? "—"}</span>,
    },
    {
      header: "Duty saved",
      align: "right",
      cell: (e) => <span className="tabular-nums text-sm">{fmtMoney(e.duty_saved, e.currency_code)}</span>,
    },
    {
      header: "Obligation",
      cell: (e) => {
        const pct = obligationPct(e);
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
            <span className="tabular-nums text-xs text-muted-foreground">{pct}%</span>
          </div>
        );
      },
    },
    {
      header: "Expiry",
      cell: (e) => (
        <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(e.expiry_date)}</span>
      ),
    },
    {
      header: "Status",
      cell: (e) =>
        canEdit ? (
          <Select
            value={e.status}
            onChange={(ev) => handleStatus(e.id, ev.target.value as EpcgStatus)}
            disabled={isPending}
            className="h-7 w-28 text-xs"
            aria-label="EPCG status"
          >
            {EPCG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EPCG_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        ) : (
          <StatusPill tone={epcgStatusTone(e.status)}>{EPCG_STATUS_LABELS[e.status]}</StatusPill>
        ),
    },
    ...(canDelete
      ? [
          {
            header: "",
            align: "right",
            cell: (e: EpcgDeclaration) => (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDelete(e.id)}
                disabled={isPending}
                className="h-7 px-2 text-xs text-danger hover:opacity-80"
              >
                Delete
              </Button>
            ),
          } satisfies Column<EpcgDeclaration>,
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
            <Button onClick={() => setFormOpen(true)}>New EPCG</Button>
          )}
        </div>
      )}

      {canCreate && formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>New EPCG declaration</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="ep-lic">Licence number</Label>
                <Input id="ep-lic" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ep-auth">Authorisation date</Label>
                <Input id="ep-auth" type="date" value={authDate} onChange={(e) => setAuthDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ep-exp">Expiry date</Label>
                <Input id="ep-exp" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ep-cur">Currency</Label>
                <Select id="ep-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {currencies.length === 0 && <option value="USD">USD</option>}
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="ep-duty">Duty saved</Label>
                <Input id="ep-duty" type="number" min="0" step="0.01" value={dutySaved} onChange={(e) => setDutySaved(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="ep-obl">Export obligation</Label>
                <Input id="ep-obl" type="number" min="0" step="0.01" value={obligation} onChange={(e) => setObligation(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="ep-ful">Obligation fulfilled</Label>
                <Input id="ep-ful" type="number" min="0" step="0.01" value={fulfilled} onChange={(e) => setFulfilled(e.target.value)} placeholder="0.00" />
              </div>
              <div className="sm:col-span-2 lg:col-span-2">
                <Label htmlFor="ep-rem">Remarks</Label>
                <Textarea id="ep-rem" value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={1} placeholder="Optional…" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending}>
                  {isPending ? "Creating…" : "Create declaration"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={declarations}
        getKey={(e) => e.id}
        empty="No EPCG declarations yet."
      />
    </div>
  );
}
