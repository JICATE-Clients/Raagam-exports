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
 * grey — make it white too"). No longer a bordered box to fill — see below —
 * but the instruction is still why this never grows a background tint.
 *
 * ## A DIVIDER, NOT A CARD (2026-09-04)
 *
 * The bordered `w-fit` box read as an orphan once `omit` left only Style No on
 * it (screenshot 2720): a small box alone above a lot of empty row, repeating
 * the style number the page header already shows one line up. On the Manual
 * tab it is worse, because `manualStylePane` draws one band PER STYLE ROW —
 * so a multi-style order stacked several of these orphaned boxes down the
 * page with nothing telling the operator where one style's block ended and
 * the next began.
 *
 * The fix keeps the band's two jobs — it still names whichever style the rail
 * below belongs to, and it still stands in for that rail's `grid-caption` —
 * and gives it a reason to occupy the full row instead of a fraction of it:
 * it is now a labelled divider (label/value pairs, then a hairline that fills
 * the rest of the row) rather than a bordered box floating in whitespace. On
 * Manual that hairline is what marks the boundary between one style's block
 * and the next; on Components, with one style, it reads as the rule above the
 * rail it names. Planned in an artifact ("Anchoring the Style Band") before
 * being built, per the operator's own habit for this exact band (see the
 * 2026-09-03 note on the Manual call site).
 *
 * The `w-fit`/border/rounded/px/py classes are gone for this reason — a
 * caller that still wants the old boxed look would have to opt back in, not
 * discover it silently reappearing on the next unrelated change to `className`.
 *
 * `omit` DROPS FIELDS FOR ONE CALLER WITHOUT TOUCHING THE OTHER (client
 * 2026-09-04, "Structure Details & Components" cleanup spec: "delete Style
 * Ref No and Article No" from the Components tab's band). Manual was told to
 * match this band's THREE fields on 2026-09-03 ("like same components tab,
 * style reference no, style no, article no") — a hard-coded two-field version
 * would have answered the new request by breaking that one. Defaults to every
 * field, so a new caller is unchanged by default.
 *
 * TWO DIFFERENT CALLERS ARE FREE TO PASS TWO DIFFERENT `omit`s — that is
 * the whole point of the prop, and it is what happened here even though
 * both ended up at the same place. Manual kept all three fields until two
 * SEPARATE later messages on Manual's OWN band, hours apart: "Article No
 * ... no need in header style listing, remove it", then "Style Ref No —
 * this field also sno need remove it". Each was a narrower ask than
 * Components' original "delete Style Ref No and Article No" — naming one
 * field at a time — and Manual's `omit` grew from `[]` to `["article"]` to
 * `["ref", "article"]` across them, arriving at the SAME value Components
 * already passed by coincidence, not because the two bands were re-unified
 * on purpose. Read each call site for its own `omit`; do not assume they
 * match just because they draw the same component, and do not collapse
 * them into one shared default on the strength of them matching today.
 */
export function StyleIdentityBand({
  /** The style reference the surface is scoped to — always known, by value. */
  styleRefNo,
  /** Style No and Article No off the order's tree; null when it cannot say. */
  identity,
  /** Fields to leave off this band for THIS caller. Defaults to none. */
  omit,
  className,
}: {
  styleRefNo: string;
  identity: { ref: string; style: string; article: string } | null;
  omit?: readonly ("ref" | "style" | "article")[];
  className?: string;
}) {
  return (
    <dl className={cn("flex w-full items-baseline gap-x-6", className)}>
      {[
        { key: "ref", label: "Style Ref No", value: identity?.ref || styleRefNo },
        { key: "style", label: "Style No", value: identity?.style ?? "" },
        { key: "article", label: "Article No", value: identity?.article ?? "" },
      ]
        .filter((f) => !omit?.includes(f.key as "ref" | "style" | "article"))
        .map((f) => (
        <div key={f.label} className="flex shrink-0 items-baseline gap-2">
          <dt className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-muted-foreground">
            {f.label}
          </dt>
          <dd className="m-0 text-sm font-medium">
            <Truncated>{f.value || "—"}</Truncated>
          </dd>
        </div>
      ))}
      {/* THE HAIRLINE, NOT THE BOX — fills the rest of the row so the label
          reads as a section break rather than a card with dead space beside
          it. `aria-hidden`: it carries no information of its own. */}
      <div aria-hidden className="h-px min-w-[2rem] flex-1 self-center bg-border" />
    </dl>
  );
}
