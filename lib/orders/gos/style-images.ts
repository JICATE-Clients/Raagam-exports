import "server-only";
import { createClient } from "@/lib/supabase/server";
import { styleGalleries } from "@/lib/orders/amendments/style-gallery";

/**
 * THE STYLE PICTURES THE OPERATOR ASKED TO PRINT (user, 2026-09-23: "Print on
 * reports" on an order's attachment tiles).
 *
 * ## ONLY WHAT WAS TICKED — NEVER A GUESS
 *
 * `print_on_report` is the whole rule. A style with pictures and none ticked
 * prints NO picture: not the cover, not the first sketch. `coverOf` answers
 * "which picture stands for this style on a screen", and borrowing it here
 * would put a picture on paper that nobody chose to send to the floor — the
 * buyer's approval photo, a rejected first sketch. On a screen that costs a
 * glance; on a cutting-room sheet it is an instruction.
 *
 * ## NOT PART OF THE SHEET'S PAYLOAD, ON PURPOSE
 *
 * `getGarmentOrderSheet`'s output is what V_final freezes at raise (0619,
 * `order_amendment_report_snapshots`). A signed URL lives an hour, so a
 * picture frozen into that payload would print as a broken box for every day
 * of an amendment but the first. So this is loaded beside the sheet on every
 * render and signed fresh. The cost is stated rather than hidden: the pictures
 * are NOT versioned — a tick changed during an amendment prints at once, on
 * the approved sheet as on the proposed one.
 *
 * ## WHICH AMENDMENT
 *
 * The CURRENT one, resolved by the rule `getGarmentOrderSheet` uses (newest by
 * amend date, then insertion), so the pictures always belong to the document
 * the sheet prints. Keep the two orderings together.
 *
 * ## A FAILURE IS SAID, NOT SWALLOWED — AND DOES NOT TAKE THE SHEET DOWN
 *
 * Returned as `{ failed }` instead of thrown: the construction sheet is still
 * right without its pictures and must still print. But `[]` would read as
 * "nothing was ticked", which is exactly the believable-empty answer AGENTS.md
 * warns about, so the page prints a sentence instead (screen only).
 */

export type ReportStyleImage = { url: string; fileName: string };

export type ReportStyleImages = {
  /** Null = pictures filed against the ORDER rather than a style. */
  styleRef: string | null;
  images: ReportStyleImage[];
}[];

/** How long a printed page's picture links live — the render-to-print gap. */
const SIGNED_URL_TTL = 3600;

type FileRow = {
  file_name: string | null;
  storage_path: string | null;
  mime_type: string | null;
  doc_kind: string | null;
  style_ref_no: string | null;
  print_on_report: boolean | null;
};

export async function getReportStyleImages(
  salesOrderId: string,
): Promise<ReportStyleImages | { failed: string }> {
  const s = await createClient();

  const { data: seq, error: seqErr } = await s
    .from("garment_order_amendments")
    .select("id")
    .eq("sales_order_id", salesOrderId)
    .order("amend_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (seqErr) return { failed: `Could not load the order's amendments: ${seqErr.message}` };
  const ids = ((seq ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return [];
  const currentId = ids[ids.length - 1];

  const { data, error } = await s
    .from("garment_order_amendment_files")
    .select("file_name, storage_path, mime_type, doc_kind, style_ref_no, print_on_report")
    .eq("amendment_id", currentId)
    .eq("print_on_report", true)
    .order("sno", { ascending: true });
  if (error) return { failed: `Could not load the style pictures: ${error.message}` };

  // `styleGalleries` drops every non-picture: a ticked PDF tech pack is a
  // document, and `<img>` cannot print it.
  const groups = styleGalleries((data ?? []) as FileRow[]);
  if (groups.length === 0) return [];

  const paths = groups.flatMap((g) => g.images.map((f) => f.storage_path as string));
  const { data: signed, error: signErr } = await s.storage
    .from("garment-order-docs")
    .createSignedUrls(paths, SIGNED_URL_TTL);
  if (signErr) return { failed: `Could not sign the style pictures: ${signErr.message}` };

  const urlOf = new Map<string, string>();
  for (const x of signed ?? []) if (x.path && x.signedUrl && !x.error) urlOf.set(x.path, x.signedUrl);

  /* A MISSING OBJECT IS DROPPED, NOT DRAWN. A row whose object is gone signs
     to an error; printing it would be a broken-image box on paper, which says
     nothing a supervisor can act on. The strip for that style simply holds the
     pictures that exist. */
  return groups
    .map((g) => ({
      styleRef: g.styleRef,
      images: g.images.flatMap((f) => {
        const url = urlOf.get(f.storage_path as string);
        return url ? [{ url, fileName: f.file_name ?? "" }] : [];
      }),
    }))
    .filter((g) => g.images.length > 0);
}
