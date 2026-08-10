import type { Module } from "@/lib/auth/types";

/**
 * Module → sub-module grouping for the sidebar, and the source the group hub
 * pages render from.
 *
 * ## Why this file exists
 *
 * The sidebar used to list every leaf screen of a module as a flat `children`
 * array, so a sub-module and its own child sat at the same level as equals.
 * Purchase showed "Indents" and "Indent Approval" side by side even though the
 * second is a route *under* the first; Planning listed 20 screens that are
 * really two families (6 BOM, 6 PPM) plus strays; Production, Logistics and
 * Reports each repeated their own module root as their first child, so two
 * sidebar rows pointed at one page (client 2026-08-07).
 *
 * Master Data never had the problem: it lists five SUB-MODULES (Materials,
 * Associates, HR, Currencies, GST) and the entities live on those hub pages.
 * This file applies that shape to every other module.
 *
 * ## The one rule
 *
 * A module's sidebar shows GROUPS and STANDALONE SCREENS — never a screen that
 * lives under another screen in the same list. Two levels in the sidebar, the
 * third on the page, exactly as `/masters` does it.
 *
 * ## One declaration, two readers
 *
 * `components/shell/nav.ts` derives its `children` from here, and each group's
 * hub page renders its cards from here. That is deliberate, and it is the same
 * lesson `lib/reports/catalog.ts` already records: the nav list and the landing
 * grid used to be two hand-edited literals that nothing kept in sync, so a new
 * screen routinely appeared in one and went missing from the other.
 *
 * ## Routes are NOT moved
 *
 * A group's `children` point at the leaf routes that already exist. Grouping is
 * a navigation concern; re-parenting `/planning/fabric-bom` under
 * `/planning/bom/fabric` would break every deep link, bookmark and redirect in
 * the app for no gain. A group slug is a NEW route that only ever renders tiles.
 *
 * ## Why the hubs are static pages, not one `[group]` route per module
 *
 * Four modules already own a dynamic segment at exactly this level —
 * `/orders/[orderId]`, `/stores/[storeId]`, `/sales/[opportunityId]`,
 * `/logistics/[shipmentId]`. Next.js refuses two different slug names for the
 * same dynamic path, so a generic `[group]` route beside them is a build error,
 * not a style choice.
 */

/** A leaf screen inside a group. Points at a route that already exists. */
export interface GroupChild {
  href: string;
  label: string;
  description: string;
  /**
   * A CARD on this hub whose sidebar ROW lives somewhere else — another group,
   * or (for a module root) the module row itself. `owningNavHref` and
   * `moduleLeafItems` both skip it here, so exactly ONE row owns the route and
   * the screen is offered to nav search exactly once.
   *
   * This is how a sub-module lists a screen its work depends on without
   * claiming it: Order Entry shows Order Amendment because an operator raising
   * one is working in Order Entry, but the row stays under Amendments beside
   * the other three amendment screens.
   */
  cardOnly?: boolean;
  /**
   * WHY THIS CARD CANNOT BE WORKED ON. Two different facts, and conflating them
   * is what made the second one invisible for months:
   *
   * - `todo` — NOT BUILT YET. No route, no code. The card goes dashed and reads
   *   "Not set up yet". Master Data has had this since it was written
   *   (`SubChild`'s `todo` type) and every other hub had to say it in prose
   *   instead, so a placeholder screen looked exactly like a working one until
   *   it was clicked.
   *
   * - `unavailable` — BUILT, BUT ITS TABLE IS NOT IN THIS DATABASE. The route
   *   exists, the list page and the [id] detail and hundreds of lines of
   *   actions are all there; the schema behind them is not. This is the exact
   *   INVERSE of `todo` and the check asserts it that way, which is why one
   *   flag could never carry both.
   *
   * The second state exists because 21 of these cards were in it and nothing
   * said so (audit 2026-08-08): every service ends `return (data ?? [])`, so
   * PostgREST's "relation does not exist" is swallowed and the operator gets a
   * clean, empty, finished-looking table. 20 are the Planning module, whose
   * tables `0332_drop_planning_module` removed; the 21st is Orders ▸ TA Plan,
   * hiding inside an otherwise healthy group.
   *
   * BOTH carry no count, for the same reason: `0` is a claim — "nothing here
   * yet, click to add" — and neither a missing screen nor a missing table is
   * making it. A confident `0` on a screen that cannot save is a more
   * convincing lie than no number at all.
   */
  status?: "todo" | "unavailable";
  /**
   * Why an `unavailable` card cannot be used, in the operator's words. Shown
   * instead of `description`, because a description describes a screen that
   * works. Required in practice — a greyed card with no reason is the silent
   * failure this state exists to end — but optional in the type so the check,
   * not the compiler, reports it with a message worth reading.
   */
  unavailableNote?: string;
  /**
   * OWNED BY ANOTHER MODULE — shown with ↗. A group's children are normally
   * routes inside the same module, so this is deliberately rare: it marks the
   * card that takes the operator OUT of the module they are working in.
   *
   * It is not a decoration for "opens something else". `/orders/ta` once passed
   * `external` on all six of its own siblings, which made the glyph mean
   * nothing. A card that opens another HUB of the same module is a different
   * state entirely and is derived by `groupAtRoute` below — never flagged here.
   */
  external?: boolean;
  // There is deliberately NO `countKey` here, and this note is what stops one
  // being added back. The record counts (`lib/nav/hub-counts.ts`) key on the
  // card's OWN href, via the declared `href → table` literal in
  // `lib/nav/hub-count-map.ts` — so a key on the child would be a SECOND place
  // to state one fact, which is the exact failure this file's header records
  // about the nav list and the landing grid. It would also let a card listed in
  // two groups (nine hrefs are) name two different tables for one screen, and a
  // field nothing reads is dead config that reads as live: set it and no number
  // appears, with nothing to say why.
}

