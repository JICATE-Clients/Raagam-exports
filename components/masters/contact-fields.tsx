"use client";

import { useMemo, useRef } from "react";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ValidatedInput } from "@/components/ui/validated-input";
import { focusField } from "@/lib/focus";
import { mailtoHref, telHref, whatsappHref } from "@/lib/validation/contact";
import { cn } from "@/lib/utils";

// ============================================================================
// Contact channel fields — the Mobile / WhatsApp pair that replaced the legacy
// `fax` column on 9 master tables (migration 0353). Shared so the nine screens
// can't drift apart on the "same as mobile" convention or the link format.
//
// KEYBOARD (raagam-keyboard-contract): nothing here binds a key. The tick is a
// native checkbox (Space toggles it, the global provider Tabs to it) and the
// chips are plain anchors. No handler here calls preventDefault(), so the
// contract in lib/focus.ts stays the single source of navigation behaviour.
// ============================================================================

/**
 * `country_id` → ISD code, so a WhatsApp chip can build a wa.me link with the
 * record's own country prefix instead of assuming +91. Every master screen
 * already receives the full `Country[]`, so this needs no extra query.
 */
export function useIsdLookup(
  countries: readonly { id: string; isd_code: string | null }[],
): Map<string, string | null> {
  return useMemo(() => {
    const m = new Map<string, string | null>();
    for (const c of countries) m.set(c.id, c.isd_code);
    return m;
  }, [countries]);
}

type ChipKind = "whatsapp" | "tel" | "mail";

const CHIP_ICON = { whatsapp: MessageCircle, tel: Phone, mail: Mail } as const;
const CHIP_TITLE = {
  whatsapp: "Chat on WhatsApp",
  tel: "Call this number",
  mail: "Send an email",
} as const;

/**
 * Click-to-act affordance rendered beside a contact field once its value is
 * valid. Renders nothing at all when `href` is null, so a half-typed or
 * doubtful number simply shows no chip rather than a link that goes nowhere.
 *
 * `tabIndex={-1}` on purpose: Tab moves between FIELDS in this app, and these
 * forms are dense keyboard data-entry surfaces — two extra tab stops per
 * contact pair across nine screens would break that rhythm. Still clickable,
 * same convention as every other derived/auxiliary control (see
 * raagam-autofield-tabindex).
 */
export function ContactChip({ href, kind }: { href: string | null; kind: ChipKind }) {
  if (!href) return null;
  const Icon = CHIP_ICON[kind];
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={-1}
      title={CHIP_TITLE[kind]}
      aria-label={CHIP_TITLE[kind]}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon className="h-4 w-4 shrink-0" />
    </a>
  );
}

/** Email field's chip — exported so screens with an existing email input can opt in. */
export function EmailChip({ value }: { value: string | null | undefined }) {
  return <ContactChip href={mailtoHref(value)} kind="mail" />;
}

/**
 * `phone_intl` (the default) for every buyer-facing master — customers,
 * consignees, notify parties, brands and Foreign bank branches are routinely
 * non-Indian. `mobile` is the strict India-only rule, used where the record is
 * definitionally domestic (Admin ▸ Company Profile).
 */
type PhoneFormat = "phone_intl" | "mobile";

interface MobileFieldProps {
  id: string;
  value: string;
  onChange: (next: string) => void;
  /** Omit the <Label> and use a placeholder instead — for child-grid cells. */
  bare?: boolean;
  label?: string;
  format?: PhoneFormat;
  disabled?: boolean;
  className?: string;
}

/** Mobile number + a `tel:` chip. Paste-tolerant via the `phone_intl` format. */
export function MobileField({
  id,
  value,
  onChange,
  bare,
  label = "Mobile",
  format = "phone_intl",
  disabled,
  className,
}: MobileFieldProps) {
  return (
    <div className={className}>
      {!bare && <Label htmlFor={id}>{label}</Label>}
      <div className="flex items-center gap-1">
        <ValidatedInput
          id={id}
          format={format}
          placeholder={bare ? label : undefined}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="text-base md:text-sm"
        />
        <ContactChip href={telHref(value)} kind="tel" />
      </div>
    </div>
  );
}

