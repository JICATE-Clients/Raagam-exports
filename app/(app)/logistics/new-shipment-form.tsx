"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { createShipment } from "@/lib/logistics/actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import type { SalesOrderForPicker } from "@/lib/logistics/service";

interface Props {
  buyers: { id: string; name: string; code: string | null }[];
  currencies: { code: string; name: string }[];
  orders: SalesOrderForPicker[];
}

export function NewShipmentForm({ buyers, currencies, orders }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  // header fields
  const [buyerId, setBuyerId] = useState("");
  const [consigneeName, setConsigneeName] = useState("");
  const [consigneeAddress, setConsigneeAddress] = useState("");
  const [portOfLoading, setPortOfLoading] = useState("Tuticorin");
  const [destinationPort, setDestinationPort] = useState("");
  const [destinationCountry, setDestinationCountry] = useState("");
  const [vessel, setVessel] = useState("");
  const [voyageNo, setVoyageNo] = useState("");
  const [incoterm, setIncoterm] = useState("FOB");
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [etd, setEtd] = useState("");
  const [eta, setEta] = useState("");
  const [notes, setNotes] = useState("");

  // linked orders (multi-select via checkboxes)
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);

  function toggleOrder(orderId: string) {
    setSelectedOrderIds((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId],
    );
  }

  function resetForm() {
    setBuyerId("");
    setConsigneeName("");
    setConsigneeAddress("");
    setPortOfLoading("Tuticorin");
    setDestinationPort("");
    setDestinationCountry("");
    setVessel("");
    setVoyageNo("");
    setIncoterm("FOB");
    setCurrencyCode("USD");
    setEtd("");
    setEta("");
    setNotes("");
    setSelectedOrderIds([]);
  }

  function handleClose() {
    setOpen(false);
    resetForm();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createShipment({
        buyer_id: buyerId || null,
        consignee_name: consigneeName || null,
        consignee_address: consigneeAddress || null,
        port_of_loading: portOfLoading,
        destination_port: destinationPort || null,
        destination_country: destinationCountry || null,
        vessel: vessel || null,
        voyage_no: voyageNo || null,
        incoterm,
        currency_code: currencyCode || null,
        etd: etd || null,
        eta: eta || null,
        notes: notes || null,
        sales_order_ids: selectedOrderIds,
      });
      if (result.ok) {
        success("Shipment created");
        router.push(`/logistics/${result.shipmentId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>New shipment</Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button variant="outline" size="sm" onClick={handleClose}>
          Cancel
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New shipment</CardTitle>
        </CardHeader>

        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Buyer + consignee */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ns-buyer">Buyer</Label>
                <Select
                  id="ns-buyer"
                  value={buyerId}
                  onChange={(e) => setBuyerId(e.target.value)}
                >
                  <option value="">— select buyer —</option>
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code ? `${b.code} — ` : ""}{b.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="ns-consignee">Consignee name</Label>
                <Input
                  id="ns-consignee"
                  placeholder="Company name"
                  value={consigneeName}
                  onChange={(e) => setConsigneeName(e.target.value)}
                />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="ns-consignee-addr">Consignee address</Label>
                <Textarea
                  id="ns-consignee-addr"
                  placeholder="Full address…"
                  rows={2}
                  value={consigneeAddress}
                  onChange={(e) => setConsigneeAddress(e.target.value)}
                />
              </div>
            </div>

            {/* Ports + routing */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="ns-pol">Port of loading</Label>
                <Input
                  id="ns-pol"
                  placeholder="Tuticorin"
                  value={portOfLoading}
                  onChange={(e) => setPortOfLoading(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="ns-dest-port">Destination port</Label>
                <Input
                  id="ns-dest-port"
                  placeholder="e.g. Hamburg"
                  value={destinationPort}
                  onChange={(e) => setDestinationPort(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="ns-dest-country">Destination country</Label>
                <Input
                  id="ns-dest-country"
                  placeholder="e.g. Germany"
                  value={destinationCountry}
                  onChange={(e) => setDestinationCountry(e.target.value)}
                />
              </div>
            </div>

            {/* Vessel + voyage */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="ns-vessel">Vessel</Label>
                <Input
                  id="ns-vessel"
                  placeholder="Vessel name"
                  value={vessel}
                  onChange={(e) => setVessel(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="ns-voyage">Voyage no.</Label>
                <Input
                  id="ns-voyage"
                  placeholder="e.g. 001W"
                  value={voyageNo}
                  onChange={(e) => setVoyageNo(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="ns-incoterm">Incoterm</Label>
                <Select
                  id="ns-incoterm"
                  value={incoterm}
                  onChange={(e) => setIncoterm(e.target.value)}
                >
                  {["FOB", "CIF", "CFR", "EXW", "DDP", "DAP"].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Currency + dates */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="ns-currency">Currency</Label>
                <Select
                  id="ns-currency"
                  value={currencyCode}
                  onChange={(e) => setCurrencyCode(e.target.value)}
                >
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="ns-etd">ETD</Label>
                <Input
                  id="ns-etd"
                  type="date"
                  value={etd}
                  onChange={(e) => setEtd(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="ns-eta">ETA</Label>
                <Input
                  id="ns-eta"
                  type="date"
                  value={eta}
                  onChange={(e) => setEta(e.target.value)}
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <Label htmlFor="ns-notes">Notes</Label>
              <Textarea
                id="ns-notes"
                placeholder="Optional notes…"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {/* Linked orders */}
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">
                Link sales orders{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (confirmed / in-production)
                </span>
              </p>
              {orders.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No confirmed or in-production orders available.
                </p>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-surface-muted p-2">
                  {orders.map((o) => (
                    <label
                      key={o.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-border"
                    >
                      <input
                        type="checkbox"
                        checked={selectedOrderIds.includes(o.id)}
                        onChange={() => toggleOrder(o.id)}
                        className="accent-primary"
                      />
                      <span className="text-sm">
                        <span className="font-mono font-medium">
                          {o.order_number ?? o.id.slice(0, 8)}
                        </span>
                        {o.buyers && (
                          <span className="ml-2 text-muted-foreground">
                            {o.buyers.name}
                          </span>
                        )}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {o.currency_code} {o.fob_price}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {selectedOrderIds.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedOrderIds.length} order{selectedOrderIds.length !== 1 ? "s" : ""} selected
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating…" : "Create shipment"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
