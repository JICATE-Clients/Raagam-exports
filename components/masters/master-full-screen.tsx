"use client";

import { useEffect, useState, type ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The COMPLEX-tier editor surface: a full-screen takeover with a left section
 * rail (horizontal chip strip on mobile), sticky identity header and a
 * Cancel / [Save as Draft] / Save footer. Extracted from
 * customer-master-screen.tsx — section-SWITCHING (one section rendered at a
 * time), not scroll-spy, which is the proven UX there.
 *
 * Deliberately NOT portaled and fixed at z-[80]: nested picker Sheets keep
 * their default zIndexBase=90 and stack above it, exactly as customer/vendor
 * already rely on. No Escape-to-close — closing a dirty 30-field form must be
 * an explicit ✕ / Cancel.
 */
export type FullScreenSection = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Completion dot on the rail ("has data"). */
  done?: boolean;
  /** Rendered only while this section is active. */
  content: ReactNode;
};

export function MasterFullScreen({
  open,
  onClose,
  modeLabel,
  header,
  sections,
  initialSection,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  /** Thin top strip, e.g. <>Editing <b>Acme</b></> — pair with the ✕ it renders. */
  modeLabel: ReactNode;
  header: {
    /** Defaults to an initials block derived from `initials`. */
    avatar?: ReactNode;
    /** Fallback text for the default avatar (e.g. "AC"). */
    initials?: string;
    title: ReactNode;
    /** Pills + unsaved marker etc., rendered inline after the title. */
    badges?: ReactNode;
    /** Muted meta line under the title (code · country · flags). */
    meta?: ReactNode;
    /** Right-hand header zone (e.g. customer's applicant chips). */
    right?: ReactNode;
  };
  sections: FullScreenSection[];
  initialSection?: string;
  footer: {
    /** Left status text; e.g. "Unsaved changes". */
    status?: ReactNode;
    onCancel: () => void;
    onSave: () => void;
    saveLabel: string;
    canSave: boolean;
    /** Renders a "Save as Draft" outline button when provided. */
    onSaveDraft?: () => void;
    draftLabel?: string;
    isPending?: boolean;
  };
}) {
  const firstKey = initialSection ?? sections[0]?.key ?? "";
  const [section, setSection] = useState(firstKey);

  // Re-open always lands on the initial section.
  useEffect(() => {
    if (open) setSection(firstKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Lock body scroll behind the overlay (same behavior the customer editor had).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const active = sections.find((s) => s.key === section) ?? sections[0];

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-background">
      {/* topbar */}
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2.5">
        <div className="text-xs text-muted-foreground">{modeLabel}</div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* record header (sticky identity band) */}
      <div className="grid gap-3 border-b border-border bg-surface px-4 py-3 md:grid-cols-[1fr_auto] md:items-center md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {header.avatar ?? (
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-primary/10 text-base font-bold text-primary">
              {header.initials ?? "—"}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[15px] font-bold tracking-tight text-foreground">
                {header.title}
              </span>
              {header.badges}
            </div>
            {header.meta && (
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {header.meta}
              </div>
            )}
          </div>
        </div>
        {header.right && <div className="flex flex-col gap-1.5 md:items-end">{header.right}</div>}
      </div>

      {/* body: rail + content */}
      <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[228px_1fr]">
        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-surface-muted p-2 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:p-3">
          <span className="hidden px-2 pb-1 pt-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground md:block">
            Sections
          </span>
          {sections.map((s) => {
            const isActive = section === s.key;
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSection(s.key)}
                aria-current={isActive}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-md border px-2.5 py-2 text-left text-[13.5px] transition-colors md:w-full",
                  isActive
                    ? "border-border bg-surface font-semibold text-foreground shadow-sm"
                    : "border-transparent text-muted-foreground hover:bg-surface hover:text-foreground",
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                <span className="flex-1 truncate whitespace-nowrap">{s.label}</span>
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full border",
                    s.done ? "border-accent bg-accent" : "border-border bg-transparent",
                  )}
                  aria-label={s.done ? "has data" : "empty"}
                />
              </button>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-5 md:px-6">{active?.content}</div>
        </div>
      </div>

      {/* sticky footer */}
      <div className="flex items-center gap-2 border-t border-border bg-surface px-4 py-3 md:px-6">
        {footer.status && <span className="text-xs text-muted-foreground">{footer.status}</span>}
        <div className="flex-1" />
        <Button variant="outline" size="md" onClick={footer.onCancel}>
          Cancel
        </Button>
        {footer.onSaveDraft && (
          <Button
            variant="outline"
            size="md"
            disabled={footer.isPending || !footer.canSave}
            onClick={footer.onSaveDraft}
          >
            {footer.draftLabel ?? "Save as Draft"}
          </Button>
        )}
        <Button size="md" disabled={footer.isPending || !footer.canSave} onClick={footer.onSave}>
          {footer.isPending ? "Saving…" : footer.saveLabel}
        </Button>
      </div>
    </div>
  );
}

/** A titled content block inside the editor's content pane. */
export function SectionBody({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h2 className="text-[15px] font-bold tracking-tight text-foreground">{title}</h2>
      <p className="mb-4 mt-0.5 text-[12.5px] text-muted-foreground">{hint}</p>
      {children}
    </div>
  );
}
