"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import {
  createLabStandard,
  deleteLabStandard,
  createLabTest,
  issueLabTest,
  recordLabResult,
  deleteLabTest,
} from "@/lib/purchase/extras-actions";
import {
  LAB_APPLIES,
  LAB_APPLIES_LABELS,
  LAB_TEST_MODES,
  LAB_TEST_MODE_LABELS,
  LAB_TEST_STATUS_LABELS,
  type LabApplies,
  type LabTestMode,
  type LabTestStatus,
} from "@/lib/purchase/extras-types";
import type { LabTestStandard } from "@/lib/purchase/extras-types";
import type { LabTestWithRefs, OrderOption, BuyerOption, VendorForPicker } from "@/lib/purchase/extras-service";
import type { Item } from "@/lib/masters/types";

function testTone(s: LabTestStatus): StatusTone {
  switch (s) {
    case "draft":
      return "neutral";
    case "issued":
      return "info";
    case "passed":
      return "success";
    case "failed":
      return "danger";
  }
}

interface Props {
  standards: LabTestStandard[];
  tests: LabTestWithRefs[];
  standardOpts: { id: string; code: string | null; name: string }[];
  orders: OrderOption[];
  items: Item[];
  vendors: VendorForPicker[];
  buyers: BuyerOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function LabClient(props: Props) {
  const { standards, tests, standardOpts, orders, items, vendors, buyers, canCreate, canEdit, canDelete } = props;
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        success(ok);
        router.refresh();
      } else toastError(r.error ?? "Action failed");
    });
  }

  // ----- standard form -----
  const [stOpen, setStOpen] = useState(false);
  const [sName, setSName] = useState("");
  const [sParam, setSParam] = useState("");
  const [sMethod, setSMethod] = useState("");
  const [sMin, setSMin] = useState("");
  const [sMax, setSMax] = useState("");
  const [sUnit, setSUnit] = useState("");
  const [sApplies, setSApplies] = useState<LabApplies>("general");
  const [sBuyer, setSBuyer] = useState("");
  const [sOrder, setSOrder] = useState("");

  function handleCreateStandard(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createLabStandard({
        name: sName,
        parameter: sParam || null,
        method: sMethod || null,
        spec_min: sMin ? parseFloat(sMin) : null,
        spec_max: sMax ? parseFloat(sMax) : null,
        unit: sUnit || null,
        applies_to: sApplies,
        buyer_id: sApplies === "customer" ? sBuyer || null : null,
        sales_order_id: sApplies === "order" ? sOrder || null : null,
        notes: null,
      });
      if (r.ok) {
        success("Standard created");
        setSName(""); setSParam(""); setSMethod(""); setSMin(""); setSMax(""); setSUnit("");
        setSApplies("general"); setSBuyer(""); setSOrder(""); setStOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const standardColumns: Column<LabTestStandard>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Parameter", cell: (r) => <span className="text-sm">{r.parameter ?? "—"}</span> },
    {
      header: "Spec",
      cell: (r) => (
        <span className="text-sm tabular-nums">
          {r.spec_min != null || r.spec_max != null
            ? `${r.spec_min != null ? fmtNumber(r.spec_min) : "—"} – ${r.spec_max != null ? fmtNumber(r.spec_max) : "—"} ${r.unit ?? ""}`
            : "—"}
        </span>
      ),
    },
    { header: "Applies", cell: (r) => <span className="text-sm">{LAB_APPLIES_LABELS[r.applies_to]}</span> },
    ...(canDelete
      ? [
          {
            header: "",
            cell: (r: LabTestStandard) => (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger"
                disabled={isPending} onClick={() => run(() => deleteLabStandard(r.id), "Deleted")}>Del</Button>
            ),
          } satisfies Column<LabTestStandard>,
        ]
      : []),
  ];

  // ----- test form -----
  const [tOpen, setTOpen] = useState(false);
  const [tStandard, setTStandard] = useState("");
  const [tOrder, setTOrder] = useState("");
  const [tItem, setTItem] = useState("");
  const [tSample, setTSample] = useState("");
  const [tMode, setTMode] = useState<LabTestMode>("in_house");
  const [tVendor, setTVendor] = useState("");
  const [tReq, setTReq] = useState("");

  function handleCreateTest(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createLabTest({
        standard_id: tStandard || null,
        sales_order_id: tOrder || null,
        item_id: tItem || null,
        sample_ref: tSample || null,
        mode: tMode,
        outside_lab_vendor_id: tMode === "outside" ? tVendor || null : null,
        requisition_ref: tReq || null,
      });
      if (r.ok) {
        success("Test created");
        setTStandard(""); setTOrder(""); setTItem(""); setTSample(""); setTMode("in_house"); setTVendor(""); setTReq("");
        setTOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const testColumns: Column<LabTestWithRefs>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Standard", cell: (r) => <span className="text-sm">{r.standard_name ?? "—"}</span> },
    { header: "Sample", cell: (r) => <span className="text-sm">{r.sample_ref ?? "—"}</span> },
    { header: "Mode", cell: (r) => <span className="text-sm">{LAB_TEST_MODE_LABELS[r.mode]}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={testTone(r.status)}>{LAB_TEST_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && r.status === "draft" && (
            <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
              onClick={() => run(() => issueLabTest(r.id), "Issued")}>Issue</Button>
          )}
          {canEdit && (r.status === "draft" || r.status === "issued") && (
            <>
              <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
                onClick={() => run(() => recordLabResult(r.id, "passed", null, null), "Marked passed")}>Pass</Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending}
                onClick={() => run(() => recordLabResult(r.id, "failed", null, null), "Marked failed")}>Fail</Button>
            </>
          )}
          {canDelete && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending}
              onClick={() => run(() => deleteLabTest(r.id), "Deleted")}>Del</Button>
          )}
        </div>
      ),
    },
  ];

  const standardsTab = (
    <div className="space-y-4">
      {canCreate &&
        (stOpen ? (
          <Card>
            <CardHeader>
              <CardTitle>New test standard</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setStOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreateStandard} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Label htmlFor="s-name">Name</Label>
                    <Input id="s-name" value={sName} onChange={(e) => setSName(e.target.value)} required />
                  </div>
                  <div>
                    <Label htmlFor="s-param">Parameter</Label>
                    <Input id="s-param" placeholder="e.g. GSM, pH, colourfastness" value={sParam} onChange={(e) => setSParam(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="s-method">Method</Label>
                    <Input id="s-method" value={sMethod} onChange={(e) => setSMethod(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="s-min">Spec min</Label>
                    <Input id="s-min" type="number" step="0.01" value={sMin} onChange={(e) => setSMin(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="s-max">Spec max</Label>
                    <Input id="s-max" type="number" step="0.01" value={sMax} onChange={(e) => setSMax(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="s-unit">Unit</Label>
                    <Input id="s-unit" value={sUnit} onChange={(e) => setSUnit(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="s-applies">Applies to</Label>
                    <Select id="s-applies" value={sApplies} onChange={(e) => setSApplies(e.target.value as LabApplies)}>
                      {LAB_APPLIES.map((a) => <option key={a} value={a}>{LAB_APPLIES_LABELS[a]}</option>)}
                    </Select>
                  </div>
                  {sApplies === "customer" && (
                    <div>
                      <Label htmlFor="s-buyer">Buyer</Label>
                      <Select id="s-buyer" value={sBuyer} onChange={(e) => setSBuyer(e.target.value)}>
                        <option value="">— select —</option>
                        {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </Select>
                    </div>
                  )}
                  {sApplies === "order" && (
                    <div>
                      <Label htmlFor="s-order">Order</Label>
                      <Select id="s-order" value={sOrder} onChange={(e) => setSOrder(e.target.value)}>
                        <option value="">— select —</option>
                        {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number ?? o.id.slice(0, 8)}</option>)}
                      </Select>
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setStOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Create"}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setStOpen(true)}>New standard</Button></div>
        ))}
      <DataTable columns={standardColumns} rows={standards} getKey={(r) => r.id} empty="No test standards yet." />
    </div>
  );

  const testsTab = (
    <div className="space-y-4">
      {canCreate &&
        (tOpen ? (
          <Card>
            <CardHeader>
              <CardTitle>New test</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setTOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreateTest} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="t-standard">Standard</Label>
                    <Select id="t-standard" value={tStandard} onChange={(e) => setTStandard(e.target.value)}>
                      <option value="">— none —</option>
                      {standardOpts.map((o) => <option key={o.id} value={o.id}>{o.code ? `${o.code} — ` : ""}{o.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="t-order">Order</Label>
                    <Select id="t-order" value={tOrder} onChange={(e) => setTOrder(e.target.value)}>
                      <option value="">— none —</option>
                      {orders.map((o) => <option key={o.id} value={o.id}>{o.order_number ?? o.id.slice(0, 8)}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="t-item">Item</Label>
                    <Select id="t-item" value={tItem} onChange={(e) => setTItem(e.target.value)}>
                      <option value="">— none —</option>
                      {items.map((i) => <option key={i.id} value={i.id}>{i.code ? `${i.code} — ` : ""}{i.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="t-sample">Sample ref</Label>
                    <Input id="t-sample" value={tSample} onChange={(e) => setTSample(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="t-mode">Mode</Label>
                    <Select id="t-mode" value={tMode} onChange={(e) => setTMode(e.target.value as LabTestMode)}>
                      {LAB_TEST_MODES.map((m) => <option key={m} value={m}>{LAB_TEST_MODE_LABELS[m]}</option>)}
                    </Select>
                  </div>
                  {tMode === "outside" && (
                    <div>
                      <Label htmlFor="t-vendor">Outside lab</Label>
                      <Select id="t-vendor" value={tVendor} onChange={(e) => setTVendor(e.target.value)}>
                        <option value="">— select —</option>
                        {vendors.map((v) => <option key={v.id} value={v.id}>{v.code ? `${v.code} — ` : ""}{v.name}</option>)}
                      </Select>
                    </div>
                  )}
                  <div>
                    <Label htmlFor="t-req">Requisition ref</Label>
                    <Input id="t-req" value={tReq} onChange={(e) => setTReq(e.target.value)} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setTOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Create"}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setTOpen(true)}>New test</Button></div>
        ))}
      <DataTable columns={testColumns} rows={tests} getKey={(r) => r.id} empty="No tests yet." />
    </div>
  );

  return (
    <Tabs
      items={[
        { key: "tests", label: `Tests (${tests.length})`, content: testsTab },
        { key: "standards", label: `Standards (${standards.length})`, content: standardsTab },
      ]}
      defaultKey="tests"
    />
  );
}
