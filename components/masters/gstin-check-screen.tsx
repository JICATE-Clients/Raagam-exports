"use client";

// ============================================================================
// "GST Number Check" — a TEST screen, not a master.
//
// It saves nothing and owns no table. Type a GST number and it lists every
// detail the system can derive from it, one row per detail, so it is obvious at
// a glance WHICH details are actually fetched and which are not.
//
// That last part is the point. The free tier reads the 15 characters
// (lib/validation/gstin.ts) — state, PAN, constitution, serial, check digit,
// within-state vs other-state. The registry facts (legal name, trade name,
// whether the registration is still ACTIVE) can only come from a paid lookup,
// which is built but dormant. On a form those simply do not appear, so "are all
// the details fetched?" has no visible answer. Here both halves are listed
// together, the second half marked as not fetched and why.
// ============================================================================

import { useMemo, useState } from "react";
import { Check, X, TriangleAlert, Minus, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  decodeGstin,
  matchGstinState,
  normalizeGstin,
  gstinCheckDigit,
  GST_STATE_NAMES,
} from "@/lib/validation/gstin";
import { GSTIN_RE } from "@/lib/validation/formats";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import { cn } from "@/lib/utils";

/** Numbers worth having one click away when testing. */
const SAMPLES = [
  { label: "Valid · Tamil Nadu", value: "33ABCDE1234F1Z7" },
  { label: "Valid · Maharashtra", value: "27AAPFU0939F1ZV" },
  { label: "Valid · Company (C)", value: "29AAGCB7383J1Z4" },
  { label: "Wrong check digit", value: "33ABCDE1234F1Z5" },
  { label: "Not a GSTIN", value: "ABCDEFGHIJKLMNO" },
];

type Tone = "ok" | "bad" | "warn" | "muted" | "locked";

function Row({
  label,
  value,
  tone = "muted",
  note,
  mono,
}: {
  label: string;
  value: string;
  tone?: Tone;
  note?: string;
  mono?: boolean;
}) {
  const Icon =
    tone === "ok" ? Check : tone === "bad" ? X : tone === "warn" ? TriangleAlert : tone === "locked" ? Lock : Minus;
  return (
    <div className="flex items-start gap-3 border-b border-border px-3 py-2 last:border-0">
      <span className="w-52 shrink-0 text-[12.5px] text-muted-foreground">{label}</span>
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          tone === "ok" && "text-accent",
          tone === "bad" && "text-danger",
          tone === "warn" && "text-amber-600 dark:text-amber-500",
          (tone === "muted" || tone === "locked") && "text-muted-foreground/50",
        )}
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-[13.5px] text-foreground",
            mono && "font-mono",
            tone === "bad" && "text-danger",
            tone === "warn" && "text-amber-600 dark:text-amber-500",
            (tone === "muted" || tone === "locked") && "text-muted-foreground",
          )}
        >
          {value}
        </div>
        {note && <div className="mt-0.5 text-[11.5px] text-muted-foreground">{note}</div>}
      </div>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-3 py-2">
        <h3 className="text-[13.5px] font-bold tracking-tight text-foreground">{title}</h3>
        <p className="text-[11.5px] text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}

