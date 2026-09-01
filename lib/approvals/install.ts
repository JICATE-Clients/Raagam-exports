import "server-only";
import { ApprovalError } from "./service";

/**
 * IS THE ENGINE ACTUALLY IN THIS DATABASE?
 *
 * The approval module ships as five migrations (0500–0505) and a screen. Those
 * two halves travel separately: the code lands with a `git pull`, the tables
 * land when somebody applies the migrations, and in between — on a fresh clone,
 * a branch deploy, a colleague's machine, or a repo where the migrations are
 * written but deliberately not yet applied — the screens are live and the tables
 * are not.
 *
 * WITHOUT THIS, THAT GAP IS A 500. `listFlows()` throws, the page has no
 * boundary, and Approvals in the sidebar becomes a nav row that crashes the app:
 *
 *   Could not find the table 'public.approval_flows' in the schema cache
 *   GET /approvals/flows 500
 *
 * A crash is the wrong answer to "this is not installed yet" for the same reason
 * a stranded run is the wrong answer to "no approver": both are states somebody
 * needs to be TOLD about, and a stack trace tells the wrong person in the wrong
 * words. The screens ask instead, and say what to run.
 *
 * ## WHY IT IS A NARROW TEST AND NOT A try/catch
 *
 * Only "the table does not exist" means "not installed". A permission failure, a
 * broken RLS policy or a network error must still surface as an error, because
 * each has a different fix and "install the engine" is the wrong advice for all
 * three. Swallowing everything into a friendly empty state is how a real fault
 * gets read as an uninstalled feature and goes unfixed for a week.
 *
 * Two codes, because two layers can answer:
 *   * `PGRST205` — PostgREST's own: the table is not in its schema cache. This is
 *     what an unapplied migration actually produces, and it is NOT a SQLSTATE,
 *     so `service.ts`'s SQLSTATE map calls it 'unknown'.
 *   * `42P01`   — Postgres's `undefined_table`, which is what an RPC raises when
 *     it reaches a missing relation rather than PostgREST refusing up front.
 */
const MISSING_CODES = new Set(["PGRST205", "42P01"]);

function isEngineMissing(e: unknown): boolean {
  const cause = e instanceof ApprovalError ? (e.cause as { code?: string } | undefined) : undefined;
  const code = cause?.code ?? (e as { code?: string } | null)?.code;
  if (code && MISSING_CODES.has(code)) return true;

  /* The message is the FALLBACK, not the test. PostgREST has changed this code
     before (PGRST202/PGRST205), and a missing table reported under a code this
     file has not met would otherwise crash the page again — which is the exact
     failure being fixed. Deliberately narrow: it must name a relation the engine
     owns, so an unrelated missing table elsewhere is still a real error. */
  const msg = e instanceof Error ? e.message : "";
  return /schema cache|does not exist|undefined table/i.test(msg) && /approval_/.test(msg);
}

/**
 * Run a read against the engine, answering `null` when the engine is not
 * installed and re-throwing everything else.
 *
 * `null` rather than an empty array on purpose: "no flows yet" and "no engine
 * yet" are different facts and the screens say different things about them. An
 * empty list would tell an administrator to go and build their first flow, on a
 * screen whose Save button cannot work.
 */
export async function ifInstalled<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (e) {
    if (isEngineMissing(e)) return null;
    throw e;
  }
}
