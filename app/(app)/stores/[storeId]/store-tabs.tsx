"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtNumber } from "@/lib/format";
import {
  recordMovement,
  transferStock,
  grantStoreAccess,
  revokeStoreAccess,
} from "@/lib/stores/actions";
import {
  MOVEMENT_TYPE_LABELS,
  movementSign,
  isInbound,
  type MovementType,
  type Store,
} from "@/lib/stores/types";
import type {
  BalanceWithItem,
  LedgerWithItem,
  AccessWithProfile,
} from "@/lib/stores/service";
import type { StatusTone } from "@/components/ui/status-pill";
import type { Item } from "@/lib/masters/types";

// ---------- helpers ----------

/** Movement types recordable directly (excludes system-managed transfer_in / transfer_out). */
type ManualMovementType = "receipt" | "issue" | "return" | "adjust_in" | "adjust_out";

const MANUAL_MOVEMENT_TYPES: ManualMovementType[] = [
  "receipt",
  "issue",
  "return",
  "adjust_in",
  "adjust_out",
];

/** UI mode extends manual types with a synthetic "transfer" option. */
type UIMode = ManualMovementType | "transfer";

function movementTone(type: MovementType): StatusTone {
  return isInbound(type) ? "success" : "warning";
}

// ---------- Live Balances tab ----------