interface WhatsAppFieldProps {
  id: string;
  /** `null` = "same as mobile" (the stored convention). `""` collapses to null on save. */
  value: string | null;
  onChange: (next: string | null) => void;
  /** The sibling mobile, mirrored while the tick is on and used to build the link. */
  mobile: string;
  /** Country ISD (`countries.isd_code`) for the row, when the record has a country. */
  isdCode?: string | null;
  bare?: boolean;
  label?: string;
  format?: PhoneFormat;
  disabled?: boolean;
  className?: string;
}

/**
 * WhatsApp number with a "Same as mobile" tick.
 *
 * Mirroring is expressed by storing NULL, never by copying the digits — so the
 * two numbers cannot drift. While the tick is on the input is a DERIVED field:
 * `readOnly` + `tabIndex={-1}` (Tab skips it, a click still reaches it) rather
 * than `disabled`, so the operator can always read the number and the layout
 * never jumps.
 */
export function WhatsAppField({
  id,
  value,
  onChange,
  mobile,
  isdCode,
  bare,
  label = "WhatsApp",
  format = "phone_intl",
  disabled,
  className,
}: WhatsAppFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Strict null check, NOT the trimmed helper: an explicit-but-empty "" is a
  // real editing state here (tick off, nothing typed yet). It collapses back to
  // null — i.e. back to "same as mobile" — when the screen saves.
  const same = value === null;
  const shown = same ? mobile : value;

  function toggle(checked: boolean) {
    if (checked) {
      onChange(null);
      return;
    }
    onChange("");
    // Hand the cursor to the now-editable box, caret at the end.
    requestAnimationFrame(() => inputRef.current && focusField(inputRef.current));
  }

  return (
    <div className={className}>
      {!bare && <Label htmlFor={id}>{label}</Label>}
      <div className="flex items-center gap-1">
        {same ? (
          <Input
            id={id}
            readOnly
            tabIndex={-1}
            value={mobile}
            placeholder={bare ? label : undefined}
            disabled={disabled}
            className="text-base text-muted-foreground md:text-sm"
          />
        ) : (
          <ValidatedInput
            ref={inputRef}
            id={id}
            format={format}
            placeholder={bare ? label : undefined}
            value={value ?? ""}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="text-base md:text-sm"
          />
        )}
        <ContactChip href={whatsappHref(shown, isdCode)} kind="whatsapp" />
      </div>
      <label
        className={cn(
          "mt-1 flex w-fit items-center gap-1.5 text-xs text-muted-foreground",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        )}
      >
        <input
          type="checkbox"
          className="h-3.5 w-3.5 cursor-pointer accent-primary"
          checked={same}
          disabled={disabled}
          onChange={(e) => toggle(e.target.checked)}
        />
        Same as mobile
      </label>
    </div>
  );
}

interface MobileWhatsAppFieldsProps {
  /** Prefix for the two field ids, e.g. "cu" → "cu-mobile" / "cu-whatsapp". */
  idPrefix: string;
  mobile: string;
  whatsapp: string | null;
  onMobileChange: (next: string) => void;
  onWhatsAppChange: (next: string | null) => void;
  isdCode?: string | null;
  bare?: boolean;
  format?: PhoneFormat;
  disabled?: boolean;
}

/**
 * Both halves as two sibling cells — drops straight into an existing
 * `sm:grid-cols-2` header grid or a branch/address row without adding a wrapper
 * that would break the parent grid's rhythm.
 */
export function MobileWhatsAppFields({
  idPrefix,
  mobile,
  whatsapp,
  onMobileChange,
  onWhatsAppChange,
  isdCode,
  bare,
  format,
  disabled,
}: MobileWhatsAppFieldsProps) {
  return (
    <>
      <MobileField
        id={`${idPrefix}-mobile`}
        value={mobile}
        onChange={onMobileChange}
        bare={bare}
        format={format}
        disabled={disabled}
      />
      <WhatsAppField
        id={`${idPrefix}-whatsapp`}
        value={whatsapp}
        onChange={onWhatsAppChange}
        mobile={mobile}
        isdCode={isdCode}
        bare={bare}
        format={format}
        disabled={disabled}
      />
    </>
  );
}
