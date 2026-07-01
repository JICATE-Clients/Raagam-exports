"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCost, deleteCost, pullMaterialsCost } from "@/lib/finance/pnl-actions";
import { fmtMoney } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { COST_TYPES } from "@/lib/finance/types";
import type { ShipmentCost, CostType } from "@/lib/finance/types";

const COST_TYPE_LABELS: Record<CostType, string> = {
  materials: "Materials",
  labour: "Labour",
  overhead: "Overhead",
  freight: "Freight",
  other: "Other",
};

// Manual cost types only (materials is managed via Pull action)
const MANUAL_COST_TYPES = COST_TYPES.filter((t) => t !== "materials");

interface Props {
  shipmentId: string;
  costs: ShipmentCost[];
}

export function PnlDetailClient({ shipmentId, costs }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPulling, startPull] = useTransition();
  const [isDeleting, startDelete] = useTransition();
  const [isAdding, startAdd] = useTransition();
  const [showAddForm, setShowAddForm] = useState(false);

  const [costType, setCostType] = useState<CostType>("labour");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  function resetForm() {
    setCostType("labour");
    setDescription("");
    setAmount("");
  }

  function handlePull() {
    startPull(async () => {
      const result = await pullMaterialsCost(shipmentId);
      if (result.ok) {
        success("Materials cost pulled from purchase orders");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleDelete(costId: string) {
    startDelete(async () => {
      const result = await deleteCost(costId, shipmentId);
      if (result.ok) {
        success("Cost line removed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    startAdd(async () => {
      const result = await addCost({
        shipment_id: shipmentId,
        cost_type: costType,
        description: description || null,
        amount: parseFloat(amount) || 0,
      });
      if (result.ok) {
        success("Cost line added");
        router.refresh();
        setShowAddForm(false);
        resetForm();
      } else {
        toastError(result.error);
      }
    });
  }

  const manualCosts = costs.filter((c) => c.source === "manual");

  return (
    <div className="space-y-4">
      {/* Primary actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={handlePull} disabled={isPulling}>
          {isPulling ? "Pulling…" : "Pull materials cost"}
        </Button>
        <Button
          variant="subtle"
          onClick={() => {
            setShowAddForm((v) => !v);
            resetForm();
          }}
        >
          {showAddForm ? "Cancel" : "Add cost line"}
        </Button>
      </div>

      {/* Add cost form */}
      {showAddForm && (
        <Card>
          <CardHeader>
            <CardTitle>Add cost line</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="ac-type">Type</Label>
                  <Select
                    id="ac-type"
                    value={costType}
                    onChange={(e) => setCostType(e.target.value as CostType)}
                  >
                    {MANUAL_COST_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {COST_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="ac-amount">Amount (INR)</Label>
                  <Input
                    id="ac-amount"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="ac-desc">Description</Label>
                  <Input
                    id="ac-desc"
                    placeholder="Optional"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowAddForm(false);
                    resetForm();
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isAdding}>
                  {isAdding ? "Adding…" : "Add"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {/* Editable manual cost lines */}
      {manualCosts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Manual cost lines</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                    Type
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                    Description
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                    Amount (INR)
                  </th>
                  <th className="w-20 px-3 py-2 text-xs font-semibold text-muted-foreground" />
                </tr>
              </thead>
              <tbody>
                {manualCosts.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-border last:border-0 hover:bg-surface-muted/60"
                  >
                    <td className="px-3 py-2">
                      {COST_TYPE_LABELS[c.cost_type]}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {c.description ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtMoney(c.amount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isDeleting}
                        onClick={() => handleDelete(c.id)}
                        className="text-danger hover:text-danger"
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
