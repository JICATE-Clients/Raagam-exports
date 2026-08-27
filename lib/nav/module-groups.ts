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
   * claiming it: Amendments shows Order Amendment, because raising one is
   * amendment work — but the ROW is Order Entry ▸ Garment Order, since that one
   * screen is where a garment order is entered in the first place.
   *
   * That example ran the other way round until 2026-08-11, and the reversal is
   * the point: which group owns the row is a claim about what the screen IS,
   * and it moved when the answer did. The flag is what let it move without the
   * screen leaving the flow group beside the other three amendment screens.
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
   * NO SIDEBAR ROW, but everything else about the group stays live.
   *
   * `moduleNavChildren` is the only reader that honours this, so the hub page
   * still renders at its own URL, `findGroup` still resolves it, and its cards
   * still work. Only the row disappears.
   *
   * SAFE EXACTLY WHEN EVERY CHILD IS `cardOnly`. Those children are owned by
   * another group's row, so hiding this one strands nothing — it is the precise
   * inverse of what made restoring Garment Orders cheap ("it adds exactly ONE
   * sidebar row, and not one screen changes owner"). Hide a group whose
   * children are NOT cardOnly and those screens lose their only row; the nav
   * check's orphan assertion is what would catch it.
   *
   * Preferred over commenting the block out, which is what "we may need it
   * again" usually becomes: a commented registry entry stops being
   * type-checked, and its routes stop being asserted, so it rots silently.
   */
  hidden?: boolean;
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
  /**
   * BUILT, BUT ITS TABLE IS NOT IN THIS DATABASE — the same flag a `GroupChild`
   * carries, and it is here because its absence let one screen lie.
   *
   * `/planning/budgets` is a standalone link, so it was the one Planning entry
   * that could not be marked while its 25 siblings all were — and
   * `hub-count-map.ts` had already recorded it as unavailable. It therefore
   * presented as a working screen over a table 0332 dropped.
   *
   * A `link` has no `todo` state on purpose: a route that does not exist yet has
   * no business being a sidebar row of its own.
   */
  status?: "unavailable";
  /** Why it cannot be used, in the operator's words. Same contract as
   *  `GroupChild.unavailableNote` — required in practice, optional in the type
   *  so the check reports it with a message worth reading. */
  unavailableNote?: string;
}

export type ModuleEntry = ModuleGroup | ModuleLink;

