/**
 * THE COMMUNICATION HUB IS NOT IN THIS DATABASE YET.
 *
 * Shown instead of a 500 when 0737's functions are missing (see
 * `isCommsMissing` in lib/comms/service.ts). It names the migration and the
 * checks to run after it, because that is the entire fix — "something went
 * wrong" would send the operator to whoever built this.
 */
export function CommsNotInstalled() {
  return (
    <div className="mx-auto max-w-2xl space-y-3 p-4">
      <h1 className="text-lg font-semibold text-heading">Messages</h1>
      <div className="rounded-md border border-warning/40 bg-warning-soft p-4">
        <p className="text-sm font-semibold text-foreground">
          The Communication Hub is not set up in this database yet.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          The screens are here; the tables are not. Apply this migration and the page starts working — nothing else is
          needed:
        </p>
        <ul className="mt-2 list-disc pl-5 font-mono text-xs text-foreground">
          <li>supabase/migrations/0737_communication_hub_core.sql</li>
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">Then check it from the SQL editor:</p>
        <ul className="mt-1 list-disc pl-5 font-mono text-xs text-foreground">
          <li>scripts/comms-smoke-test.sql — must end with “0 FAIL”</li>
          <li>scripts/check-anon-grants.sql — must return no rows</li>
          <li>scripts/check-location-scope.sql — must return no rows</li>
        </ul>
      </div>
    </div>
  );
}
