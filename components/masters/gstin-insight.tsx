"use client";

// Read-only strip shown under the GST Number field once a well-shaped GSTIN has
// been typed. Everything it shows is decoded from the number itself — no lookup,
// no network. See lib/validation/gstin.ts.
//
// It renders BELOW the GST pair spanning both grid columns, not in the one-line
// slot directly under the input: that slot belongs to ValidatedInput's own
// format error. The two can never collide anyway, because this strip only
// appears once the shape is already valid.

import { TriangleAlert, CircleAlert } from "lucide-react";
import type { GstinDecoded } from "@/lib/validation/gstin";

export type GstinSuggestion = { key: string; label: string; onApply: () => void };

export function GstinInsight({
  decoded,
  panValue,
  suggestions,
}: {
  decoded: GstinDecoded;
  panValue: string;
  suggestions: GstinSuggestion[];
}) {
  const panMismatch =
    decoded.checksumValid &&
    panValue.trim().toUpperCase() !== "" &&
    panValue.trim().toUpperCase() !== decoded.pan;

  // What the number itself says. Shown even when the checksum fails — the state
  // and PAN are still readable and worth seeing.
  const facts = [
    decoded.stateName
      ? `${decoded.stateName} (${decoded.stateCode})`
      : `State code ${decoded.stateCode} — unrecognised`,
    `PAN ${decoded.pan}`,
    decoded.constitution,
    `Reg #${decoded.registrationSerial}`,
    decoded.supply === "intra" ? "Within State" : decoded.supply === "inter" ? "Other State" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="mt-1 space-y-1 text-xs">
      <p className="text-muted-foreground">
        {facts.map((f, i) => (
          <span key={f}>
            {i > 0 && <span className="px-1 opacity-50">·</span>}
            <span className={f.startsWith("PAN ") ? "font-mono" : undefined}>{f}</span>
          </span>
        ))}
      </p>

      {!decoded.checksumValid && (
        <p className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {/* Party-neutral wording: this strip is shown on vendor, customer,
              consignee AND our own company profile, where "verify with the
              vendor" read as nonsense. */}
          Check digit doesn&apos;t match — verify this number against the GST certificate.
        </p>
      )}

      {panMismatch && (
        <p className="flex items-center gap-1 text-destructive">
          <CircleAlert className="h-4 w-4 shrink-0" />
          PAN mismatch — this GSTIN carries <span className="font-mono">{decoded.pan}</span>.
        </p>
      )}

      {suggestions.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-muted-foreground">
          {suggestions.map((s) => (
            <button
              key={s.key}
              type="button"
              // Derived/advisory control: clickable, but kept out of the Tab
              // order so Tab still runs GST Number -> the next real field.
              tabIndex={-1}
              onClick={s.onApply}
              className="rounded border border-border px-1.5 py-0.5 font-medium text-primary hover:bg-primary/10"
            >
              {s.label}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}
