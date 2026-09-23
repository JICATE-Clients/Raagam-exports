import Link from "next/link";

/**
 * What an EMBEDDED editor shows while it is not open (`useEmbeddedEditor`):
 * opening, or — when the record is not in the screen's rows — why not, with
 * the way back. Never the screen's list: inside an amendment the list is not
 * the operator's business.
 */
export function EmbeddedEditorWait({ found, returnHref, what }: { found: boolean; returnHref: string; what: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-6 text-sm text-muted-foreground">
      {found ? (
        <>Opening the {what}…</>
      ) : (
        <>
          This order has no {what} yet, or it cannot be read here.{" "}
          <Link href={returnHref} className="font-medium text-primary hover:underline">
            ← Back to the revision
          </Link>
        </>
      )}
    </div>
  );
}
