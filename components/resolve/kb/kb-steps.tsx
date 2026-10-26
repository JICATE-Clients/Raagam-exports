import { cn } from "@/lib/utils";

/** An article's numbered steps — the one way steps are drawn (page, form, ticket). */
export function KbSteps({ steps, className }: { steps: string[]; className?: string }) {
  if (steps.length === 0) return null;
  return (
    <ol className={cn("space-y-1.5", className)}>
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2.5 text-sm text-foreground">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold tabular-nums text-primary">
            {i + 1}
          </span>
          <span className="min-w-0 whitespace-pre-wrap pt-px">{s}</span>
        </li>
      ))}
    </ol>
  );
}