function BalancesTab({ balances }: { balances: BalanceWithItem[] }) {
  const columns: Column<BalanceWithItem>[] = [
    {
      header: "Item code",
      cell: (b) => (
        <span className="font-mono text-xs font-semibold">{b.item_code}</span>
      ),
    },
    {
      header: "Item name",
      cell: (b) => <span className="text-sm">{b.item_name}</span>,
    },
    {
      header: "Quantity",
      align: "right",
      cell: (b) => (
        <span
          className={cn(
            "tabular-nums text-sm font-medium",
            b.quantity <= 0 && "text-danger",
          )}
        >
          {fmtNumber(b.quantity)}
        </span>
      ),
    },
    {
      header: "Last updated",
      cell: (b) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {fmtDate(b.updated_at)}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={balances}
      getKey={(b) => `${b.store_id}-${b.item_id}`}
      empty="No stock on hand in this store."
    />
  );
}

// ---------- Ledger tab ----------

function LedgerTab({ ledger }: { ledger: LedgerWithItem[] }) {
  const columns: Column<LedgerWithItem>[] = [
    {
      header: "Date",
      cell: (e) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {fmtDate(e.created_at)}
        </span>
      ),
    },
    {
      header: "Type",
      cell: (e) => (
        <StatusPill tone={movementTone(e.movement_type)}>
          {MOVEMENT_TYPE_LABELS[e.movement_type]}
        </StatusPill>
      ),
    },
    {
      header: "Item",
      cell: (e) => (
        <div className="leading-tight">
          <span className="font-mono text-xs text-muted-foreground">
            {e.item_code}
          </span>{" "}
          <span className="text-sm">{e.item_name}</span>
        </div>
      ),
    },
    {
      header: "Qty",
      align: "right",
      cell: (e) => {
        const sign = movementSign(e.movement_type);
        const signed = sign * e.quantity;
        return (
          <span
            className={cn(
              "tabular-nums text-sm font-medium",
              signed > 0 ? "text-success" : "text-danger",
            )}
          >
            {signed > 0 ? "+" : ""}
            {fmtNumber(signed)}
          </span>
        );
      },
    },
    {
      header: "Reference",
      cell: (e) => (
        <span className="text-xs text-muted-foreground">
          {e.reference_type ?? "—"}
        </span>
      ),
    },
    {
      header: "Note",
      cell: (e) => (
        <span className="max-w-48 truncate text-xs text-muted-foreground">
          {e.note ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={ledger}
      getKey={(e) => e.id}
      empty="No transactions recorded yet."
    />
  );
}

// ---------- Movements tab ----------

function MovementsTab({
  storeId,
  items,
  transferStores,
}: {
  storeId: string;
  items: Pick<Item, "id" | "code" | "name">[];
  transferStores: Pick<Store, "id" | "code" | "name">[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [mode, setMode] = useState<UIMode>("receipt");
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [toStoreId, setToStoreId] = useState(transferStores[0]?.id ?? "");
  const [note, setNote] = useState("");

  const isTransfer = mode === "transfer";

  function resetForm() {
    setQty("");
    setNote("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const quantity = Number(qty);
    if (!quantity || quantity <= 0) {
      toastError("Quantity must be greater than zero");
      return;
    }
    if (!itemId) {
      toastError("Please select an item");
      return;
    }
    if (isTransfer && !toStoreId) {
      toastError("Please select a destination store");
      return;
    }

    startTransition(async () => {
      const result = isTransfer
        ? await transferStock({
            from_store_id: storeId,
            to_store_id: toStoreId,
            item_id: itemId,
            quantity,
            note: note || null,
          })
        : await recordMovement({
            store_id: storeId,
            item_id: itemId,
            movement_type: mode as Exclude<UIMode, "transfer">,
            quantity,
            note: note || null,
          });

      if (result.ok) {
        const label = isTransfer
          ? "Transfer recorded"
          : `${MOVEMENT_TYPE_LABELS[mode as MovementType]} recorded`;
        success(label);
        resetForm();
        router.refresh();
      } else {
        toastError(result.error ?? "Operation failed");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record movement</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Movement type / mode */}
          <div>
            <Label htmlFor="mv-mode">Type</Label>
            <Select
              id="mv-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as UIMode)}
            >
              {MANUAL_MOVEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MOVEMENT_TYPE_LABELS[t]}
                </option>
              ))}
              <option value="transfer">Transfer to another store</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Item */}
            <div>
              <Label htmlFor="mv-item">Item</Label>
              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground">No active items found.</p>
              ) : (
                <Select
                  id="mv-item"
                  value={itemId}
                  onChange={(e) => setItemId(e.target.value)}
                  required
                >
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.code} — {it.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>

            {/* Quantity */}
            <div>
              <Label htmlFor="mv-qty">Quantity</Label>
              <Input
                id="mv-qty"
                type="number"
                min="0.001"
                step="any"
                placeholder="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Destination store — only for transfers */}
          {isTransfer && (
            <div>
              <Label htmlFor="mv-to-store">Destination store</Label>
              {transferStores.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No other accessible stores to transfer to.
                </p>
              ) : (
                <Select
                  id="mv-to-store"
                  value={toStoreId}
                  onChange={(e) => setToStoreId(e.target.value)}
                  required
                >
                  {transferStores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          )}

          {/* Note */}
          <div>
            <Label htmlFor="mv-note">Note (optional)</Label>
            <Input
              id="mv-note"
              placeholder="e.g. PO#1234 / reason…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={isPending || items.length === 0}
            >
              {isPending
                ? "Saving…"
                : isTransfer
                  ? "Transfer"
                  : "Record"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={resetForm}
              disabled={isPending}
            >
              Clear
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

// ---------- Access tab ----------

function AccessTab({
  storeId,
  accessRows,
  profiles,
}: {
  storeId: string;
  accessRows: AccessWithProfile[];
  profiles: { id: string; full_name: string | null; email: string | null }[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");

  // Profiles not yet granted access
  const grantedIds = new Set(accessRows.map((a) => a.user_id));
  const eligible = profiles.filter((p) => !grantedIds.has(p.id));

  function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUserId) {
      toastError("Please select a user");
      return;
    }
    startTransition(async () => {
      const result = await grantStoreAccess({
        user_id: selectedUserId,
        store_id: storeId,
      });
      if (result.ok) {
        success("Access granted");
        setShowForm(false);
        setSelectedUserId("");
        router.refresh();
      } else {
        toastError(result.error ?? "Failed to grant access");
      }
    });
  }

  function handleRevoke(accessId: string) {
    startTransition(async () => {
      const result = await revokeStoreAccess(accessId);
      if (result.ok) {
        success("Access revoked");
        router.refresh();
      } else {
        toastError(result.error ?? "Failed to revoke access");
      }
    });
  }

  const accessColumns: Column<AccessWithProfile>[] = [
    {
      header: "Name",
      cell: (a) => (
        <span className="text-sm font-medium">{a.full_name ?? "—"}</span>
      ),
    },
    {
      header: "Email",
      cell: (a) => (
        <span className="text-sm text-muted-foreground">{a.email ?? "—"}</span>
      ),
    },
    {
      header: "Action",
      cell: (a) => (
        <Button
          size="sm"
          variant="danger"
          onClick={() => handleRevoke(a.id)}
          disabled={isPending}
          className="h-7 px-2 text-xs"
        >
          Revoke
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <DataTable
        columns={accessColumns}
        rows={accessRows}
        getKey={(a) => a.id}
        empty="No store keepers assigned — managers and admins have implicit access via RLS."
      />

      {showForm ? (
        <form
          onSubmit={handleGrant}
          className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface-muted p-3"
        >
          <div className="min-w-48 flex-1">
            <Label htmlFor="ac-user">User</Label>
            {eligible.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                All profiles already have access to this store.
              </p>
            ) : (
              <Select
                id="ac-user"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
              >
                <option value="">— select user —</option>
                {eligible.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? p.email ?? p.id}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={isPending || eligible.length === 0}
            >
              {isPending ? "Granting…" : "Grant access"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setShowForm(false);
                setSelectedUserId("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button size="sm" variant="subtle" onClick={() => setShowForm(true)}>
          + Grant access
        </Button>
      )}
    </div>
  );
}

// ---------- main export ----------

interface StoreTabsProps {
  store: Store;
  balances: BalanceWithItem[];
  ledger: LedgerWithItem[];
  items: Pick<Item, "id" | "code" | "name">[];
  transferStores: Pick<Store, "id" | "code" | "name">[];
  accessRows: AccessWithProfile[];
  profiles: { id: string; full_name: string | null; email: string | null }[];
  canApprove: boolean;
}

export function StoreTabs({
  store,
  balances,
  ledger,
  items,
  transferStores,
  accessRows,
  profiles,
  canApprove,
}: StoreTabsProps) {
  const tabItems = [
    {
      key: "balances",
      label: `Live Balances (${balances.length})`,
      content: <BalancesTab balances={balances} />,
    },
    {
      key: "ledger",
      label: `Ledger (${ledger.length})`,
      content: <LedgerTab ledger={ledger} />,
    },
    {
      key: "movements",
      label: "Movements",
      content: (
        <MovementsTab
          storeId={store.id}
          items={items}
          transferStores={transferStores}
        />
      ),
    },
    ...(canApprove
      ? [
          {
            key: "access",
            label: `Access (${accessRows.length})`,
            content: (
              <AccessTab
                storeId={store.id}
                accessRows={accessRows}
                profiles={profiles}
              />
            ),
          },
        ]
      : []),
  ];

  return <Tabs items={tabItems} defaultKey="balances" />;
}
