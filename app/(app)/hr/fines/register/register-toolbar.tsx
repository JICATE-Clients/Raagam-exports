"use client";

import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Print / PDF and Markdown export for the Fine Summary Report. The report
 * itself is static markup (spec §7: "a static, non-interactive Markdown table
 * or PDF export") — this is the only client code on the page, and it prints
 * nothing of its own (`print:hidden`).
 */
export function RegisterToolbar({ markdown, fileName }: { markdown: string; fileName: string }) {
  function download() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="flex gap-2 print:hidden">
      <Button variant="outline" onClick={download}>Download .md</Button>
      <Button variant="outline" onClick={() => window.print()}>Print / PDF</Button>
    </div>
  );
}

/**
 * The month filter — a plain GET form (the page re-renders on the server), in
 * this client file only because `Input` cannot be rendered by a server module.
 */
export function RegisterMonthFilter({ month }: { month: string | null }) {
  return (
    <form method="get" className="flex items-end gap-2 print:hidden">
      <label className="text-sm">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Deduction month</span>
        <Input type="month" name="month" defaultValue={month ?? ""} className="w-44" />
      </label>
      <button type="submit" className={buttonClasses({ variant: "outline" })}>Show</button>
      {month && (
        <a href="/hr/fines/register" className={buttonClasses({ variant: "ghost" })}>All months</a>
      )}
    </form>
  );
}
