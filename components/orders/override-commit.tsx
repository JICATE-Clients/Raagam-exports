"use client";

import { useState, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldRow } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { DetailSection } from "@/components/masters/detail-section";
import { fmtDateTime } from "@/lib/format";
import {
  overrideKeyLabel,
  reasonProblem,
  type AreaOverride,
  type OverrideKey,
} from "@/lib/orders/overrides/override-modules";

/**
 * OVERRIDE EDIT MODE on the four order editors (doc/email role system.md §7.2).
 *
 * Two pieces every editor shares, so the four cannot drift into four dialects:
 *
 *  - `OverrideBanner` — the sentence in `MasterFullScreen`'s lock band, in
 *    place of the approved-lock sentence, whenever `areaOverride()` applies:
 *    which version the save edits in place, and when the access runs out.
 *  - `useOverrideCommit()` — Save becomes "Commit Changes (Override)": a small
 *    sheet that takes the mandatory reason (R-16) and the modules this save
 *    uses, then hands `{ reason, keys }` to the editor's own save, which passes
 *    it to its update action as `override`. The action opens the commit, runs
 *    the unchanged save, closes the commit — see lib/orders/overrides/commit.ts.
 *
 * A REFUSAL KEEPS THE FORM (spec §7.2). If the access expired or was revoked
 * mid-session the server refuses with its sentence; the editor toasts it and
 * stays open with every value the operator typed, exactly as on any failed
 * save — nothing here resets the editor's state.
 */

export function OverrideBanner({ override }: { override: AreaOverride }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
      <strong className="font-semibold">Override edit mode</strong>
      <span>
        — changes save directly to approved version {override.version}. Access expires{" "}
        {fmtDateTime(override.expiresAt)} ({override.keys.map(overrideKeyLabel).join(", ")}).
      </span>
    </span>
  );
}

export type OverrideSaveRequest = { reason: string; keys: OverrideKey[] };

type Pending = {
  offered: OverrideKey[];
  version: string;
  onConfirm: (o: OverrideSaveRequest) => void;
};

/**
 * `request(override, onConfirm)` opens the dialog; `dialog` is the element the
 * editor renders once. Declare the hook with the editor's other hooks, ABOVE
 * any early return (AGENTS.md, "Hooks above every early return").
 */
export function useOverrideCommit(): {
  request: (override: AreaOverride, onConfirm: (o: OverrideSaveRequest) => void) => void;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const [chosen, setChosen] = useState<OverrideKey[]>([]);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);

  function request(override: AreaOverride, onConfirm: (o: OverrideSaveRequest) => void) {
    setPending({ offered: override.keys, version: override.version, onConfirm });
    setChosen(override.keys);
    setReason("");
    setTried(false);
  }

  const reasonErr = tried ? reasonProblem(reason) : null;
  const keysErr = tried && chosen.length === 0 ? "Choose at least one module this save changes." : null;

  function confirm() {
    setTried(true);
    if (!pending || reasonProblem(reason) || chosen.length === 0) return;
    const go = pending.onConfirm;
    const payload = { reason: reason.trim(), keys: chosen };
    setPending(null);
    go(payload);
  }

  const dialog = (
    <Sheet
      open={!!pending}
      onClose={() => setPending(null)}
      size="sm"
      title="Commit Changes (Override)"
      footer={
        <>
          <Button variant="outline" size="md" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button size="md" onClick={confirm}>
            Commit changes
          </Button>
        </>
      }
    >
      <DetailSection label={`Saves into approved version ${pending?.version ?? ""}`} cols={1}>
        {/* What the operator is about to do, in the three sentences the spec
            asks them to have read: in place (R-6), audited to the MD (R-7,
            R-18), and no purchase order follows it (D-9). */}
        <p className="text-sm text-muted-foreground">
          No revision and no MD approval — the approved version changes in place. Every changed field is
          recorded with your reason in the Override Edit Report. Purchase orders already raised for this
          order are not changed.
        </p>
        {pending && pending.offered.length > 1 && (
          <Field label="Modules This Save Changes" required error={keysErr}>
            <FieldRow>
              {pending.offered.map((k) => (
                <label key={k} className="flex min-h-9 w-fit cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={chosen.includes(k)}
                    onChange={(e) =>
                      setChosen((c) => (e.target.checked ? [...c, k] : c.filter((x) => x !== k)))
                    }
                  />
                  <span className="text-sm text-foreground">{overrideKeyLabel(k)}</span>
                </label>
              ))}
            </FieldRow>
          </Field>
        )}
        <Field label="Reason" required htmlFor="override-commit-reason" error={reasonErr}>
          <Textarea
            id="override-commit-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </DetailSection>
    </Sheet>
  );

  return { request, dialog };
}
