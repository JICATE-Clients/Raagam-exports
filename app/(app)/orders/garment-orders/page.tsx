import { GroupHub } from "@/components/shell/group-hub";

// The legacy 14-step Garment Orders hub, restored on request (2026-08-08).
//
// It was briefly a `redirect("/orders")` after the 08-07 regrouping dissolved
// it into sub-modules, and before that a hand-rolled `HubCard` grid whose card
// list was maintained separately from the sidebar — which is how its 14 screens
// ended up on the page and in no sidebar row at the same time.
//
// Now it is a registered sub-module like every other hub: the cards, the label
// and the permission all come from `lib/nav/module-groups.ts`, the same
// registry the sidebar reads, so the two cannot disagree again. Its children
// are all `cardOnly`, so the hub is one sidebar row and steals no screen from
// the flow groups (Order Setup, Order Entry, Amendments, …) that own them.
export default function Page() {
  return <GroupHub moduleHref="/orders" slug="garment-orders" />;
}
