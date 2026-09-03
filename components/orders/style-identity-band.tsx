import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

/**
 * LEGACY'S OUTER BAND — `S No | StyleRefNo | StyleNo | ArticleNo` — as one
 * component, because two tabs draw it.
 *
 * The Components tab has drawn it since 2026-09-02 (legacy screenshot 2613) and
 * the Manual tab was told to match it on 2026-09-03 ("Manual tab rearrange …
 * first row like same components tab, style reference no, style no, article
 * no", legacy screenshots 2666 · 2667). It was inline markup in
 * `component-map-sheet.tsx` at that point, and copying it into the Manual pane
 * would have made "the same as the Components tab" a thing a reader has to
 * verify by eye every time either one changes — the failure `created-columns.tsx`
 * exists to record, where six screens grew their own and no two agreed.
 *
 * ## READ-ONLY, AND NOT A GRID
 *
 * Legacy draws this as the outer band of a three-level tree, and on both tabs it
 * is genuinely one row — each tab is scoped to one style at a time — so a grid
 * around it would be chrome with a header, an ordinal and an "+ Add" for
 * something nobody adds from either screen. Plain text also keeps it off the Tab
 * path: nothing here is typed, so nothing here should be a tab stop (AGENTS.md,
 * "Tab lands on fields").
 *
 * ## IT PRINTS THE REF EVEN WHEN THE ORDER CANNOT NAME THE STYLE
 *
 * A line carries `style_ref_no` BY VALUE, so the ref is always known; Style No
 * and Article No come from the order's combo tree and dash when it has nothing
 * to say. `identity` being null is therefore a real and ordinary state, not a
 * loading one — which is why `ref` is a separate prop and not read out of it.
 *
 * WHITE, NOT FILLED (client 2026-08-27: "that inside cell for some sections is
 * grey — make it white too"). The border already says this is a band.
 */
export function StyleIdentityBand({
  /** The style reference the surface is scoped to — always known, by value. */
  styleRefNo,
  /** Style No and Article No off the order's tree; null when it cannot say. */
  identity,
  className,
}: {
  styleRefNo: string;
  identity: { ref: string; style: string; article: string } | null;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-4 gap-y-1 rounded-md border border-border px-3 py-2",
        className,
      )}
    >
      {[
        { label: "Style Ref No", value: identity?.ref || styleRefNo },
        { label: "Style No", value: identity?.style ?? "" },
        { label: "Article No", value: identity?.article ?? "" },
      ].map((f) => (
        <div key={f.label}>
          <dt className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
            {f.label}
          </dt>
          <dd className="m-0 text-sm font-medium">
            <Truncated>{f.value || "—"}</Truncated>
          </dd>
        </div>
      ))}
    </dl>
  );
}
