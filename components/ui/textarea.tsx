import { forwardRef, type TextareaHTMLAttributes } from "react";
import { useRequiredHold } from "@/components/ui/field";
import { holdEmpty } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    /**
     * CAPITALS, ON BY DEFAULT — pass `uppercase={false}` to opt out.
     *
     * THIS REVERSES A STANDING EXEMPTION, DELIBERATELY. AGENTS.md's CAPITALS
     * section listed "`<Textarea>` free text" as exempt BY CONSTRUCTION, and the
     * reasoning was sound: a paragraph in block capitals is harder to read, and
     * prose is not a value anything matches on. The client was shown that
     * argument on 2026-08-18 and chose capitals anyway, for the whole app. The
     * later instruction wins — so the exemption is WITHDRAWN, not overlooked,
     * and putting it back needs a new client decision rather than a tidy-up.
     *
     * ONE CARVE-OUT SURVIVED, and it is the client's own: LC and PO
     * TERMS stay as typed (`uppercase={false}` at those four call sites). Those
     * clauses are read by a bank and by suppliers, where block capitals change
     * how the text reads rather than how a value is stored. Addresses and the
     * company document footer were offered the same carve-out and the client
     * declined it — including with the URL-case caveat stated — so they
     * capitalise.
     *
     * Both halves, same as `Input`: the keystroke transform makes what is SAVED
     * genuinely uppercase, and the CSS class makes rows saved BEFORE this change
     * display in caps too. `readOnly` exempts itself for the same reason it does
     * on `Input` — a value the operator did not type must not be re-cased on the
     * way to their eyes.
     */
    uppercase?: boolean;
  }
>(({ className, uppercase, onChange, ...props }, ref) => {
  const caps = uppercase ?? !props.readOnly;
  // Mandatory and blank holds the cursor — see input.tsx. A textarea owns Enter
  // ("new line"), so only Tab and the arrows are ever refused here anyway.
  const hold = useRequiredHold(!props.readOnly && !props.disabled && holdEmpty(props.value), {
    required: props.required,
  });
  return (
  <textarea
    ref={ref}
    {...hold}
    // Same rule as input.tsx: the browser's memory of past typing is not a
    // master list, and a shared machine must not offer the last operator's
    // remarks to the next one. A textarea is never a credential, so unlike
    // Input there is no opted-in case to preserve — but the caller can still
    // override, since the spread below wins.
    autoComplete="off"
    data-1p-ignore=""
    data-lpignore="true"
    data-form-type="other"
    className={cn(
      // Same rhythm as Input/Select: text-base on mobile stops iOS zooming the
      // viewport on focus, text-sm on desktop keeps the dense ERP density. This
      // was `text-sm` alone, so focusing a textarea zoomed the page while the
      // Input beside it did not.
      //
      // A textarea has no height to compact — it sizes off `rows` — so its share
      // of the `@2xl/editor:` scale is the vertical PADDING. A compact Input is
      // h-8 with a 20px line box and 2px of border, i.e. ~5px of effective
      // padding; at `py-2` the textarea's first line started 8px in, so its text
      // sat 3px below the field beside it and the two never shared a baseline.
      // Container query, not `md:`, for the same reason as input.tsx: a nested
      // ~440px picker dialog and every phone keep the roomier target.
      "w-full rounded-md border border-border bg-surface px-3 py-2 @2xl/editor:py-1.5 text-base md:text-sm",
      "placeholder:text-muted-foreground",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:opacity-50",
      caps && "uppercase placeholder:normal-case",
      className,
    )}
    onChange={
      caps
        ? (e) => {
            // Preserve the caret — assigning .value moves it to the end, and in
            // a multi-line box that is worse than in an input: the cursor jumps
            // past every line already typed. Same handler shape as input.tsx.
            const { selectionStart, selectionEnd } = e.target;
            e.target.value = e.target.value.toUpperCase();
            try {
              e.target.setSelectionRange(selectionStart, selectionEnd);
            } catch {
              /* defensive: a textarea always supports selection ranges */
            }
            onChange?.(e);
          }
        : onChange
    }
    {...props}
  />
  );
});
Textarea.displayName = "Textarea";