/** A sub-module: one sidebar row, one hub page, many leaf screens. */
export interface ModuleGroup {
  kind: "group";
  /** Route segment under the module — the hub page's own route. */
  slug: string;
  label: string;
  description: string;
  /**
   * PROVISIONAL — the grouping or its screens are still being settled, so the
   * hub's `note` renders amber rather than as a neutral aside. Same two fields
   * `SubmoduleDef` already carries in `lib/masters/submodules.ts`, spelled the
   * same way, because a hub that explains itself differently from the Master
   * Data hubs is the drift this whole registry exists to stop.
   */
  status?: "provisional";
  /** Banner text above the cards. Renders neutral on its own, amber when
   *  `status` is "provisional". A group with no note shows no banner. */
  note?: string;
  children: GroupChild[];
}

/** A leaf screen with no siblings worth grouping — stays a direct sidebar row. */
export interface ModuleLink {
  kind: "link";
  href: string;
  label: string;
}

export type ModuleEntry = ModuleGroup | ModuleLink;

export interface ModuleGrouping {
  /** Module label, held here so a hub page can render its breadcrumb without
   *  importing `nav.ts` — which imports this file, and would be a cycle. */
  label: string;
  /** Permission key for `requirePermission` on the hub page. */
  module: Module;
  entries: ModuleEntry[];
}

/**
 * Keyed by module href. A module absent from this map keeps whatever `children`
 * `nav.ts` declares for it — Sales already lists five sub-modules and needed no
 * regrouping, Analytics has no children at all.
 */
