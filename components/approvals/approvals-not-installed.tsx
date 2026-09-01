import { PageHeader } from "@/components/ui/page-header";

/**
 * THE APPROVAL ENGINE IS NOT IN THIS DATABASE YET.
 *
 * Shown instead of a 500 when `approval_flows` / `approval_my_queue` are not
 * there — see `lib/approvals/install.ts` for how that is detected, and why the
 * test is narrow rather than a blanket try/catch.
 *
 * ## IT NAMES THE MIGRATIONS, BECAUSE THAT IS THE ENTIRE FIX
 *
 * "Something went wrong" would send an operator to whoever built this. The
 * files are the answer, they are in the repo already, and the only missing step
 * is somebody applying them — so the screen says which ones, in order. That is
 * the same rule the app applies to a mis-scoped filter or a role with no
 * holders: name the door, do not describe the emptiness.
 *
 * ## AND IT WARNS ABOUT THE ONE THAT IS EASY TO MISS
 *
 * 0500's self-test and 0503's holder check both RAISE or WARN at apply time, and
 * both are easy to scroll past in a migration log. The second is the one that
 * costs later: catch-all flows routed to a role nobody holds means every submit
 * refuses, at month end, in front of whoever submitted.
 */
export function ApprovalsNotInstalled() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Approvals"
        description="Who signs each document, in what order, and under which conditions."
      />

      <div className="rounded-md border border-warning/40 bg-warning/5 p-4">
        <p className="text-sm font-semibold text-foreground">
          The approval engine is not installed in this database yet.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          The screens are here; the tables are not. Apply these migrations, in
          order, and this page starts working — nothing else is needed.
        </p>

        <ol className="mt-3 space-y-1 font-mono text-xs text-foreground">
          <li>0500_approval_rbac_shim.sql</li>
          <li>0501_approval_core_schema.sql</li>
          <li>0502_approval_core_functions.sql</li>
          <li>0503_approval_seed_flows.sql</li>
          <li>0505_approval_terminal_callbacks.sql</li>
        </ol>

        <p className="mt-3 text-xs text-muted-foreground">
          0500 ends in a self-test — if it raises, stop and read it rather than
          applying the rest. 0503 warns when nobody holds the{" "}
          <span className="font-medium text-foreground">Managing Director</span>{" "}
          role: that warning means every default flow routes to nobody, and the
          first submitted document will be refused rather than queued.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Then run{" "}
          <span className="font-mono text-foreground">
            scripts/approval-smoke-test.sql
          </span>{" "}
          once. It writes test rows and rolls them all back.
        </p>
      </div>
    </div>
  );
}
