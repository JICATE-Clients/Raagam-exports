"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { createOpportunity } from "@/lib/sales/actions";
import {
  OPPORTUNITY_STAGES,
  ENQUIRY_AGAINST,
  ORDER_TYPES,
  DELIVERY_MODES,
  RECEIPT_MODES,
} from "@/lib/sales/types";
import type { Buyer } from "@/lib/masters/types";
import type { BrandOption, SeasonOption } from "@/lib/sales/service";

interface Props {
  buyers: Buyer[];
  brands?: BrandOption[];
  seasons?: SeasonOption[];
}

export function NewOpportunityForm({ buyers, brands = [], seasons = [] }: Props) {
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  // form state — original fields
  const [buyerId, setBuyerId] = useState("");
  const [title, setTitle] = useState("");
  const [season, setSeason] = useState("");
  const [stage, setStage] = useState<(typeof OPPORTUNITY_STAGES)[number]>("enquiry");
  const [targetFob, setTargetFob] = useState("");
  const [currencyCode, setCurrencyCode] = useState("USD");

  // form state — Market Enquiry fields
  const [brandId, setBrandId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [customerDept, setCustomerDept] = useState("");
  const [customerRef, setCustomerRef] = useState("");
  const [enquiryAgainst, setEnquiryAgainst] = useState("");
  const [orderType, setOrderType] = useState("");
  const [deliveryMode, setDeliveryMode] = useState("");
  const [deliveryTo, setDeliveryTo] = useState("");
  const [receiptMode, setReceiptMode] = useState("");
  const [receivedDate, setReceivedDate] = useState("");

  function reset() {
    setBuyerId("");
    setTitle("");
    setSeason("");
    setStage("enquiry");
    setTargetFob("");
    setCurrencyCode("USD");
    setBrandId("");
    setAgentName("");
    setSeasonId("");
    setCustomerDept("");
    setCustomerRef("");
    setEnquiryAgainst("");
    setOrderType("");
    setDeliveryMode("");
    setDeliveryTo("");
    setReceiptMode("");
    setReceivedDate("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!buyerId || !title) return;

    startTransition(async () => {
      const result = await createOpportunity({
        buyer_id: buyerId,
        title,
        season: season || null,
        stage,
        target_fob: targetFob ? parseFloat(targetFob) : null,
        currency_code: currencyCode || null,
        brand_id: brandId || null,
        agent_name: agentName || null,
        season_id: seasonId || null,
        customer_department: customerDept || null,
        customer_reference: customerRef || null,
        enquiry_against: (enquiryAgainst as (typeof ENQUIRY_AGAINST)[number]) || null,
        order_type: (orderType as (typeof ORDER_TYPES)[number]) || null,
        delivery_mode: (deliveryMode as (typeof DELIVERY_MODES)[number]) || null,
        delivery_to: deliveryTo || null,
        receipt_mode: (receiptMode as (typeof RECEIPT_MODES)[number]) || null,
        received_date: receivedDate || null,
      });

      if (result.ok) {
        toast.success("Opportunity created");
        reset();
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (!open) {
    return (
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        New opportunity
      </Button>
    );
  }

  return (
    <div className="mb-6">
      <Card>
        <CardHeader>
          <CardTitle>New Opportunity</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            Cancel
          </Button>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Row 1: Core fields */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="nof-buyer">Buyer *</Label>
                <Select
                  id="nof-buyer"
                  value={buyerId}
                  onChange={(e) => setBuyerId(e.target.value)}
                  required
                >
                  <option value="">Select buyer…</option>
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </Select>
              </div>

              <div className="sm:col-span-2 lg:col-span-1">
                <Label htmlFor="nof-title">Title *</Label>
                <Input
                  id="nof-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Spring 2026 Collection"
                  required
                />
              </div>

              <div>
                <Label htmlFor="nof-season">Season (text)</Label>
                <Input
                  id="nof-season"
                  value={season}
                  onChange={(e) => setSeason(e.target.value)}
                  placeholder="e.g. SS26"
                />
              </div>

              <div>
                <Label htmlFor="nof-stage">Stage</Label>
                <Select
                  id="nof-stage"
                  value={stage}
                  onChange={(e) =>
                    setStage(e.target.value as (typeof OPPORTUNITY_STAGES)[number])
                  }
                >
                  {OPPORTUNITY_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="nof-fob">Target FOB</Label>
                <Input
                  id="nof-fob"
                  type="number"
                  min="0"
                  step="0.01"
                  value={targetFob}
                  onChange={(e) => setTargetFob(e.target.value)}
                  placeholder="0.00"
                />
              </div>

              <div>
                <Label htmlFor="nof-currency">Currency</Label>
                <Input
                  id="nof-currency"
                  value={currencyCode}
                  onChange={(e) => setCurrencyCode(e.target.value)}
                  placeholder="USD"
                  maxLength={3}
                />
              </div>
            </div>

            {/* Row 2: Market Enquiry fields */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label htmlFor="nof-enquiry-against">Enquiry Against</Label>
                <Select
                  id="nof-enquiry-against"
                  value={enquiryAgainst}
                  onChange={(e) => setEnquiryAgainst(e.target.value)}
                >
                  <option value="">Select…</option>
                  {ENQUIRY_AGAINST.map((v) => (
                    <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="nof-order-type">Order Type</Label>
                <Select
                  id="nof-order-type"
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value)}
                >
                  <option value="">Select…</option>
                  {ORDER_TYPES.map((v) => (
                    <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
                  ))}
                </Select>
              </div>

              {brands.length > 0 && (
                <div>
                  <Label htmlFor="nof-brand">Brand</Label>
                  <Select
                    id="nof-brand"
                    value={brandId}
                    onChange={(e) => setBrandId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.brand_name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              {seasons.length > 0 && (
                <div>
                  <Label htmlFor="nof-season-master">Season (master)</Label>
                  <Select
                    id="nof-season-master"
                    value={seasonId}
                    onChange={(e) => setSeasonId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {seasons.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.season_name ?? s.season}{s.season_yr ? ` ${s.season_yr}` : ""}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              <div>
                <Label htmlFor="nof-agent">Agent</Label>
                <Input
                  id="nof-agent"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="Agent / representative"
                />
              </div>

              <div>
                <Label htmlFor="nof-cust-dept">Customer Department</Label>
                <Input
                  id="nof-cust-dept"
                  value={customerDept}
                  onChange={(e) => setCustomerDept(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="nof-cust-ref">Customer Reference</Label>
                <Input
                  id="nof-cust-ref"
                  value={customerRef}
                  onChange={(e) => setCustomerRef(e.target.value)}
                  placeholder="PO / Ref number"
                />
              </div>

              <div>
                <Label htmlFor="nof-received">Received Date</Label>
                <Input
                  id="nof-received"
                  type="date"
                  value={receivedDate}
                  onChange={(e) => setReceivedDate(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="nof-receipt-mode">Receipt Mode</Label>
                <Select
                  id="nof-receipt-mode"
                  value={receiptMode}
                  onChange={(e) => setReceiptMode(e.target.value)}
                >
                  <option value="">Select…</option>
                  {RECEIPT_MODES.map((v) => (
                    <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="nof-del-mode">Delivery Mode</Label>
                <Select
                  id="nof-del-mode"
                  value={deliveryMode}
                  onChange={(e) => setDeliveryMode(e.target.value)}
                >
                  <option value="">Select…</option>
                  {DELIVERY_MODES.map((v) => (
                    <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="nof-del-to">Delivery To</Label>
                <Input
                  id="nof-del-to"
                  value={deliveryTo}
                  onChange={(e) => setDeliveryTo(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Button type="submit" variant="primary" size="sm" disabled={isPending}>
                {isPending ? "Creating…" : "Create opportunity"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