export const MODULE_GROUPS: Record<string, ModuleGrouping> = {
  // The seven groups below follow the legacy RP-Software 14-step order flow.
  //
  // They replace an earlier three-group cut whose "Order Entry" listed
  // `/orders/garment-orders` as a leaf — a route that was itself a 14-card hub,
  // duplicating `/orders` (same title, and its own "All Orders" card pointed
  // back there). So the operator clicked a sidebar row, got cards, clicked a
  // card, got the same cards again, and the third click returned them to the
  // start; its 14 screens were meanwhile in no sidebar row and no search result
  // (client 2026-08-08). A leaf is a SCREEN — assertion 8 in
  // `scripts/check-module-groups.mts` now enforces that, because every other
  // assertion passed while this shipped.
  //
  // NOTE the Amendments group's slug is `changes`, not `amendments`:
  // `/orders/amendments` is one of its own children, so a hub at that path
  // would both collide on disk and put a row beneath another row.
  "/orders": {
    label: "Orders",
    module: "orders",
    entries: [
      // The legacy 14-step Garment Orders hub, restored on request (2026-08-08)
      // after the 08-07 regrouping dissolved it into sub-modules. It is a GROUP
      // now rather than the hand-rolled `HubCard` grid it used to be, which is
      // what keeps the two failures that killed it from coming back:
      //
      //   - it renders from THIS registry, so a screen cannot be on the hub and
      //     missing from the sidebar (or the reverse) the way it was before;
      //   - every child is `cardOnly`, so restoring the hub adds exactly ONE
      //     sidebar row and no screen gains a second owner or a second search
      //     hit. The flow groups below still own their screens.
      //
      // The duplication AGENTS.md objected to is therefore still here by
      // design — `/orders` is both the module row and this hub's first card —
      // and it is deliberate: the operator asked for the legacy landing page
      // back. `owningNavHref`'s module-root guard keeps that card from stealing
      // the Orders row's highlight.
      //
      // `Material BOM` (/orders/material-bom) was a card on the legacy hub and
      // is NOT restored: the route has never existed in this app, so it was a
      // dead tile. Add it here the day the screen is built.
      {
        kind: "group",
        slug: "garment-orders",
        label: "Garment Orders",
        description:
          "The 14-step garment order flow — BOMs, processes, work orders, amendments, cancellation and completion",
        children: [
          { href: "/orders", label: "All Orders", description: "Confirmed orders; create one from an accepted quote", cardOnly: true },
          { href: "/orders/styles", label: "Style", description: "Order style master", cardOnly: true },
          { href: "/orders/color-cards", label: "Colour Cards", description: "Customer colour / Pantone cards", cardOnly: true },
          { href: "/orders/garment-processes", label: "Garment Processes", description: "Define garment processes for accepted orders", cardOnly: true },
          { href: "/orders/internal-work-orders", label: "Internal Work Orders", description: "Raise internal work orders", cardOnly: true },
          // The four amendment screens sit ONE LEVEL FURTHER DOWN (operator
          // request, 2026-08-08): this single card opens the Amendments hub,
          // which cards to Order / Material BOM / Process / Approve Amendment.
          // So the amendment screens are the 4th level — module row, hub row,
          // Amendments card, screen — and this hub keeps ten cards instead of
          // thirteen. It is a deliberate hub-to-hub link, which assertion 8
          // permits only because the target is a REGISTERED group of the same
          // module (see the carve-out there); an unregistered card grid behind
          // a card is still the bug that assertion exists to catch.
          { href: "/orders/changes", label: "Amendments", description: "Raise and approve changes to a confirmed order", cardOnly: true },
          { href: "/orders/advised-items", label: "Advised Items", description: "Prepare advised items", cardOnly: true },
          { href: "/orders/packing-advice", label: "Packing List Advice", description: "Packing-list advice for an order", cardOnly: true },
          { href: "/orders/cancellations", label: "Cancellation", description: "Cancel an order with a logged reason", cardOnly: true },
          { href: "/orders/completions", label: "Completion", description: "Mark an order complete / closed", cardOnly: true },
        ],
      },
      {
        kind: "group",
        slug: "setup",
        label: "Order Setup",
        description: "Colour cards and garment styles, defined before an order is raised",
        children: [
          { href: "/orders/color-cards", label: "Colour Cards", description: "Customer colour / Pantone cards" },
          { href: "/orders/styles", label: "Style", description: "Define garment styles — coordinates, components and sizes" },
        ],
      },
      {
        kind: "group",
        slug: "entry",
        label: "Order Entry",
        description: "Raise garment orders, book them, set pack ratios and record excess quantities",
        children: [
          // The module root, listed as a CARD — not as a sidebar row. Order Entry
          // without the screen an order is actually entered on sent the operator
          // looking for it (client 2026-08-08); the "no row duplicates its module
          // root" rule is about two SIDEBAR ROWS opening one page, and this is one
          // row and one card. `owningNavHref` skips it so /orders still highlights
          // the Orders row rather than this group.
          { href: "/orders", label: "Garment Orders", description: "All confirmed orders — create one from an accepted quote" },
          { href: "/orders/order-booking", label: "Order Booking", description: "Book confirmed orders against capacity" },
          { href: "/orders/pack-ratios", label: "Pack Ratios", description: "Size and colour ratios per carton" },
          { href: "/orders/excess-orders", label: "Excess Orders", description: "Supplementary quantities beyond the planned order, size-wise" },
        ],
      },
      // Sits directly under Order Entry by request (operator, 2026-08-08), not
      // in 14-step flow position — amending an order is what the operator does
      // next after raising one, so the two rows belong side by side. Row ORDER
      // in this array is the sidebar's order; nothing else reads it, so moving a
      // group here is safe and is the only way to move a row.
      {
        kind: "group",
        slug: "changes",
        label: "Amendments",
        description: "Raise and approve changes to a confirmed order",
        children: [
          { href: "/orders/amendments", label: "Order Amendment", description: "Amend a confirmed order across styles, prices, packing and logistics" },
          { href: "/orders/material-bom-amendment", label: "Material BOM Amendment", description: "Amend an accepted order's material BOM — items, processes and calculated quantities" },
          { href: "/orders/process-amendments", label: "Process Amendment", description: "Amend an order's component / garment process" },
          { href: "/orders/approve-amendments", label: "Approve Amendment", description: "Approve or reject raised amendments" },
        ],
      },
      {
        kind: "group",
        slug: "confirmations",
        label: "Confirmations & Review",
        description: "Sign off dates, prices and contract terms before production",
        children: [
          { href: "/orders/due-date-confirmations", label: "Due Date Confirmations", description: "Confirm delivery dates with the buyer" },
          { href: "/orders/contract-review", label: "Contract Review", description: "Review order terms before acceptance" },
          { href: "/orders/price-confirmation", label: "Price Confirmation", description: "Confirm agreed order prices" },
        ],
      },
      {
        kind: "group",
        slug: "execution",
        label: "Order Execution",
        description: "Process plans, work orders, advised items and packing advice",
        children: [
          { href: "/orders/garment-processes", label: "Garment Processes", description: "Select an accepted order and define its process plan" },
          { href: "/orders/internal-work-orders", label: "Internal Work Orders", description: "Raise internal work orders" },
          { href: "/orders/advised-items", label: "Advised Items", description: "Select an accepted order and prepare its advised items" },
          { href: "/orders/packing-advice", label: "Packing List Advice", description: "Prepare packing list advice for an order" },
        ],
      },
      {
        kind: "group",
        slug: "closure",
        label: "Order Closure",
        description: "Cancel or complete a garment order",
        children: [
          { href: "/orders/cancellations", label: "Cancellation", description: "Cancel an order with a logged reason" },
          { href: "/orders/completions", label: "Completion", description: "Mark an order complete / closed" },
        ],
      },
      // Already a hub of exactly this shape before the rest of the app caught
      // up — six TA screens behind one sidebar row. Left where it is.
      {
        kind: "group",
        slug: "ta",
        label: "Time & Action (TA)",
        description: "Activities, plans, follow-ups and completion for each order",
        children: [
          { href: "/orders/ta-masters", label: "TA Activity", description: "Master list of T&A activities" },
          { href: "/orders/ta-department-assign", label: "TA Department Assign", description: "Assign activities to departments and owners" },
          { href: "/orders/ta-user-rights", label: "TA User Rights", description: "Per-user activity permission matrix" },
          { href: "/orders/ta-style", label: "TA Style", description: "Style-level T&A configuration" },
          // The one `unavailable` card outside Planning, and the worst of the 21
          // because it is only HALF missing: `ta_plans` is a real table with 28
          // real rows, so the screen lists genuine plans and then cannot open a
          // single one — `ta_plan_docs`, `ta_plan_activities` and
          // `shipment_plans` are all absent. An empty screen at least looks
          // empty; this one looked like it was working. Hence the wording: it
          // says the plans ARE there, so nobody reads the grey tile as "we lost
          // the data" and goes looking for a restore.
          {
            href: "/orders/ta-plan",
            label: "TA Plan",
            description: "Build a Time & Action plan for an order",
            status: "unavailable",
            unavailableNote:
              "Plans are stored, but the activity and document tables are not in this database — a plan cannot be opened",
          },
          { href: "/orders/ta-completion", label: "TA Completion", description: "Record T&A completion" },
        ],
      },
    ],
  },

  "/planning": {
    label: "Planning",
    module: "planning",
    entries: [
      {
        kind: "group",
        slug: "bom",
        label: "Bill of Materials",
        description: "Fabric, garment, material and accessory BOMs, with shortage and transfer",
        note: "These screens are built, but the Planning tables are not in this database — migration 0332 removed them and the replacement schema has not been applied. Nothing here can be opened or saved yet.",
        status: "provisional",
        children: [
          { href: "/planning/fabric-bom", label: "Fabric BOM", description: "Fabric components, consumption and loss per order", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
          { href: "/planning/garment-bom", label: "Garment BOM", description: "Garment-level bill of materials", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
          { href: "/planning/material-bom", label: "Material BOM", description: "Sewing and packing materials per order", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
          { href: "/planning/accessory-bom", label: "Accessories BOM", description: "Accessory requirements per order", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
          { href: "/planning/bom-shortage", label: "BOM Shortage", description: "Required versus available gap across BOMs", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
          { href: "/planning/bom-transfer", label: "BOM Transfer", description: "Move BOM quantities between orders", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
        ],
      },
      {
        kind: "group",
        slug: "ppm",
        label: "PPM",
        description: "Production planning and material issue, with cancellation and completion",
        note: "These screens are built, but the Planning tables are not in this database — migration 0332 removed them and the replacement schema has not been applied. Nothing here can be opened or saved yet.",
        status: "provisional",
        children: [
          { href: "/planning/garment-ppm", label: "Garment PPM", description: "Garment production planning and material", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
          { href: "/planning/processing-ppm", label: "Processing PPM", description: "Processing-side PPM documents", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
          { href: "/planning/purchase-ppm", label: "Purchase PPM", description: "Purchase-side PPM documents", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
          { href: "/planning/ppm-cancel", label: "PPM Cancel", description: "Cancel a PPM with a logged reason", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
          { href: "/planning/ppm-completion", label: "PPM Completion", description: "Close out a completed PPM", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
          { href: "/planning/garment-ppm-cancel", label: "Garment PPM Cancel", description: "Cancel a garment PPM", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
        ],
      },
      {
        kind: "group",
        slug: "fabric",
        label: "Fabric Planning",
        description: "Fabric orders and consumption against plan",
        note: "These screens are built, but the Planning tables are not in this database — migration 0332 removed them and the replacement schema has not been applied. Nothing here can be opened or saved yet.",
        status: "provisional",
        children: [
          { href: "/planning/fabric-order", label: "Fabric Order", description: "Raise fabric orders from the plan", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
          { href: "/planning/fabric-consumption", label: "Fabric Consumption", description: "Planned versus actual fabric usage", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
        ],
      },
      {
        kind: "group",
        slug: "material",
        label: "Material Planning",
        description: "Excess material plans, rates and excess orders",
        note: "These screens are built, but the Planning tables are not in this database — migration 0332 removed them and the replacement schema has not been applied. Nothing here can be opened or saved yet.",
        status: "provisional",
        children: [
          { href: "/planning/material-excess-plan", label: "Material Excess Plan", description: "Plan excess material against an order", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
          { href: "/planning/material-rate", label: "Material Rate", description: "Planned material rates", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
          { href: "/planning/excess-order", label: "Excess Order", description: "Raise an order for excess material", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
        ],
      },
      {
        kind: "group",
        slug: "capacity",
        label: "Capacity & Production",
        description: "Line capacity and production scheduling",
        note: "These screens are built, but the Planning tables are not in this database — migration 0332 removed them and the replacement schema has not been applied. Nothing here can be opened or saved yet.",
        status: "provisional",
        children: [
          { href: "/planning/capacity-planning", label: "Capacity Planning", description: "Available capacity per line and period", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
          { href: "/planning/production-planning", label: "Production Planning", description: "Schedule production against capacity", status: "unavailable", unavailableNote: "Screens are built — the Planning tables are not in this database (0332 dropped them)" },
        ],
      },
      { kind: "link", href: "/planning/budgets", label: "Budgets" },
    ],
  },

  "/purchase": {
    label: "Purchase",
    module: "materials_purchase",
    entries: [
      {
        kind: "group",
        slug: "procurement",
        label: "Procurement",
        description: "Indents, RFQs and purchase orders",
        children: [
          { href: "/purchase/orders", label: "Purchase Orders", description: "Create from budget, submit and approve" },
          { href: "/purchase/rfq", label: "RFQ", description: "Request quotes from vendors and award" },
          { href: "/purchase/indents", label: "Indents", description: "Department indents and their lines" },
          // Was a sibling of Indents in the old flat list even though it is a
          // route BENEATH it. This is the conflict the regrouping was asked for.
          { href: "/purchase/indents/approval", label: "Indent Approval", description: "Acknowledge and approve raised indents" },
        ],
      },
      {
        kind: "group",
        slug: "receiving",
        label: "Receiving",
        description: "Goods receipts and delivery challans",
        children: [
          { href: "/purchase/grn", label: "Goods Receipts", description: "Partial receipt, QC accept or reject, posts to Stores" },
          { href: "/purchase/dc", label: "Delivery Challans", description: "Issue material to processors and record returns" },
        ],
      },
      {
        kind: "group",
        slug: "approvals",
        label: "Approvals & Amendments",
        description: "Rate, price and budget changes, cancellation and completion",
        children: [
          { href: "/purchase/over-budget", label: "Over-budget Confirmation", description: "Budget versus quoted rate with variance" },
          { href: "/purchase/rate-amendments", label: "Rate Amendments", description: "Revise a PO line rate and recompute the total" },
          { href: "/purchase/price-confirmations", label: "Price Confirmation", description: "Confirm agreed purchase prices" },
          { href: "/purchase/po-cancellations", label: "Cancel PO", description: "Cancel a purchase order with a logged reason" },
          { href: "/purchase/completions", label: "PO Completions", description: "Close out a completed purchase order" },
        ],
      },
      { kind: "link", href: "/purchase/vendors", label: "Vendors" },
      { kind: "link", href: "/purchase/lab", label: "Lab / QC" },
    ],
  },

  "/stores": {
    label: "Stores",
    module: "stores",
    entries: [
      {
        kind: "group",
        slug: "setup",
        label: "Stock Setup",
        description: "Opening balances and stock adjustments",
        children: [
          { href: "/stores/opening-stock", label: "Opening Stock", description: "Set a store's initial balances" },
          { href: "/stores/adjustments", label: "Adjustments", description: "Adjust stock in or out with a reason" },
        ],
      },
      {
        kind: "group",
        slug: "issues",
        label: "Issues & Requisitions",
        description: "Department requests and inter-department delivery",
        children: [
          { href: "/stores/requisitions", label: "Requisitions", description: "Material requisition slips, submit to issue" },
          { href: "/stores/interdept", label: "Inter-dept Delivery", description: "Move material between departments" },
        ],
      },
      {
        kind: "group",
        slug: "processing",
        label: "Processing",
        description: "Process orders, issues and receipts",
        children: [
          { href: "/stores/process-orders", label: "Process Orders", description: "Orders raised on a processing store" },
          { href: "/stores/process-issues", label: "Process Issues", description: "Issue material out for processing" },
          { href: "/stores/process-receipts", label: "Process Receipts", description: "Receive material back from processing" },
        ],
      },
      {
        kind: "group",
        slug: "receipts",
        label: "Receipts & Returns",
        description: "Customer-supplied receipts and vendor returns",
        children: [
          { href: "/stores/csp-receipts", label: "CSP Receipts", description: "Customer-supplied and consignment material" },
          { href: "/stores/vendor-returns", label: "Vendor Returns", description: "Return to vendor, with replacement" },
        ],
      },
      { kind: "link", href: "/stores/transfers", label: "Transfers" },
    ],
  },

  "/production": {
    label: "Production",
    module: "production",
    entries: [
      {
        kind: "group",
        slug: "manufacturing",
        label: "Manufacturing",
        description: "Job orders and contractor piece rates",
        children: [
          { href: "/production/job-orders", label: "Job Orders", description: "Job orders and their component details" },
          { href: "/production/piece-rates", label: "Piece Rates", description: "Per-operation contractor rates, submit and approve" },
        ],
      },
      {
        kind: "group",
        slug: "finishing",
        label: "Finishing & Despatch",
        description: "Inspection, packing and finished-goods despatch",
        children: [
          { href: "/production/inspections", label: "Inspections", description: "Final QC with pass, fail or rework" },
          { href: "/production/packing-lists", label: "Packing Lists", description: "Carton-wise packing lists" },
          { href: "/production/despatch", label: "Despatch", description: "Despatch finished goods to Logistics" },
        ],
      },
      { kind: "link", href: "/production/masters", label: "Planning Masters" },
    ],
  },

  "/hr": {
    label: "HR & Payroll",
    module: "hr_payroll",
    entries: [
      {
        kind: "group",
        slug: "people",
        label: "People",
        description: "Workers, staff, contractors and their lifecycle",
        children: [
          { href: "/hr/workers", label: "Workers", description: "Worker master and bulk import" },
          { href: "/hr/staff", label: "Staff", description: "Staff master" },
          { href: "/hr/contractors", label: "Contractors", description: "Contractor master" },
          { href: "/hr/lifecycle", label: "Lifecycle", description: "Joining, transfer, confirmation and exit" },
        ],
      },
      {
        kind: "group",
        slug: "time",
        label: "Time & Attendance",
        description: "Attendance, piece records and leave",
        children: [
          { href: "/hr/attendance", label: "Attendance", description: "Mark and review daily attendance" },
          { href: "/hr/piece-records", label: "Piece Records", description: "Piece-rate output per worker" },
          { href: "/hr/leave", label: "Leave & Encashment", description: "Leave balances, applications and encashment" },
        ],
      },
      {
        kind: "group",
        slug: "pay",
        label: "Pay",
        description: "Payroll runs, payslips, advances and adjustments",
        children: [
          { href: "/hr/payroll", label: "Payroll Runs", description: "Run payroll for a period" },
          { href: "/hr/payslip", label: "Payslips", description: "Generate and issue payslips" },
          { href: "/hr/advances", label: "Advances", description: "Advances and loans against pay" },
          { href: "/hr/adjustments", label: "Allowances & Deductions", description: "One-off and recurring pay adjustments" },
          { href: "/hr/comp-events", label: "Bonus & Increments", description: "Bonus, increment and compensation events" },
        ],
      },
      {
        kind: "group",
        slug: "compliance",
        label: "Compliance & Setup",
        description: "Statutory documents and payroll settings",
        children: [
          { href: "/hr/statutory", label: "Statutory Docs", description: "PF, ESI and other statutory records" },
          { href: "/hr/settings", label: "Settings", description: "Payroll heads, rules and periods" },
        ],
      },
    ],
  },

  "/logistics": {
    label: "Logistics",
    module: "logistics",
    entries: [
      {
        kind: "group",
        slug: "documents",
        label: "Shipping Documents",
        description: "Proforma invoices and letters of credit",
        children: [
          { href: "/logistics/proforma", label: "Proforma Invoices", description: "Raise proforma invoices for a shipment" },
          { href: "/logistics/lc", label: "Letters of Credit", description: "Letters of credit and their terms" },
        ],
      },
      {
        kind: "group",
        slug: "exports",
        label: "Export Incentives",
        description: "EPCG declarations and incentive claims",
        children: [
          { href: "/logistics/epcg", label: "EPCG Declarations", description: "EPCG scheme declarations" },
          { href: "/logistics/incentives", label: "Export Incentives", description: "Track and claim export incentives" },
        ],
      },
      {
        kind: "group",
        slug: "categories",
        label: "Categories",
        description: "Export and order category assignment",
        children: [
          { href: "/logistics/export-categories", label: "Export Categories", description: "Maintain export category master" },
          { href: "/logistics/order-categories", label: "Order Category Assign", description: "Assign orders to export categories" },
        ],
      },
    ],
  },

  "/finance": {
    label: "Finance",
    module: "finance",
    entries: [
      {
        kind: "group",
        slug: "setup",
        label: "Chart & Setup",
        description: "Accounts, cost centres, cost heads and party openings",
        children: [
          { href: "/finance/accounts", label: "Chart of Accounts", description: "Account groups and heads" },
          { href: "/finance/cost-centres", label: "Cost Centres", description: "Cost centre master" },
          { href: "/finance/cost-heads", label: "Cost Heads & Items", description: "Cost heads and their items" },
          { href: "/finance/party-openings", label: "Party Openings", description: "Opening balances per party" },
        ],
      },
      {
        kind: "group",
        slug: "ar-ap",
        label: "Payables & Receivables",
        description: "Bills, invoices and debit or credit notes",
        children: [
          { href: "/finance/payables", label: "Payables", description: "Vendor bills and payment due" },
          { href: "/finance/receivables", label: "Receivables", description: "Customer invoices and receipts" },
          { href: "/finance/notes", label: "Debit / Credit Notes", description: "Raise debit and credit notes" },
        ],
      },
      {
        kind: "group",
        slug: "banking",
        label: "Banking",
        description: "Limits, journals, cheques, forward contracts and rates",
        children: [
          { href: "/finance/bank-limits", label: "Bank Limits", description: "Sanctioned limits per bank" },
          { href: "/finance/bank-journals", label: "Bank Journals", description: "Bank receipt and payment entries" },
          { href: "/finance/cheques", label: "Cheque Register", description: "Issued and received cheques" },
          { href: "/finance/forward-contracts", label: "Forward Contracts", description: "Forward cover against export receivables" },
          { href: "/finance/exchange-rates", label: "Exchange Rates", description: "Period exchange rates" },
        ],
      },
      {
        kind: "group",
        slug: "invoicing",
        label: "Invoicing",
        description: "Provisional and domestic invoices",
        children: [
          { href: "/finance/provisional-invoices", label: "Provisional Invoices", description: "Raise provisional invoices" },
          { href: "/finance/domestic-invoices", label: "Domestic Invoices", description: "Domestic sales invoices" },
        ],
      },
      {
        kind: "group",
        slug: "results",
        label: "Ledger & Results",
        description: "General ledger, other entries and shipment profitability",
        children: [
          { href: "/finance/ledger", label: "General Ledger", description: "Journals and ledger enquiry" },
          { href: "/finance/other-entries", label: "Other Income / Expense", description: "Entries outside AR and AP" },
          { href: "/finance/pnl", label: "Shipment P&L", description: "Profitability per shipment" },
        ],
      },
    ],
  },

  "/admin": {
    label: "Administration",
    module: "system_admin",
    entries: [
      {
        kind: "group",
        slug: "organisation",
        label: "Organisation",
        description: "Company profile, divisions and document numbering",
        children: [
          { href: "/admin/company", label: "Company Profile", description: "Legal entity, address and identifiers" },
          { href: "/admin/divisions", label: "Divisions", description: "Divisions and units" },
          { href: "/admin/document-no-formats", label: "Document No Format", description: "Numbering series per document type" },
        ],
      },
      {
        kind: "group",
        slug: "access",
        label: "Access Control",
        description: "Users, roles and the audit trail",
        children: [
          { href: "/admin/users", label: "Users", description: "User accounts and their roles" },
          { href: "/admin/roles", label: "Roles & Permissions", description: "Role grants and permission scopes" },
          { href: "/admin/audit", label: "Audit Log", description: "Who changed what, and when" },
        ],
      },
      {
        kind: "group",
        slug: "resources",
        label: "Resources",
        description: "Assets and couriers",
        children: [
          { href: "/admin/assets", label: "Assets", description: "Asset register" },
          { href: "/admin/couriers", label: "Courier", description: "Courier partners and tracking" },
        ],
      },
    ],
  },
};

/** The sidebar `children` for a module — groups become one row each. */
export function moduleNavChildren(
  moduleHref: string,
): { href: string; label: string }[] | undefined {
  const grouping = MODULE_GROUPS[moduleHref];
  if (!grouping) return undefined;
  return grouping.entries.map((e) =>
    e.kind === "group"
      ? { href: `${moduleHref}/${e.slug}`, label: e.label }
      : { href: e.href, label: e.label },
  );
}

/** A group plus its module context, for the hub page. `null` when unknown. */
export function findGroup(moduleHref: string, slug: string) {
  const grouping = MODULE_GROUPS[moduleHref];
  if (!grouping) return null;
  const group = grouping.entries.find(
    (e): e is ModuleGroup => e.kind === "group" && e.slug === slug,
  );
  if (!group) return null;
  return {
    group,
    moduleHref,
    moduleLabel: grouping.label,
    module: grouping.module,
  };
}

/**
 * The GROUP a card opens, when that card opens another hub of the same module
 * rather than a screen. `null` for an ordinary leaf.
 *
 * A card that leads to more cards must not look like a card that leads to work,
 * and there is exactly one of those today: Garment Orders ▸ "Amendments" opens
 * `/orders/changes`, which is itself a card grid. Rendered identically to its
 * nine siblings, it promises a screen and delivers another list — a milder form
 * of the loop the 08-07 regrouping was reported for (client 2026-08-08).
 *
 * DERIVED, NEVER DECLARED. The answer is already in this file: a card opens a
 * hub exactly when its href is a registered group route of the same module,
 * which is the same set assertion 8 in `scripts/check-module-groups.mts` builds
 * to permit the link in the first place. A flag beside it could be forgotten on
 * the next nested sub-module, or left behind when one stops being a hub; this
 * cannot go stale because there is nothing to keep in sync.
 *
 * A single segment only — `/purchase/indents/approval` is a screen beneath a
 * screen, not a hub — and the module root resolves to nothing, so the "All
 * Orders" card stays an ordinary card.
 */
export function groupAtRoute(
  moduleHref: string,
  href: string,
): ModuleGroup | null {
  if (!href.startsWith(moduleHref + "/")) return null;
  const slug = href.slice(moduleHref.length + 1);
  if (!slug || slug.includes("/")) return null;
  return findGroup(moduleHref, slug)?.group ?? null;
}

/** Same test the sidebar uses: exact match, or a segment beneath it. */
function onRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * The sidebar row that owns a route — the GROUP containing the leaf, or the
 * standalone link itself. `undefined` when the module isn't grouped or nothing
 * matches, so the caller can fall back to a plain prefix scan.
 *
 * This exists because grouping is navigational and the leaf routes did NOT
 * move: `/planning/fabric-bom` is a child of the "Bill of Materials" row but is
 * not a path beneath `/planning/bom`, so the sidebar's prefix test alone would
 * highlight no sub-module at all and the operator would lose their place.
 * Master Data never needed this — its entities really are nested under the hub
 * (`/masters/materials/yarn`), which is exactly the difference re-parenting
 * every route would have bought, at the cost of every existing deep link.
 *
 * Longest match wins, for the same reason the plain scan sorts by length:
 * `/purchase/indents/approval` must beat `/purchase/indents`, which is the pair
 * that sat side by side in the old flat list.
 *
 * A CHILD EQUAL TO THE MODULE ROOT IS SKIPPED. A hub may list its module root as
 * a card — Orders ▸ Order Entry lists "Garment Orders" → `/orders`, the screen an
 * order is entered on. Without this guard that leaf matches the pathname
 * `/orders`, so visiting the module root would highlight the *sub-module* row and
 * `sidebar.tsx` would drop `parentStrong` from the module row entirely: the
 * operator lands on Orders and the sidebar says they are in Order Entry.
 */
export function owningNavHref(
  moduleHref: string,
  pathname: string,
): string | undefined {
  const grouping = MODULE_GROUPS[moduleHref];
  if (!grouping) return undefined;

  let bestRow: string | undefined;
  let bestLen = -1;
  const consider = (row: string, matched: string) => {
    if (onRoute(pathname, matched) && matched.length > bestLen) {
      bestRow = row;
      bestLen = matched.length;
    }
  };

  for (const e of grouping.entries) {
    if (e.kind === "link") {
      consider(e.href, e.href);
      continue;
    }
    const groupHref = `${moduleHref}/${e.slug}`;
    consider(groupHref, groupHref); // the hub page itself
    for (const c of e.children) {
      if (c.href === moduleHref) continue; // the module row owns its own route
      if (c.cardOnly) continue; // a card here; its row is in another group
      consider(groupHref, c.href);
    }
  }
  return bestRow;
}

/**
 * Every screen inside a module's groups, flattened, each tagged with the group
 * it belongs to. Empty for an ungrouped module.
 *
 * This is what keeps SEARCH working. Nav search walks a module's sidebar
 * `children`, and those are now groups — so a leaf like "Fabric BOM" stopped
 * being a row anything could match, and every `SECTION_ACTIONS` entry keyed to
 * a leaf href ("/hr/workers" → "New Worker") went with it. Grouping is meant to
 * shorten the sidebar, not to hide screens from the command palette.
 *
 * TWO children are held back, for opposite reasons — one is listed elsewhere,
 * the other is not a screen at all.
 */
export function moduleLeafItems(
  moduleHref: string,
): { href: string; label: string; groupLabel: string }[] {
  const grouping = MODULE_GROUPS[moduleHref];
  if (!grouping) return [];
  return grouping.entries.flatMap((e) =>
    e.kind === "group"
      ? e.children
          // A `cardOnly` child is a second listing of a screen that already
          // reaches search from its owning group; including it here would put
          // the same screen in the palette twice, under two group labels.
          //
          // A `todo` child has NO ROUTE — that is what the flag means, and the
          // check asserts both directions of it. Offering one to the command
          // palette is offering a search result that 404s, and assertion 7
          // ("every screen a group hides is still findable") would then confirm
          // the unbuilt screen as reachable. A check agreeing with a broken
          // promise is worse than no check: it is the shape of the `created_by`
          // sweep that shipped 143 correct-looking columns full of dashes.
          //
          // An `unavailable` child is excluded for the same reason arrived at
          // from the opposite direction: its route DOES resolve, so the palette
          // result does not 404 — it lands the operator on a clean, empty table
          // that cannot save. A search hit that silently goes nowhere useful is
          // the worse of the two, because nothing about it looks wrong.
          .filter((c) => !c.cardOnly && c.status === undefined)
          .map((c) => ({
            href: c.href,
            label: c.label,
            groupLabel: e.label,
          }))
      : [],
  );
}

/** Every group route, so a check can assert a hub page exists for each. */
export function allGroupRoutes(): string[] {
  return Object.entries(MODULE_GROUPS).flatMap(([moduleHref, g]) =>
    g.entries
      .filter((e): e is ModuleGroup => e.kind === "group")
      .map((e) => `${moduleHref}/${e.slug}`),
  );
}
