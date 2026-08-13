import { ModuleHub } from "@/components/shell/module-hub";

/**
 * The Orders module landing page: one card per sub-module, from
 * `lib/nav/module-groups.ts`.
 *
 * It was the All Orders register until 2026-08-13 (now `/orders/all`) — a
 * module root that was a working screen rather than an index of what the module
 * contains, so clicking "Orders" showed a table and the seven sub-modules were
 * reachable only from the sidebar. `/masters` was the one module root doing this
 * correctly; `ModuleHub` is that shape made shared, and its header records what
 * the hand-written alternative had already drifted into elsewhere.
 *
 * Four lines, exactly like the 37 sub-module hubs beside it, and for the same
 * reason: the cards come from the registry the sidebar reads, so a sub-module
 * cannot be in one and missing from the other.
 */
export default function OrdersPage() {
  return <ModuleHub moduleHref="/orders" />;
}
