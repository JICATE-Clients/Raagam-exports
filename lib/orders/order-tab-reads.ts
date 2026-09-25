import { recallTaView, rememberTaView } from "@/lib/orders/ta-view-cache";
import type { WorkFlowLoad } from "@/lib/orders/work-flow/actions";
import type { OrderCadData } from "@/lib/orders/cad-lifecycle/actions";

/**
 * THE ORDER ENTRY TABS THAT READ THEIR OWN DATA — T&A ▸ Work Flow and CAD —
 * read through here (2026-09-25, "the T&A tab and CAD tab show a loading
 * message when I open them").
 *
 * Three causes, three answers:
 *
 * 1. THE READ STARTED ONLY WHEN THE TAB MOUNTED. `MasterFullScreen` mounts the
 *    active section alone, so nothing was asked until the click. The order
 *    screen now calls `prefetchOrderTabs` the moment an order opens, and the
 *    tab usually finds its answer already here.
 * 2. IT WAS A SERVER ACTION, AND SERVER ACTIONS ARE QUEUED — the read waited
 *    behind anything else in flight, and prefetching it would have made the
 *    operator's next click wait behind it in turn. These are GET routes
 *    (`app/api/orders/[orderId]/…`), which run concurrently.
 * 3. EVERY RETURN RE-READ FROM "Loading…" — the tab remounts each time. The
 *    last good answer is remembered in `ta-view-cache` (stale-while-revalidate,
 *    revalidate always on), so a return paints at once and refreshes beneath.
 *
 * One in-flight request per key: the prefetch and the tab mounting a moment
 * later share it rather than asking twice. A refusal (`ok: false`) is returned
 * but never remembered — a stale error must not stand in for a fresh answer.
 */

const inflight = new Map<string, Promise<unknown>>();

export const workFlowKey = (amendmentId: string) => `workflow:${amendmentId}`;
export const orderCadKey = (amendmentId: string) => `cad:${amendmentId}`;

function read<T extends { ok: boolean }>(key: string, url: string, failure: (e: string) => T): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fetch(url, { cache: "no-store", credentials: "same-origin" })
    .then(async (res) => {
      // A 401/500 still answers JSON on the happy path; anything else is a
      // failure the tab has to SAY, never an empty tab.
      const body = (await res.json().catch(() => null)) as T | null;
      return body ?? failure(`the server answered ${res.status}`);
    })
    .catch((e: unknown) => failure(e instanceof Error ? e.message : String(e)))
    .then((v) => {
      if (v.ok) rememberTaView(key, v);
      return v;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function readWorkFlow(amendmentId: string): Promise<WorkFlowLoad> {
  return read<WorkFlowLoad>(workFlowKey(amendmentId), `/api/orders/${amendmentId}/work-flow`, (e) => ({
    ok: false,
    error: `Work Flow could not load: ${e}. Reload the page; if it persists, restart the dev server.`,
  }));
}

export function readOrderCad(amendmentId: string): Promise<OrderCadData> {
  return read<OrderCadData>(orderCadKey(amendmentId), `/api/orders/${amendmentId}/cad`, (e) => ({
    ok: false,
    error: `The CAD could not load: ${e}.`,
  }));
}

export const recallWorkFlow = (amendmentId: string) => recallTaView<WorkFlowLoad>(workFlowKey(amendmentId));
export const recallOrderCad = (amendmentId: string) => recallTaView<OrderCadData>(orderCadKey(amendmentId));

/** Remember an answer the tab changed locally (a saved milestone), so a return shows it. */
export const rememberWorkFlow = (amendmentId: string, v: WorkFlowLoad) => {
  if (v.ok) rememberTaView(workFlowKey(amendmentId), v);
};

/** Start both reads for an order that just opened. Fire-and-forget; errors surface in the tab. */
export function prefetchOrderTabs(amendmentId: string): void {
  void readWorkFlow(amendmentId);
  void readOrderCad(amendmentId);
}
