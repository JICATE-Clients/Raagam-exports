"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { moveYarnAtKnitter } from "@/lib/production/knitting-actions";
import type { KnitYarnAtKnitter, KnittingOrder } from "@/lib/production/knitting-types";

/**
 * KNITTING ORDER ▸ Tab 2 — YARN ALREADY AT THE KNITTER (client 2026-11-11, DB 0833).
 *
 * The same yarn, left at this knitter on another open Knitting Order (an elastane cone kept at
 * the vendor), is put on THIS order without a transport DC. The server moves the kg off the
 * other order's DC lines and raises a paper DC here, so this order's +1-bag cap (D2), its fabric
 * receipts and its close treat it exactly like yarn sent from the store. Only the RE that owns
 * the yarn changes; nothing leaves the Processing store.
 */
export function KnitAtKnitterPanel({ doc, rows }: { doc: KnittingOrder; rows: KnitYarnAtKnitter[] }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [kg, setKg] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<KnitYarnAtKnitter | null>(null);
  const dirty = Object.values(kg).some((v) => v.trim() !== "");
  useUnsavedGuard(dirty || isPending);

  /** This order's lines for that yarn — one per fabric that uses it. */
  const targetsFor = (r: KnitYarnAtKnitter) =>
    doc.fabrics.flatMap((f) => f.yarns.filter((y) => y.yarn_item_id === r.yarn_item_id).map((y) => ({ id: y.id, label: `${f.fabric_name} (${fmtNumber(y.blend_pct)}%)` })));
  const targetOf = (r: KnitYarnAtKnitter) => target[r.from_yarn_id] || targetsFor(r)[0]?.id || "";
  const kgOf = (r: KnitYarnAtKnitter) => {
    const v = Number(kg[r.from_yarn_id] ?? "");
    return Number.isFinite(v) ? v : 0;
  };
  const problemOf = (r: KnitYarnAtKnitter) => (kgOf(r) > r.at_knitter_kg + 1e-9 ? `Only ${fmtNumber(r.at_knitter_kg)} kg is there` : null);

  function move(r: KnitYarnAtKnitter) {
    start(async () => {
      const res = await moveYarnAtKnitter(doc.id, { from_yarn_id: r.from_yarn_id, to_yarn_id: targetOf(r), kg: kgOf(r), note: null });
      setConfirm(null);
      if (!res.ok) return toastError(res.error);
      success(`${fmtNumber(kgOf(r))} kg moved onto ${doc.code ?? "this order"} — no DC to the knitter needed`);
      setKg((m) => ({ ...m, [r.from_yarn_id]: "" }));
      router.refresh();
    });
  }

  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <div>
        <h3 className="text-sm font-semibold">Yarn already at the knitter</h3>
        <p className="text-xs text-muted-foreground">On other open orders of this knitter. Moving it here needs no DC — the yarn does not travel.</p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1 font-medium">On order</th>
            <th className="py-1 font-medium">Yarn</th>
            <th className="py-1 text-right font-medium">At knitter</th>
            <th className="py-1 font-medium">For fabric</th>
            <th className="py-1 text-right font-medium">Kg to move</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const targets = targetsFor(r);
            const problem = problemOf(r);
            return (
              <tr key={r.from_yarn_id} className="border-t border-border align-top">
                <td className="py-1">
                  <span className="font-mono text-xs">{r.from_order_code ?? "—"}</span>
                  {r.from_re_no ? <div className="text-[11px] text-muted-foreground">RE {r.from_re_no}</div> : null}
                </td>
                <td className="py-1">
                  {r.yarn_name}
                  <div className="text-[11px] text-muted-foreground">for {r.fabric}</div>
                </td>
                <td className="py-1 text-right tabular-nums">{fmtNumber(r.at_knitter_kg)}</td>
                <td className="w-56 py-1">
                  {targets.length > 1 ? (
                    <Select aria-label={`Fabric on ${doc.code ?? "this order"} for ${r.yarn_name}`} value={targetOf(r)} onChange={(e) => setTarget((m) => ({ ...m, [r.from_yarn_id]: e.target.value }))}>
                      {targets.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-sm">{targets[0]?.label ?? "—"}</span>
                  )}
                </td>
                <td className="w-28 py-1">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    aria-label={`Kg of ${r.yarn_name} to move from ${r.from_order_code ?? "the other order"}`}
                    aria-invalid={problem ? true : undefined}
                    title={problem ?? undefined}
                    className="text-right tabular-nums"
                    value={kg[r.from_yarn_id] ?? ""}
                    onChange={(e) => setKg((m) => ({ ...m, [r.from_yarn_id]: e.target.value }))}
                  />
                  {problem ? <div className="text-[11px] text-destructive">{problem}</div> : null}
                </td>
                <td className="py-1 pl-2 text-right">
                  <Button type="button" variant="outline" disabled={isPending || kgOf(r) <= 0 || !!problem || !targetOf(r)} onClick={() => setConfirm(r)}>
                    Move here
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ConfirmDialog
        open={!!confirm}
        title={confirm ? `Move ${fmtNumber(kgOf(confirm))} kg of ${confirm.yarn_name} onto ${doc.code ?? "this order"}?` : ""}
        body={
          confirm
            ? `It stays at the knitter. It comes off ${confirm.from_order_code ?? "the other order"} and counts as sent on ${doc.code ?? "this order"}, within its balance to send. A paper DC records the move; nothing is printed for transport. This cannot be undone.`
            : ""
        }
        confirmLabel="Move"
        tone="primary"
        isPending={isPending}
        onConfirm={() => confirm && move(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}