export interface ModuleGrouping {
  /** Module label, held here so a hub page can render its breadcrumb without
   *  importing `nav.ts` — which imports this file, and would be a cycle. */
  label: string;
  /**
   * One line under the title on the module's own landing page (`ModuleHub`).
   *
   * Optional because the sidebar never showed one and most modules have not
   * been given one yet; `ModuleHub` falls back to a count of sub-modules rather
   * than inventing a sentence, since a made-up summary on a landing page is the
   * drift the hand-written grids were already in.
   */
  description?: string;
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
    description:
      "The garment order flow — styles and BOMs, entry, amendments, confirmation, execution and closure",
    entries: [
      // THE LEGACY 14-STEP GARMENT ORDERS HUB IS GONE (client 2026-08-13).
      //
      // It was restored as a group on 2026-08-08, hidden from the sidebar on
      // 08-10, and retired here. Each step is the same objection getting
      // sharper: it carded ten screens that the flow groups below already own,
      // so it was a second way in rather than a home. Hiding it removed the
      // row and left the page; this removes the page.
      //
      // What settled it was the operator's rule for the whole menu — a
      // sub-module lists ITS OWN children and nothing borrowed. This hub had no
      // children of its own at all: every one of its nine was `cardOnly`. It
      // was nine tenths of every `cardOnly` card in the app, and deleting it
      // leaves exactly one (Amendments ▸ Order Amendment, below, which now has
      // a route of its own and no longer needs the flag either — so the count
      // is zero).
      //
      // Its ROUTE is not gone. `/orders/garment-orders` is the Garment Order
      // ENTRY screen now — the name operators have used for that screen for
      // years, freed by this deletion. So `OLD_NAV_LEAVES` still finds it
      // reachable and no `REDIRECTED` entry is needed; check:nav asserts that.
      //
      // It also closes a latent bug. `owningNavHref` does not filter `hidden`,
      // so this group could win the sidebar highlight for a row that was never
      // rendered — the operator lands on a screen and nothing lights up.
      // THE CLIENT'S SIX-STEP SETUP, IN ONE ROW (client 2026-08-14).
      //
      // The legacy nine-step process is now six, and all six are declared here
      // in step order rather than scattered across three sub-modules. Before
      // this, Style was the group's ONLY child while steps 2 and 3 sat under
      // "Order Entry", step 4 under "Order Execution", and steps 5 and 6 in
      // Planning — so the flow the operator is taught existed nowhere in the
      // menu, and the row named after it held one screen.
      //
      // THE STEPS MOVED TWICE SINCE THEY WERE LAST WRITTEN DOWN, and both times
      // the change was in the tail. All three lists are the client's; the last
      // supersedes, and keeping the earlier two here is what makes a fourth
      // revision readable as a revision rather than as a correction:
      //
      //   08-10  Style · Order Entry · Material BOM · Fabric BOM · Budget ·
      //          Budget Approval
      //   08-14  … Garment Process Plan · Fabric Plan · Budgeting, with Prepare
      //          and Approve collapsed into the last one
      //   08-17  … Fabric BOM · Fabric Plan · Budgeting · Approval — the BOM is
      //          back and is a step of its own, and Approve is uncollapsed
      //   08-17b Garment Process Plan comes OUT: "only 7 are needed"
      //   08-25  STYLE comes out of the MENU — "we add this in garment order so
      //          only hide it from ui". The step is not deleted, it MOVED INTO
      //          THE SCREEN BELOW IT: 0457 / 0461 put the Style master's own
      //          fields, its components child and its coordinates onto the order
      //          line, and sizes had been there since 0407. A step that is now
      //          the first section of step 1 is not a step of its own.
      //
      // SO IT IS SIX STEPS: Order Entry · Material BOM · Fabric BOM · Fabric
      // Plan · Budgeting · Approval.
      //
      // THE SCREEN IS NOT GONE, and this is the same distinction the 08-14
      // menu change already drew: it is a child of `retired` at the bottom of
      // this table — off the menu, still on the URL, still in the command
      // palette. That last part is load-bearing here in a way it was not for
      // Pack Ratios: `garment_styles` is still read in ten places, the order
      // line's Style picker is `required` ("a line with no style is not a
      // line") and it has no quick-create, so the palette is the only remaining
      // route to making the row an order cannot save without.
      //
      // THE COUNT HAS NEVER BEEN THE CLIENT'S CLAIM — the sequence is. The 08-14
      // list read as six only because Fabric BOM had gone missing under Fabric
      // Plan's name; adding the BOM back made it eight; and the client's answer
      // to eight was to drop the one entry that is not a step every order must
      // pass through. Do not "restore" a step to make a number match a heading
      // somewhere: read the sequence, and change the heading.
      //
      // "ORDER ENTRY" IS A CARD HERE, NOT A ROW. That group is dissolved — its
      // register became a standalone row (below), its two flow screens are the
      // first two steps, and its three legacy screens are retired at the bottom of this
      // table. Cross-listing the steps as `cardOnly` instead was the alternative
      // and is the shape that was already deleted once: the 14-step Garment
      // Orders hub went on 2026-08-13 precisely because every one of its nine
      // children was borrowed, so it was a second way in rather than a home.
      // "ORDER SETUP" WAS RENAMED "ORDER PREPARATION" ON 2026-08-25 (client),
      // and the reason is that Style leaving made the old name false.
      //
      // "Setup" MEANS CONFIGURATION IN THIS APP, and it means it consistently:
      // Stores ▸ Stock Setup, Finance ▸ Chart & Setup, HR ▸ Compliance & Setup
      // are all master/config rows. This group was named that way when its step 1
      // was the Style MASTER — so the label was accurate. With Style gone every
      // card here acts on ONE LIVE ORDER: raise it, work out what it needs
      // (Material BOM, CAD, Fabric BOM, Fabric Plan), cost it, get the budget
      // approved. Nothing in it configures anything, so the word now sends the
      // operator looking for settings and offers them an order.
      //
      // PREPARATION · EXECUTION · CLOSURE is the series it joins, and three of
      // its five siblings are already lifecycle phases. That is what picked this
      // name over the more obvious "Order Planning": there is a whole PLANNING
      // MODULE two rows down the sidebar, whose own rows are Bill of Materials,
      // Fabric Planning and Budgets — the same three words this group's cards
      // use. A row named "Order Planning" sitting above it would read as that
      // module's order-scoped half, which is exactly what it is not.
      //
      // THE SLUG STAYS `setup`, so the URL is still /orders/setup. A label is a
      // name and a slug is an address: renaming the address breaks every deep
      // link and bookmark, moves the hub page on disk, and buys nothing an
      // operator can see. The registry already carries this split deliberately —
      // the Amendments group's slug is `changes` — and `owningNavHref`,
      // `backTarget` and nav search all read the LABEL, so the rename reaches
      // every surface without touching a route.
      {
        kind: "group",
        slug: "setup",
        label: "Order Preparation",
        description:
          "Order entry to approved budget — the six steps a bulk order passes through",
        // Colour Cards was the other half of this group and was removed with its
        // routes and service (client, 2026-08-11): the screen had no rows, its
        // only consumer was the Garment Order colour picker, and that picker is
        // now free text. The `color_cards` / `color_card_colors` TABLES are
        // deliberately left in place — dropping an Orders screen's tables is the
        // 0332 mistake this repo has already spent a session repairing, and
        // empty tables cost nothing to keep.
        children: [
          // STYLE WAS STEP 1 UNTIL 2026-08-25 and is now a child of `retired`.
          // The garment's DNA — coordinates, components, structures — is entered
          // on the order line itself (0457 / 0461), so the card here would open
          // a second place to state what step 1 already states.
          //
          // 1 · ORDER ENTRY — THE SCREEN AN ORDER IS ACTUALLY ENTERED ON.
          //
          // Its row sat under Amendments until 2026-08-11, labelled "Order
          // Amendment", because that is the document it writes — while Order
          // Entry's first child was `/orders`, an eight-field generic scaffold.
          // So the row named Order Entry opened a stand-in and the real legacy
          // screen (the SCNo · Date · Initiated · Type · Customer … header and
          // the ten section rail, dictated tab by tab on 2026-08-10) was filed
          // under a name that says it CHANGES an order rather than raises one.
          //
          // MOVING THE ROW FIXED HALF OF IT. The route was still
          // `/orders/amendments`, so entering a fresh order meant walking a URL
          // that says amendment — and the screen said both at once, "New
          // Garment Order" at the top and "Save amendment" at the bottom. The
          // menu papered over it by listing the one route twice under two
          // labels, which is the shape a wrong name always takes.
          //
          // So the ENTRY screen took a route that means entry (client
          // 2026-08-13), and `/orders/amendments` kept its name and became what
          // it says: the amend door, below. `createAmendment` mints a NEW
          // sales_orders row — this is where an order is raised.
          //
          // THE LABEL IS THE STEP NAME NOW. It read "Garment Order" while its
          // group was "Order Entry"; with the group gone the card has to carry
          // the step, or the operator's entry step has no row and no card
          // bearing its name (it was step 2 then, and is step 1 since Style left
          // the list on 08-25 — which is why the sentence no longer names a
          // number). The route still says `garment-orders`, which is the name
          // operators have used for the screen for years.
          { href: "/orders/garment-orders", label: "Order Entry", description: "Raise a garment order — buyer PO, styles, colours, prices, packing, quantities and logistics" },
          // 2 · MATERIAL BOM — and it belongs beside the order it plans for, not
          // under Amendments where it sat until 2026-08-13.
          //
          // It moved for the reason the card above did. The screen plans an
          // order's material FOR THE FIRST TIME more often than it revises one:
          // `material_bom_amendments` (0265) has no link to a prior BOM — no
          // base id, no parent, no revision column, only `sales_order_id` — and
          // Approve Amendment does not look at it. A screen filed under
          // Amendments that mostly does first-time entry is the same mis-filing
          // the Garment Order had, one door along.
          //
          // Amending a BOM needs no second row: `bomStatus`'s `recalculate`
          // state (status.ts) already means "the order moved since this was
          // computed", so the work queue surfaces the revision work in place. A
          // route filtered to one status would be a filter dressed as a screen —
          // unlike the Garment Order, where the two doors exist because one
          // MINTS A NEW `sales_orders` ROW and the other must not.
          //
          // THE ROUTE WAS RENAMED ON 2026-08-19 (client: "the routing also is
          // wrong — the Material BOM, this one is new, not an amendment"). It
          // had said `material-bom-amendment` since 0265, after the TABLE rather
          // than after the work: the screen has one door and no amend mode, and
          // the revision case is `bomStatus`'s `recalculate` state in place.
          //
          // The old URL answers as a `redirect()` and is declared in `REDIRECTED`
          // in scripts/check-module-groups.mts, which asserts the pair. The lib
          // folder and the `material_bom_amendments` table keep their names —
          // an import sweep and a migration with nothing user-visible at the end.
          { href: "/orders/material-bom", label: "Material BOM", description: "Plan every sewing and packing accessory a confirmed order needs, and how much of each" },
          // GARMENT PROCESS PLAN WAS STEP 4 AND IS NOT A STEP (client
          // 2026-08-17, second pass: "only 7 are needed").
          //
          // IT IS NOT DELETED AND ITS URL IS UNCHANGED. `/orders/garment-processes`
          // still works, still opens from search, and now takes its sidebar ROW
          // under Order Execution — where it had been listed as a `cardOnly` card
          // all along, because running a process plan is execution work. Leaving
          // the flag on would have orphaned the screen: `cardOnly` means "the row
          // lives elsewhere", and after this edit there was no elsewhere.
          // check:nav asserts exactly that, which is what makes the pair of edits
          // one change rather than two.
          //
          // The 08-14 list added it to the flow and this one removes it, and
          // both are the client's. What that leaves is doc/orders-six-step.md's
          // original position, arrived at from the other direction: "leaving the
          // numbered flow is not deletion… it stops being a step every order must
          // pass through and becomes optional, which is what 'reduce the number
          // of entries' means".
          //
          // 3 · FABRIC BOM — AND IT WAS MISSING UNDER ANOTHER NAME (client
          // 2026-08-17).
          //
          // The tail of this list used to be two cross-module cards pointing
          // into Planning, and the first of them was labelled **Fabric Plan**
          // while its href was `/planning/fabric-bom` — the Fabric BOM screen.
          // So the step the client asks for by name had no card, and the card
          // that stood in its place named a different step. The mislabel is why
          // it read as complete: six cards, six steps, one of them wrong.
          //
          // FABRIC BOM AND FABRIC PLAN ARE TWO STEPS, not one screen seen twice.
          // The BOM says what fabric each component of each colour needs and how
          // much; the plan says how that fabric is sourced and processed. The
          // client's 08-10 list (doc/orders-six-step.md) had only the BOM, so
          // this is the newer statement and supersedes — the same way that list
          // superseded the one before it.
          //
          // THESE FOUR ARE `todo`, NOT `unavailable`, and the difference is the
          // whole point of having two flags. `unavailable` claims a screen is
          // BUILT and only its table is missing, which was true of the Planning
          // pair — but Planning is not where these are being built. `0332`
          // dropped that module as "built from generic ERP patterns instead of
          // the VB.NET source of truth", so pointing a step of the client's flow
          // at one of its screens offers the operator the exact code that
          // migration rejected. Each of these is an ORDERS route that does not
          // exist yet, and assertion 10 in `scripts/check-module-groups.mts`
          // holds that both ways: a `todo` card whose `page.tsx` appears becomes
          // an error, so the flag cannot outlive the build.
          //
          // The Planning screens keep their own rows under Planning ▸ Bill of
          // Materials and Planning ▸ Fabric Planning, so nothing is orphaned by
          // their leaving this list — check:nav asserts that too.
          // BUILT 2026-08-17 (`0426`). The flag came off in the same change that
          // created `app/(app)/orders/fabric-bom/page.tsx`, because assertion 10
          // holds `status: "todo"` and a missing route as the SAME fact and
          // fails either way round — a `todo` whose page.tsx exists is an error,
          // which is what stops the label outliving the work.
          // CAD MARKERS — a DEPARTMENT'S WORK QUEUE, which is why it earns a row
          // rather than a button on one order (0460, doc/file.md §2).
          //
          // The two other screens built alongside it — the Order Sheet and the
          // RE-Community stream — are PageHeader actions on the order, because
          // each is a view OF one order and has no list to land on. This is the
          // opposite shape: a CAD technician opens it in the morning to see which
          // orders across the whole book are Pending / Draft / Panels unweighed /
          // Submitted. Reaching that through an order picker would mean choosing
          // an order before you can see which orders need you.
          //
          // Placed immediately BEFORE Fabric BOM because it feeds it: the gram
          // weights this screen captures are what step 3's consumption is seeded
          // from. `page.tsx` renders a PageHeader + DataTable and imports no
          // HubCard, so assertion 8 of check-module-groups.mts is satisfied.
          { href: "/orders/cad", label: "CAD Markers", description: "Marker layouts by fabric dia, panel gram weights, and the handoff to the Fabric BOM" },
          { href: "/orders/fabric-bom", label: "Fabric BOM", description: "Fabric per component and colour — consumption, cutting wastage and the net requirement" },
          // 4 · FABRIC PLAN — the sourcing and processing path for what step 3
          // requires: yarn purchase, knitting, dyeing, stentering, compacting,
          // and which of those are in-house against out-processed.
          // BUILT 2026-08-17 (`0427`). The description is narrower than the
          // `todo` placeholder's was, and deliberately: the client's answer to
          // what this step covers is the PROCESS ROUTE, not sourcing in general.
          // Fabric BOM is finished fabric; this walks backwards from it to the
          // yarn, applying each stage's loss.
          { href: "/orders/fabric-plan", label: "Fabric Plan", description: "The route that makes the fabric — knitting, dyeing and finishing, with each stage's loss" },
          // 5 · BUDGETING — and 6 · APPROVAL — are two STEPS over ONE document.
          //
          // Approval is a transition on the budget's own `status`, never a
          // second record: two records would let the approved figures drift from
          // the budget they approved. The app already does approvals this shape
          // (`/orders/approve-amendments` over the amendment's status), and the
          // legacy schema did too. So the last step is a QUEUE of submitted budgets,
          // and it is a step because the client counts it as one.
          // BUILT 2026-08-17 (`0428`). "the order" became "a GROUP of orders" in
          // the description, and that is the client's own shape from doc/prd.md:
          // "budgeting is done using Fabric BOM and Material BOM of various
          // orders which are grouped together". doc/orders-six-step.md sketched
          // one order per budget and is superseded.
          { href: "/orders/budgets", label: "Budgeting", description: "Cost a group of orders from their BOMs — rates, expenses and the profit position" },
          { href: "/orders/budget-approval", label: "Approval", description: "Approve or reject a submitted order budget — the last gate before purchase may act on it" },
        ],
      },
      // THE REGISTER IS OFF THE MENU (client 2026-08-17). It is the fourth child
      // of `retired` at the bottom of this table, and the note there says why the
      // group now holds two different kinds of screen.
      //
      // Its history, kept because the row has moved three times and a fourth
      // move should read as a move: it pointed at `/orders` — the module root —
      // while that route WAS the All Orders table; the root became an index of
      // these sub-modules on 2026-08-13, so the register took a route of its own
      // and became a card of Order Entry; when that group dissolved on 08-14 it
      // was promoted to a standalone `kind: "link"` row here.
      //
      // A `link` HAS NO `hidden` FLAG, and one was deliberately not added.
      // `moduleNavChildren` and `ModuleHub` both read `e.kind === "group" &&
      // e.hidden`, so the flag would have needed a second branch in each, plus a
      // ruling on what `backTarget` and `owningNavHref` should answer for a row
      // that is not rendered. Moving the entry into the group that already means
      // "off the menu, still on the URL" needs none of that and is the shape
      // three screens have been in since 08-14.
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
          // A ROW AGAIN, AND A REAL ONE (client 2026-08-13).
          //
          // It was `cardOnly` here, pointing at the same route as Order Entry ▸
          // Garment Order — one screen, two labels, one URL, so the two cards
          // opened the identical list and the labels had no choice but to
          // contradict each other. The screen has an amend DOOR of its own now:
          // the entry route above raises an order, `/orders/amendments` amends
          // a saved one, and the same component answers both from a `mode` prop.
          //
          // Dropping `cardOnly` is the point, not tidying. `owningNavHref` now
          // resolves this route to Amendments rather than to Order Entry, so
          // the sidebar lights the group the operator is actually in; and
          // `moduleLeafItems` gives "Order Amendment" a nav-search entry, which
          // a `cardOnly` child never had.
          { href: "/orders/amendments", label: "Order Amendment", description: "Amend a saved garment order across styles, prices, packing and logistics" },
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
          // ITS ROW IS HERE AGAIN — the `cardOnly` flag came off on 2026-08-17
          // when the client cut Order Setup to seven steps and this screen was
          // the one removed.
          //
          // THE FLAG HAD TO GO IN THE SAME EDIT. `cardOnly` means "the row lives
          // elsewhere", and the elsewhere was Order Setup ▸ step 4: leaving it on
          // would have made `owningNavHref` and `moduleLeafItems` both skip the
          // only listing left, so the screen would have had no sidebar row and no
          // command-palette entry while its route carried on working — reachable
          // by URL and by nothing else. That is the shape the 14-step Garment
          // Orders hub died of, and check:nav asserts against it.
          //
          // Which is also why this is where the row belongs rather than a new
          // group: the screen was ALREADY listed here, because running a process
          // plan is execution work. Only the flag moved.
          { href: "/orders/garment-processes", label: "Garment Process Plan", description: "Select an accepted order and define its process plan, including out-processing" },
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
          // Was the one `unavailable` card outside Planning until 0401 restored
          // its tables. 0332 dropped `ta_plan_docs` and `ta_plan_activities` at
          // its line 79 under a `-- TA Plan (0271)` heading — an ORDERS screen
          // caught by a migration scoped to Planning. The screen was complete
          // throughout; only the tables were missing.
          //
          // ONE THING IS STILL HALF-MISSING, and it is not a reason to grey the
          // card: `shipment_plans` (SH Ref No) is Planning's own table, restored
          // by 0401 as a STUB because a PostgREST embed against a missing table
          // fails the whole list query. Nothing in the app inserts into it, so
          // that ONE picker stays empty until Planning is rebuilt.
          // `shipment_plan_id` is nullable, so a plan saves fine without it.
          { href: "/orders/ta-plan", label: "TA Plan", description: "Build a Time & Action plan for an order" },
          { href: "/orders/ta-completion", label: "TA Completion", description: "Record T&A completion" },
        ],
      },
      // OFF THE MENU, STILL ON THE URL (client 2026-08-14).
      //
      // Order Booking, Pack Ratios and Excess Orders were named as redundant
      // legacy menus and their rows are gone. What was asked for is a MENU
      // change, and the standing rule for one is exact: "a screen that loses its
      // sidebar row keeps its URL". These three are not dissolved hubs — they
      // are working screens over live tables — so a `redirect()` would not be
      // retiring a row, it would be deleting three screens and guessing at three
      // successors. `hidden` removes precisely what was asked to go.
      //
      // WHAT SURVIVES: the hub page at /orders/retired, every child's route, and
      // every child's entry in the command palette (`moduleLeafItems` does not
      // filter `hidden`, and that is the property doing the work here — an
      // operator who still needs Pack Ratios can type it). What goes: one
      // sidebar row per screen, and the group's own row.
      //
      // THIS READS AGAINST THE FLAG'S OWN PRECONDITION and the difference is the
      // reason, not the shape. `hidden` is documented as safe exactly when every
      // child is `cardOnly`, because a non-cardOnly child would LOSE ITS ONLY ROW
      // — which is an accident there and the entire request here. The clause
      // guards against stranding a screen by mistake; nothing about it argues
      // against stranding one on purpose, with the way back written down.
      //
      // Preferred over deleting the entries for the reason the flag itself
      // records: a registry entry that is gone stops being type-checked and its
      // routes stop being asserted, so it rots. These stay in the type system,
      // stay in assertion 2's route check, and come back by deleting one word.
      //
      // ALL ORDERS JOINED ON 2026-08-17 (client), and it is the first child here
      // that is NOT a superseded legacy menu — it is the `sales_orders` register,
      // and the only code path in the app that inserts into that table. So the
      // group now means exactly what its `hidden` flag means and no more, "off
      // the menu, still on the URL", and the note below no longer claims Order
      // Setup replaced everything in it.
      //
      // TWO VISIBLE CONSEQUENCES, both inherited from the three above rather
      // than new, and both correct-by-derivation rather than chosen:
      //
      // - `backTarget` sends a group child to its group hub, so the register's
      //   "← Back" reads "Retired Screens" and lands on /orders/retired. That is
      //   the honest answer for a screen with no sidebar row; the alternative,
      //   `cardOnly`, is not available — it would strand the screen out of nav
      //   search and assertion 7 fails a child whose row resolves to nothing.
      // - `owningNavHref` does not filter `hidden`, so it resolves the register
      //   to a row that is never rendered and no sub-module lights up. The
      //   Orders module row still does.
      {
        kind: "group",
        slug: "retired",
        hidden: true,
        label: "Retired Screens",
        description: "Order screens kept reachable, but no longer in the menu",
        status: "provisional",
        note:
          "These screens are off the Orders menu — the first three because Order Preparation replaces them, and All Orders and Style by request. They all still work and still open from search — nothing has been deleted.",
        children: [
          { href: "/orders/order-booking", label: "Order Booking", description: "Book confirmed orders against capacity" },
          { href: "/orders/pack-ratios", label: "Pack Ratios", description: "Size and colour ratios per carton" },
          { href: "/orders/excess-orders", label: "Excess Orders", description: "Supplementary quantities beyond the planned order, size-wise" },
          // STYLE JOINED ON 2026-08-25 (client): "we add this in garment order so
          // only hide it from ui". It was step 1 of Order Preparation (still
          // named Order Setup that morning); 0457 / 0461 put
          // the master's fields, components and coordinates onto the order line,
          // and 0407 had already put sizes there — so the step is now the first
          // section of the screen that used to follow it, and a card for it would
          // be a second door onto one piece of work.
          //
          // IT IS THE THIRD KIND OF SCREEN IN THIS GROUP, and the least retired of
          // them. Order Booking et al are superseded menus; All Orders is a live
          // register taken off the menu by request; this is a MASTER that ten call
          // sites still read and that `pickStyle` seeds every order line from. The
          // group's flag means "off the menu, still on the URL" and nothing more —
          // which is exactly what was asked for, so the card belongs here rather
          // than in a second hidden group meaning the same thing.
          //
          // THE PALETTE ENTRY IS NOT A COURTESY HERE. The order line's Style is
          // `required` and its picker has no quick-create, so with the row gone
          // from the menu, `moduleLeafItems` (which does not filter `hidden`) and
          // `SECTION_ACTIONS["/orders/styles"]` are the only ways left to create
          // the master an order cannot save without. Do not "finish the job" by
          // deleting either — that would make a required field unfillable.
          { href: "/orders/styles", label: "Style", description: "Define garment styles — coordinates, components and sizes" },
          // Keeps its `hub-count-map.ts` entry (`sales_orders`), so the card here
          // still shows how many orders are behind it. Nothing needed changing
          // for that: the map is keyed by href, and `GroupHub` reads it for a
          // child exactly as `ModuleHub` did for the standalone row.
          { href: "/orders/all", label: "All Orders", description: "Every order raised, with its RE No, buyer, value and status" },
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
      // The one Planning entry that was not marked, because until now a `link`
      // had no way to say it. `hub-count-map.ts` already pinned its count to
      // null for exactly this reason, so the two now agree.
      {
        kind: "link",
        href: "/planning/budgets",
        label: "Budgets",
        status: "unavailable",
        unavailableNote:
          "Screens are built — the Planning tables are not in this database (0332 dropped them)",
      },
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
        description: "Company profile and divisions",
        // DOCUMENT NO FORMAT LEFT THIS GROUP (client 2026-08-12). It is the
        // legacy Configure ▸ System screen and now lives at
        // /masters/system/document-no-format; /admin/document-no-formats is a
        // `redirect()`, declared in `REDIRECTED` in
        // scripts/check-module-groups.mts so assertion 6 keeps checking it
        // rather than being quietly relieved of an entry.
        //
        // MOVED, NOT COPIED. Leaving the card here as well would be two sidebar
        // rows opening one page — the duplication this whole registry exists to
        // ban. `cardOnly` is not the escape hatch either: that flag is for a
        // second listing WITHIN a module, and the row now belongs to a different
        // module entirely.
        children: [
          { href: "/admin/company", label: "Company Profile", description: "Legal entity, address and identifiers" },
          { href: "/admin/divisions", label: "Divisions", description: "Divisions and units" },
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
  return grouping.entries
    // `hidden` groups keep their hub page and their URL — they are simply not
    // offered as a row. See the flag's own note for when that is safe.
    .filter((e) => !(e.kind === "group" && e.hidden))
    .map((e) =>
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
