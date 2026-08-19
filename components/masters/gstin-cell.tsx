"use client";

// One GSTIN box in a bulk-assign grid ("GST Assign to Vendors" / "…Customers"),
// with the free offline intelligence attached: shape validation, the mod-36
// check digit, the state the number names, and — where the caller knows what to
// expect — whether that state agrees with the party's own classification.
//
// Everything here is decoded from the 15 characters. No lookup, no network, no
// cost. See lib/validation/gstin.ts.
//
// Why a component rather than two copies: the two assign screens are the
// HIGHEST-volume GSTIN entry points in the app (one screen, every vendor) and
// were the only ones with no validation at all — a plain <Input> that did not
// even uppercase. Splitting the rule across two files is how they drifted apart
// the first time (see GST_STATE_ALIASES).

import { useMemo } from "react";
import { TriangleAlert } from "lucide-react";
import { ValidatedInput } from "@/components/ui/validated-input";
import { decodeGstin, type GstinDecoded } from "@/lib/validation/gstin";
import { cn } from "@/lib/utils";

export type GstinProblem = "invalid" | "checkdigit" | "supply" | null;

/**
 * What is wrong with this cell's value, worst first — the same computation the
 * grid's counters and Save guard use, so the row marker and the footer can
 * never disagree.
 *
 * `expectSupply` is the supply type the ROW implies (a vendor marked
 * "With in State" implies "intra"); pass null when the row does not say.
 */
export function gstinProblem(
  value: string | null | undefined,
  companyGstin?: string | null,
  expectSupply?: "intra" | "inter" | null,
): GstinProblem {
  const v = (value ?? "").trim();
  if (!v) return null; // empty is "not filled in yet", not "wrong"
  const decoded = decodeGstin(v, { companyGstin });
  if (!decoded) return "invalid";
  if (!decoded.checksumValid) return "checkdigit";
  if (expectSupply && decoded.supply !== "unknown" && decoded.supply !== expectSupply) return "supply";
  return null;
}

export function GstinCell({
  value,
  onChange,
  disabled,
  label,
  companyGstin,
  expectSupply,
  expectLabel,
  className,
}: {
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Names the row, e.g. "GSTIN for Acme Textiles" — this grid has no <label>. */
  label: string;
  /** Our own GSTIN, for the within-state / other-state reading. */
  companyGstin?: string | null;
  /** What the row's own classification implies; null when it says nothing. */
  expectSupply?: "intra" | "inter" | null;
  /** How that classification is worded on this screen, e.g. "With in State". */
  expectLabel?: string | null;
  className?: string;
}) {
  const decoded: GstinDecoded | null = useMemo(
    () => decodeGstin(value, { companyGstin }),
    [value, companyGstin],
  );

  const supplyMismatch =
    !!decoded?.checksumValid &&
    !!expectSupply &&
    decoded.supply !== "unknown" &&
    decoded.supply !== expectSupply;

  return (
    <div className={cn("w-40", className)}>
      {/* ValidatedInput, not Input: it carries the SAME gstin rule, message and
          reveal timing (on blur / on Enter) as every GSTIN box on the master
          forms, plus the uppercase transform this grid was missing — a
          lowercase GSTIN typed here used to save lowercase and then fail the
          master form's own validation on the next edit. */}
      <ValidatedInput
        format="gstin"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label}
        className="h-8 w-full font-mono text-base md:text-sm"
      />

      {decoded && (
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px] leading-tight">
          <span className="text-muted-foreground">
            {decoded.stateName ?? `State ${decoded.stateCode}?`}
          </span>

          {!decoded.checksumValid && (
            <span
              className="flex items-center gap-0.5 text-amber-600 dark:text-amber-500"
              title="The check digit does not match — this number has a typo in it. Verify it against the GST certificate."
            >
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              check digit
            </span>
          )}

          {/* The commercial point of the free tier: the state in the GSTIN is
              what decides IGST vs CGST+SGST, so a number that disagrees with the
              party's own classification means one of the two is wrong. Advisory
              — the field it contradicts is not editable here. */}
          {supplyMismatch && (
            <span
              className="flex items-center gap-0.5 text-amber-600 dark:text-amber-500"
              title={`This GSTIN is ${
                decoded.supply === "intra" ? "within our state" : "another state"
              }, but the record says ${expectLabel ?? "otherwise"}.`}
            >
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              {decoded.supply === "intra" ? "within state" : "other state"}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
