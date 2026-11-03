import type { ReactNode } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * A DOCUMENT'S FACTS, ONE STRIP (user 2026-11-03, screenshot 4000: "this kind of screen in
 * overall procurement module is not our design — make it single section … single row,
 * compact"). A procurement detail page used to stack a titled card per topic ("Rejection &
 * replacement", "GRN Details", "Indent Details" …), each a label/value grid four columns wide,
 * so three facts took a screen-width box and the lines table started half a page down.
 *
 * One bordered strip instead: label over value, side by side, wrapping only when the pane is
 * narrower than the facts. `trailing` sits at the right end (a status pill, a print icon);
 * `children` is a full-width line under the facts (an override note, a warning).
 *
 * Server-safe — no state — so a server `page.tsx` renders it as it stands. The DC drawer's
 * facts bar (`purchase/dc/page.tsx`) is the same shape and predates this file.
 */
export type DocFact = {
  label: string;
  value: ReactNode;
  /** Codes and numbers in tabular figures. */
  mono?: boolean;
};

export function DocFacts({ facts, trailing, children }: { facts: (DocFact | null | false | undefined)[]; trailing?: ReactNode; children?: ReactNode }) {
  const shown = facts.filter((f): f is DocFact => !!f);
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <dl className="flex min-w-0 flex-1 flex-wrap items-start gap-x-6 gap-y-2">
          {shown.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{f.label}</dt>
              <dd className={f.mono ? "font-medium tabular-nums" : "font-medium"}>{f.value ?? "—"}</dd>
            </div>
          ))}
        </dl>
        {/* The page's own controls — status, print, the next step, the way out — end the same
            row (user 2026-11-03: "Edit GRN / Print GRN in the same row look weird"), instead of
            a header row of their own above an otherwise empty band. */}
        {trailing ? <div className="ml-auto flex shrink-0 items-center gap-3">{trailing}</div> : null}
      </div>
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

/**
 * PRINT IS THE REPORT ICON (user 2026-11-03): a document's print opens from FileText at the
 * strip's right end — the shape the GRN / PO lists and the DC drawer use — never a text link
 * or a labelled button in a header row of its own.
 */
export function DocPrintIcon({ href, label }: { href: string; label: string }) {
  return (
    <Tooltip label={label}>
      <Link href={href} aria-label={label} className={`${buttonClasses({ variant: "ghost", size: "icon" })} text-primary`}>
        <FileText aria-hidden />
      </Link>
    </Tooltip>
  );
}

/** "Back to list" — a read-only detail page's one way out (AGENTS.md "Buttons"), a text link. */
export function DocBackLink({ href }: { href: string }) {
  return (
    <Link href={href} className="text-sm text-muted-foreground hover:text-foreground">
      Back to list
    </Link>
  );
}
