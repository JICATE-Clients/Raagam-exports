"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { createOpportunity } from "@/lib/sales/actions";
import { OPPORTUNITY_STAGES } from "@/lib/sales/types";
import type { Buyer } from "@/lib/masters/types";

interface Props {
  buyers: Buyer[];
}

export function NewOpportunityForm({ buyers }: Props) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  // form state
  const [buyerId, setBuyerId] = useState("");
  const [title, setTitle] = useState("");
  const [season, setSeason] = useState("");
  const [stage, setStage] = useState<(typeof OPPORTUNITY_STAGES)[number]>("enquiry");
  const [targetFob, setTargetFob] = useState("");
  const [currencyCode, setCurrencyCode] = useState("USD");

  function reset() {
    setBuyerId("");
    setTitle("");
    setSeason("");
    setStage("enquiry");
    setTargetFob("");
    setCurrencyCode("USD");
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
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              <Label htmlFor="nof-season">Season</Label>
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

            <div className="flex items-end sm:col-span-2 lg:col-span-3">
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