export function GstinCheckScreen({
  states,
  companyGstin,
}: {
  /** The State master, so the screen can show WHICH row a code resolves to. */
  states: ConfigLookup[];
  /** Our own GSTIN — the reference for within-state vs other-state. */
  companyGstin: string | null;
}) {
  const [raw, setRaw] = useState("");

  const value = normalizeGstin(raw);
  const decoded = useMemo(() => decodeGstin(value, { companyGstin }), [value, companyGstin]);
  const matchedState = useMemo(() => matchGstinState(decoded, states), [decoded, states]);
  const expectedDigit = value.length >= 14 ? gstinCheckDigit(value.slice(0, 14)) : null;
  const shapeOk = GSTIN_RE.test(value);

  return (
    <div className="max-w-3xl space-y-4">
      {/* The field and everything it yields, in ONE card — the details are a
          LIST in place, not a second set of form fields underneath. */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <label htmlFor="gc-no" className="text-[12.5px] font-semibold text-foreground">
          GST Number
        </label>
        <p className="mb-2 text-[11.5px] text-muted-foreground">
          Type or paste any GSTIN. Nothing is saved and nothing is looked up online — every row
          below is read out of the 15 characters themselves.
        </p>
        <Input
          id="gc-no"
          uppercase
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          maxLength={15}
          placeholder="33ABCDE1234F1Z7"
          autoComplete="off"
          className="w-full max-w-sm font-mono text-base tracking-wide"
        />

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] text-muted-foreground">Try:</span>
          {SAMPLES.map((s) => (
            <button
              key={s.value}
              type="button"
              // Advisory control, kept out of the Tab order like the chips on
              // GstinInsight — Tab still runs straight down the page.
              tabIndex={-1}
              onClick={() => setRaw(s.value)}
              className="rounded border border-border px-1.5 py-0.5 text-[11.5px] font-medium text-primary hover:bg-primary/10"
            >
              {s.label}
            </button>
          ))}
          {raw && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setRaw("")}
              className="ml-auto text-[11.5px] font-medium text-muted-foreground hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        {!value ? (
          <p className="mt-4 rounded-lg border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
            Enter a GST number to see what it contains.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <Group
              title="The number itself"
              hint="Structure and the mod-36 check digit — this is what catches a typo."
            >
              <Row label="Read as" value={value} mono tone="muted" />
              <Row
                label="Length"
                value={`${value.length} of 15`}
                tone={value.length === 15 ? "ok" : "bad"}
              />
              <Row
                label="Correct structure"
                value={shapeOk ? "Yes" : "No — this is not a GST number"}
                tone={shapeOk ? "ok" : "bad"}
                note={shapeOk ? undefined : "Expected 2 digits, 5 letters, 4 digits, letter, 1-9/A-Z, Z, then the check character."}
              />
              <Row
                label="Check digit"
                value={
                  expectedDigit == null
                    ? "Cannot be computed yet"
                    : value.length < 15
                      ? `Should end in ${expectedDigit}`
                      : decoded?.checksumValid
                        ? `${value[14]} — matches`
                        : `${value[14]} — should be ${expectedDigit}`
                }
                tone={
                  expectedDigit == null ? "muted" : value.length < 15 ? "muted" : decoded?.checksumValid ? "ok" : "warn"
                }
                note={
                  decoded && !decoded.checksumValid
                    ? "A warning, never a block — a number copied off an invoice stays savable while the party is chased."
                    : undefined
                }
              />
            </Group>

            {decoded ? (
              <Group
                title="Fetched from the number — free, offline"
                hint="No internet, no provider, no cost. Every one of these is derived on the spot."
              >
                <Row label="State code" value={decoded.stateCode} mono tone="ok" />
                <Row
                  label="State"
                  value={decoded.stateName ?? "Unrecognised code"}
                  tone={decoded.stateName ? "ok" : "bad"}
                  note={
                    decoded.stateName
                      ? undefined
                      : `Not one of the ${Object.keys(GST_STATE_NAMES).length} codes the GST system issues.`
                  }
                />
                <Row
                  label="State master row"
                  value={matchedState ? matchedState.name : "No matching row"}
                  tone={matchedState ? "ok" : "warn"}
                  note={
                    matchedState
                      ? `Matched on ${
                          (matchedState.code ?? "").trim().padStart(2, "0") === decoded.stateCode
                            ? "the state code"
                            : "the name / a known alternate spelling"
                        } — this is the row a "Set State" suggestion would write.`
                      : // The State master is a GST master, NOT an Associates one
                        // (`submodules.ts`: slug "state" under the GST submodule).
                        // This line read "Associates ▸ Country/State" until
                        // 2026-08-26 — the wrong sub-module, and a row name that
                        // is two names joined by a slash. Caught by
                        // `npm run check:nav-paths`, which is why that check
                        // resolves every segment rather than only the first.
                        "The State master has no row for this code, so no State can be suggested. Add one under Master Data ▸ GST ▸ State."
                  }
                />
                <Row label="PAN" value={decoded.pan} mono tone="ok" note="Characters 3-12 are the PAN, exactly." />
                <Row
                  label="Constitution"
                  value={decoded.constitution ?? `Unknown ("${decoded.panEntityChar}")`}
                  tone={decoded.constitution ? "ok" : "warn"}
                  note={`From the PAN's 4th character, "${decoded.panEntityChar}".`}
                />
                <Row
                  label="Registration serial"
                  value={`#${decoded.registrationSerial}`}
                  tone="ok"
                  note="Which registration this is for that PAN in that state."
                />
                <Row label="Entity code" value={decoded.entityCheckChar} mono tone="ok" note='"Z" on a normal registration.' />
                <Row
                  label="Supply type"
                  value={
                    decoded.supply === "intra"
                      ? "Within State — CGST + SGST"
                      : decoded.supply === "inter"
                        ? "Other State — IGST"
                        : "Unknown"
                  }
                  tone={decoded.supply === "unknown" ? "warn" : "ok"}
                  note={
                    decoded.supply === "unknown"
                      ? "Our own GSTIN is not set on the Company Profile, so there is nothing to compare against."
                      : `Compared against our own GSTIN (${companyGstin}), state ${normalizeGstin(companyGstin).slice(0, 2)}.`
                  }
                />
              </Group>
            ) : (
              <Group
                title="Fetched from the number"
                hint="Nothing yet — the number has to be complete and correctly structured first."
              >
                <Row
                  label="State, PAN, supply type…"
                  value="Waiting for a complete GST number"
                  tone="muted"
                  note="Decoding deliberately refuses to half-read a number, so a partly-typed value never shows misleading details."
                />
              </Group>
            )}

            <Group
              title="NOT fetched — these need the online lookup"
              hint="Held only by the government GST registry. The connection is built but switched off, so none of these are available."
            >
              {[
                ["Legal name", "The registered name of the business"],
                ["Trade name", "The name as it appears on their invoice"],
                ["Registration status", "Active / Cancelled / Suspended — the one that decides input tax credit"],
                ["Taxpayer type", "Regular / Composition / SEZ / ISD"],
                ["Date of registration", "And the cancellation date, if cancelled"],
                ["Principal place of business", "Full address and PIN"],
                ["Additional places of business", "Branches and warehouses"],
                ["Nature of business / jurisdiction", "Activity and tax office"],
              ].map(([label, note]) => (
                <Row key={label} label={label} value="Not fetched" tone="locked" note={note} />
              ))}
              <div className="px-3 py-2 text-[11.5px] text-muted-foreground">
                These come from a paid per-lookup service (~₹0.40–0.50 per number). The adapter,
                the cache table and the server action already exist; the feature stays completely
                inert until a provider and key are configured, so no cost can be incurred by
                accident.
              </div>
            </Group>
          </div>
        )}
      </div>
    </div>
  );
}
