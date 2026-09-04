// Verification for the sidebar's module → sub-module grouping
// (lib/nav/module-groups.ts) and the hub pages it drives.
//
// The repo has no test framework, so this runs standalone:
//     node --experimental-strip-types scripts/check-module-groups.mts
//
// Listed in tsconfig `exclude` for the same reason as check-name-suggest.mts:
// node's type stripping needs the `.ts` extension on these imports and the
// app's tsconfig forbids it, so the file is verified by running it, not by tsc.
// `module-groups.ts` itself imports only `import type { Module }`, which type
// stripping erases outright — so the `@/` alias is never resolved at runtime.
//
// What it asserts, and why each one is here rather than assumed:
//
//   1. Every group has a hub page. A group is a NEW route; forget the page and
//      the sidebar row 404s.
//   2. Every leaf points at a route that exists. Grouping must not invent
//      screens, and a typo'd href is invisible until someone clicks it.
//   3. NO SIDEBAR ROW IS A ROUTE BENEATH ANOTHER ROW. This is the rule the whole
//      change exists to enforce — "Indents" and "Indent Approval" as equals.
//   4. No row duplicates its own module root (Production Board → /production).
//   5. Every leaf resolves back to its group row. Grouping deliberately does not
//      move the leaf routes, so the sidebar cannot find them by prefix; if
//      `owningNavHref` regresses, the operator loses their place in the tree
//      with nothing else failing. Two children are exempt and both must resolve
//      ELSEWHERE rather than here: the module root (owned by the module row) and
//      a `cardOnly` child (a screen listed on this hub whose row is in another
//      group — Order Amendment on Order Entry). A cardOnly child owned by
//      NOTHING is a failure too; that means the second listing orphaned it.
//   6. Nothing the old flat nav reached became unreachable.
//   7. Every screen a group hides from the sidebar is still in nav search.
//   8. A LEAF IS A SCREEN, NOT AN UNDECLARED HUB. `/orders/garment-orders` was
//      registered as a leaf while being a 14-card hub that duplicated
//      `/orders`, so the operator clicked a sidebar row, got cards, clicked a
//      card, got the same cards, and the third click returned them to the start
//      (client 2026-08-08). Checks 1-7 all passed while that shipped, because 2
//      only asks whether the route EXISTS. A card MAY open another hub when that
//      hub is a REGISTERED group of the same module and the card is `cardOnly` —
//      that is a sub-module nested a level deeper (Garment Orders ▸ Amendments ▸
//      Order Amendment), which is hierarchy. What stays banned is the card grid
//      nobody declared: no sidebar row, no search entry, free to loop.
//   9. NO HUB CYCLE. Assertion 8 permits hub-to-hub links, so the loop it used
//      to prevent structurally now needs asserting: A cards to B, B cards back
//      to A, and the operator walks in a circle. Self-links are caught by 8.
//
// ---------------------------------------------------------------------------
// 10-13 came with the card VOCABULARY (`status` / `external` / `countKey`,
// 2026-08-08), which lets a card claim things the old `{href,label,description}`
// could not. Each claim is a promise to the operator, and a promise a machine
// does not check is one the registry can quietly break:
//
//  10. `status: "todo"` ⟺ THE ROUTE IS NOT BUILT. Both directions, because each
//      one hides work in the opposite direction: a "Not set up yet" card over a
//      working screen hides finished work behind a dead-looking tile, and an
//      unmarked card over a missing route is the 404 assertion 2 has always
//      caught. So assertion 2 now runs on non-todo children only, and 10 runs on
//      todo children — every card is covered by exactly one of them, and neither
//      flag can be used to slip past the other.
//  11. `external: true` ⟺ THE HREF LEAVES THE MODULE. Also both directions. The
//      ↗ says "this belongs to another module"; `/orders/ta` once passed it on
//      all six of its own siblings (see the note in `group-hub.tsx`), which is
//      the flag lying in one direction. A card that really does leave the module
//      with no ↗ is the same lie in the other: the operator clicks a tile on a
//      Purchase hub and lands in Finance with the sidebar moving under them.
//  12. A `countKey` RESOLVES. A key nothing counts renders a card with no
//      number — indistinguishable from a screen that legitimately has none, so
//      it fails silently, which is exactly how the `created_by` sweep shipped
//      143 correct-looking columns full of dashes (AGENTS.md).
//  13. A TODO CARD IS NOT IN NAV SEARCH. `moduleLeafItems` feeds the command
//      palette, so an unbuilt child there is a search result that 404s — and
//      assertion 7 would confirm it as "still findable", which is worse than
//      not checking. Contradictory flags (`todo` + `external`, `todo` +
//      `countKey`) are rejected in the same pass: a dashed unbuilt tile is not a
//      link out and shows no number, so either one is dead config that reads as
//      live.
//
// ---------------------------------------------------------------------------
// SELF-TEST. Standing repo rule: a new assertion must be proven to FAIL before
// it is trusted, because this repo has shipped a check that reported success
// while doing nothing (0386, AGENTS.md "Function grants"). Proving it once by
// hand-breaking the registry proves it for that afternoon only — the rules for
// 10-13 are therefore pure functions (`cardIssues`, `todoInSearch`) run on every
// invocation against FIXTURES that are deliberately wrong, and each fixture
// asserts both halves: the broken card is flagged, and its corrected twin is
// not. A rule that fires on everything is as useless as one that never fires.

import { existsSync, readFileSync } from "node:fs";
import {
  MODULE_GROUPS,
  moduleNavChildren,
  moduleLeafItems,
  owningNavHref,
  findGroup,
  type ModuleGroup,
  type GroupChild,
} from "../lib/nav/module-groups.ts";

let failures = 0;
function fail(msg: string) {
  console.error("  FAIL " + msg);
  failures++;
}

const APP = "app/(app)";
const routeExists = (href: string) => existsSync(`${APP}${href}/page.tsx`);

// ------------------------------------------------------- the card vocabulary
// Declared structurally rather than imported, so this file keeps working while
// `GroupChild` grows the fields: the intersection is `GroupChild` itself once
// they land, and reaches them anyway before that. (Type stripping erases all of
// it; the registry is type-checked by `tsc`, this file is verified by running.)
type Card = GroupChild & {
  status?: "todo";
  external?: boolean;
  countKey?: string;
};

const inModule = (moduleHref: string, href: string) =>
  href === moduleHref || href.startsWith(moduleHref + "/");

/**
 * Assertions 10-12, as a pure function of one card — so the self-test below can
 * feed it deliberately broken fixtures every run instead of trusting that
 * someone once broke the registry by hand and watched it fire.
 *
 * `built` is injected for the same reason: a fixture must be able to say "this
 * route exists" without a file on disk.
 */
function cardIssues(
  moduleHref: string,
  card: Card,
  built: (href: string) => boolean,
  countKeys: ReadonlySet<string> | null,
): string[] {
  const out: string[] = [];
  const todo = card.status === "todo";
  const unavailable = card.status === "unavailable";

  if (card.status !== undefined && !todo && !unavailable) {
    out.push(
      `unknown status ${JSON.stringify(card.status)} — the values are "todo" and "unavailable"`,
    );
  }

  // 10 (with 2, and now 14) — every card is covered by exactly one branch.
  if (todo) {
    if (built(card.href)) {
      out.push(
        `marked status:"todo" while ${APP}${card.href}/page.tsx exists — a ` +
          `"Not set up yet" card over a working screen hides finished work from ` +
          `the operator; drop the flag, or use status:"unavailable" if the screen ` +
          `is built and its TABLE is what is missing`,
      );
    }
  } else if (unavailable) {
    // 14 — the exact INVERSE of 10, which is why the two cannot share a flag.
    // `unavailable` claims the screen is BUILT and only its schema is absent, so
    // a missing page.tsx means the card is really a `todo` wearing the wrong
    // label — and it would be reported as "built" on a hub, which is the
    // opposite of the truth.
    if (!built(card.href)) {
      out.push(
        `marked status:"unavailable" but ${APP}${card.href}/page.tsx does not ` +
          `exist — "unavailable" means built-with-no-table; an unbuilt screen is ` +
          `status:"todo"`,
      );
    }
    // A greyed tile with no reason is the silent failure the state exists to
    // end: the operator sees a dead card and cannot tell it from a bug.
    if (!card.unavailableNote?.trim()) {
      out.push(
        `status:"unavailable" with no unavailableNote — the card would grey out ` +
          `with nothing saying why`,
      );
    }
  } else if (!built(card.href)) {
    out.push(`leaf route missing`);
  }

  if (!unavailable && card.unavailableNote) {
    out.push(
      `unavailableNote on a card that is not status:"unavailable" — nothing ` +
        `renders it, so it reads as a live explanation and is not one`,
    );
  }

  // 11 — the ↗ means "another module owns this", both ways round.
  //
  // AN IDLE CARD IS EXEMPT FROM THE SECOND HALF, because it has no href to
  // follow: `group-hub.tsx` renders `href: null` for both `todo` and
  // `unavailable`, so the tile does not navigate at all. The rule it would
  // otherwise fail is a promise about where a CLICK lands, and there is no
  // click. Demanding the glyph anyway is unsatisfiable, since the next branch
  // down rejects `external` on an idle card for exactly that reason — the two
  // rules would together forbid ever naming a cross-module screen that cannot
  // open, which is Order Setup ▸ Fabric Plan / Budgeting (both built, both over
  // tables 0332 dropped, both listed so the client's six-step flow is visible).
  //
  // The FIRST half stays live for idle cards and is not weakened: `external`
  // set on one is still an error, from the branch below.
  if (card.external === true && inModule(moduleHref, card.href)) {
    out.push(
      `external: true but the route is inside ${moduleHref} — the ↗ promises a ` +
        `link out of the module`,
    );
  } else if (card.external !== true && !inModule(moduleHref, card.href) && !todo && !unavailable) {
    out.push(
      `leaves ${moduleHref} without external: true — the operator lands in ` +
        `another module with the sidebar moving under them and no glyph saying so`,
    );
  }

  // 13's other half — flags that contradict a card nobody can use. Both idle
  // states render inert with no glyph and no number, so either flag beside them
  // is dead config that reads as live.
  if (todo && card.external) {
    out.push(`status:"todo" with external: true — an unbuilt card is not a link out`);
  }
  if (unavailable && card.external) {
    out.push(
      `status:"unavailable" with external: true — the card does not navigate at ` +
        `all, so the ↗ points nowhere`,
    );
  }
  if (todo && card.countKey) {
    out.push(`status:"todo" with a countKey — an unbuilt card shows no count`);
  }
  if (unavailable && card.countKey) {
    out.push(
      `status:"unavailable" with a countKey — the table is absent, so the only ` +
        `number it could show is the 0 this state exists to suppress`,
    );
  }

  // 12 — a key nothing counts renders a card that is silently short a number.
  if (card.countKey && !todo) {
    if (countKeys === null) {
      out.push(
        `countKey ${JSON.stringify(card.countKey)} but no count-key table could be ` +
          `loaded — see the loader above`,
      );
    } else if (!countKeys.has(card.countKey)) {
      out.push(`countKey ${JSON.stringify(card.countKey)} resolves to nothing`);
    }
  }

  return out;
}

/**
 * Assertion 13 — an unbuilt child must not reach the command palette. Pure for
 * the same reason as `cardIssues`; the caller passes the hrefs `moduleLeafItems`
 * actually returned.
 */
function todoInSearch(
  children: readonly Card[],
  searchable: ReadonlySet<string>,
): string[] {
  return children
    .filter((c) => c.status === "todo" && searchable.has(c.href))
    .map((c) => c.href);
}

// --------------------------------------------------------- count-key loading
// W2 owns the count source. It must be reachable from a file that node can type
// -strip — no `@/` alias, no supabase client, no lucide — so the key table lives
// on its own; `hub-counts.ts` is tried second in case the query code can stay
// behind a type-only boundary. A module that throws on import (a runtime
// dependency crept in) is reported as "not loadable", not as "no keys": the
// difference is what stops a broken import from silently disabling assertion 12.
const COUNT_KEY_SOURCES = [
  // W2 landed the map here, keyed by the card's own HREF rather than a
  // `countKey` on the child — one place to state one fact. The two speculative
  // names below are kept only so a rename does not silently disable the checks;
  // "not loadable" and "no keys" must stay distinguishable.
  "../lib/nav/hub-count-map.ts",
  "../lib/nav/hub-count-keys.ts",
  "../lib/nav/hub-counts.ts",
];
const COUNT_KEY_EXPORTS = [
  "HUB_COUNT_TABLES",
  "HUB_COUNT_KEYS",
  "COUNT_KEYS",
  "HUB_COUNTS",
  "COUNT_SOURCES",
];

function keysOf(value: unknown): Set<string> | null {
  if (value instanceof Set) return new Set([...value].map(String));
  if (Array.isArray(value)) return new Set(value.map(String));
  if (value && typeof value === "object") return new Set(Object.keys(value));
  return null;
}

/** The href → table map itself, for assertion 15. `null` values are kept: they
 *  are the declared "deliberately not counted", and telling them apart from an
 *  absent key is the whole point of the rule below. */
async function loadCountTables(): Promise<Record<string, unknown> | null> {
  for (const spec of COUNT_KEY_SOURCES) {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(spec)) as Record<string, unknown>;
    } catch {
      continue; // absent, or not loadable under type stripping
    }
    for (const name of COUNT_KEY_EXPORTS) {
      const v = mod[name];
      if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Set)) {
        return v as Record<string, unknown>;
      }
    }
  }
  return null;
}

const COUNT_TABLES = await loadCountTables();
const COUNT_KEYS = COUNT_TABLES ? keysOf(COUNT_TABLES) : null;

// ---------------------------------------------------------------- 1, 2, 4, 5
for (const [moduleHref, grouping] of Object.entries(MODULE_GROUPS)) {
  const groups = grouping.entries.filter(
    (e): e is ModuleGroup => e.kind === "group",
  );

  for (const g of groups) {
    const groupHref = `${moduleHref}/${g.slug}`;

    // 1 — the hub page exists
    if (!routeExists(groupHref)) fail(`${groupHref} — no hub page.tsx`);

    // and the registry can resolve it (what GroupHub calls)
    if (!findGroup(moduleHref, g.slug)) fail(`${groupHref} — findGroup returned null`);

    if (g.children.length === 0) fail(`${groupHref} — group with no children`);

    for (const c of g.children) {
      // 2 and 10-12 — the route exists unless the card says it does not, the ↗
      // is honest, and a countKey resolves. One call, because "the route must
      // exist" and "a todo card's route must NOT exist" are the same rule read
      // from either end and splitting them is how one becomes an escape hatch
      // from the other.
      for (const issue of cardIssues(moduleHref, c as Card, routeExists, COUNT_KEYS)) {
        fail(`${c.href} — ${issue} (in ${groupHref})`);
      }

      // 4 — a leaf MAY be the module root: it is a card on a hub page, not a
      // second sidebar row, and a sub-module that omits the screen its own work
      // starts on sends the operator hunting (Orders ▸ Order Entry without
      // "Garment Orders", client 2026-08-08). The rule it looks like it breaks —
      // "no row duplicates its module root" — is about ROWS, and is still
      // enforced below for links and by assertion 3 for every row.
      //
      // 5 — the leaf resolves back to its own group row. The module root is the
      // exception: it must keep resolving to the MODULE, or visiting /orders
      // would highlight Order Entry and `sidebar.tsx` would un-highlight the
      // Orders row (see the guard in `owningNavHref`).
      // A CROSS-MODULE CARD NEEDS NO EXEMPTION HERE, and one was written and
      // then deleted on 2026-08-14 — worth recording, because it looks like it
      // should. `owningNavHref` considers each child by its OWN href, so
      // Order Setup listing `/planning/fabric-bom` makes that path resolve to
      // `/orders/setup` and assertion 5 is satisfied without help. The skip that
      // was added "so the other module's rows can own it" changed no outcome:
      // removing it again left the check passing, which is how it was caught.
      // An exemption that guards nothing still weakens the rule for every future
      // card that hits it.
      const owner = owningNavHref(moduleHref, c.href);
      // The module root is tested FIRST and is the one child legitimately owned
      // by no row in this table — the MODULE row owns it, which `owningNavHref`
      // signals by returning undefined. Testing `cardOnly` ahead of it flagged
      // /orders on the restored Garment Orders hub, where both are true.
      if (c.href === moduleHref) {
        if (owner !== undefined) {
          fail(
            `${moduleHref} — listed as a card of ${groupHref} and resolving to ` +
              `${owner}; the module root must resolve to its own row, not a sub-module`,
          );
        }
      } else if (c.cardOnly) {
        // A card whose ROW lives in another group — every child of the restored
        // Garment Orders hub. It must NOT resolve to this group, or the operator
        // clicking through would land on the screen with the wrong sub-module
        // lit; and it must still resolve to SOMETHING, or listing it here has
        // orphaned it from the sidebar altogether.
        if (owner === groupHref) {
          fail(
            `${c.href} — declared cardOnly in ${groupHref} but still resolves there; ` +
              `owningNavHref must skip it so its real row keeps the route`,
          );
        } else if (owner === undefined) {
          fail(
            `${c.href} — cardOnly in ${groupHref} and owned by no row at all; ` +
              `give it a real row in some group, or drop the cardOnly flag`,
          );
        }
      } else if (owner !== groupHref) {
        fail(`${c.href} — resolves to ${owner ?? "nothing"}, expected ${groupHref}`);
      }
    }
  }

  // 4 — a standalone link must not be the module root either
  for (const e of grouping.entries) {
    if (e.kind === "link") {
      if (e.href === moduleHref) fail(`${e.href} — sidebar row duplicates its module root`);
      if (!routeExists(e.href)) fail(`${e.href} — standalone route missing`);
      if (owningNavHref(moduleHref, e.href) !== e.href) {
        fail(`${e.href} — standalone does not resolve to itself`);
      }
    }
  }

  // ------------------------------------------------------------------------ 3
  // No row may be a path beneath another row in the same module. This is the
  // reported conflict, stated as an assertion: /purchase/indents/approval was a
  // sibling of /purchase/indents, and /production listed itself.
  const rows = (moduleNavChildren(moduleHref) ?? []).map((c) => c.href);
  for (const a of rows) {
    for (const b of rows) {
      if (a !== b && a.startsWith(b + "/")) {
        fail(`${a} sits beside its own parent ${b} in the ${moduleHref} sidebar`);
      }
    }
    if (a === moduleHref) fail(`${moduleHref} lists itself as a child row`);
  }
}

// ------------------------------------------------------------------------- 6
// Every destination the old flat nav reached is still reachable. Listed
// verbatim from `git show HEAD:components/shell/nav.ts` rather than derived, so
// this cannot drift with the file it is checking.
const OLD_NAV_LEAVES: Record<string, string[]> = {
  "/orders": [
    "/orders/garment-orders", "/orders/order-booking", "/orders/due-date-confirmations",
    "/orders/contract-review", "/orders/pack-ratios", "/orders/excess-orders",
    "/orders/price-confirmation", "/orders/ta",
  ],
  "/planning": [
    "/planning/fabric-bom", "/planning/garment-bom", "/planning/material-bom",
    "/planning/accessory-bom", "/planning/bom-shortage", "/planning/bom-transfer",
    "/planning/budgets", "/planning/garment-ppm", "/planning/processing-ppm",
    "/planning/purchase-ppm", "/planning/ppm-cancel", "/planning/ppm-completion",
    "/planning/garment-ppm-cancel", "/planning/material-excess-plan",
    "/planning/material-rate", "/planning/fabric-order", "/planning/fabric-consumption",
    "/planning/excess-order", "/planning/capacity-planning", "/planning/production-planning",
  ],
  "/purchase": [
    "/purchase/orders", "/purchase/rfq", "/purchase/grn", "/purchase/dc",
    "/purchase/vendors", "/purchase/indents", "/purchase/indents/approval",
    "/purchase/over-budget", "/purchase/rate-amendments", "/purchase/po-cancellations",
    "/purchase/price-confirmations", "/purchase/completions", "/purchase/lab",
  ],
  "/stores": [
    "/stores/opening-stock", "/stores/requisitions", "/stores/vendor-returns",
    "/stores/csp-receipts", "/stores/process-orders", "/stores/process-issues",
    "/stores/process-receipts", "/stores/transfers", "/stores/adjustments",
    "/stores/interdept",
  ],
  "/production": [
    "/production/job-orders", "/production/masters", "/production/piece-rates",
    "/production/packing-lists", "/production/inspections", "/production/despatch",
  ],
  "/hr": [
    "/hr/workers", "/hr/staff", "/hr/contractors", "/hr/attendance",
    "/hr/piece-records", "/hr/payroll", "/hr/payslip", "/hr/settings",
    "/hr/advances", "/hr/adjustments", "/hr/comp-events", "/hr/leave",
    "/hr/lifecycle", "/hr/statutory",
  ],
  "/logistics": [
    "/logistics/proforma", "/logistics/lc", "/logistics/epcg",
    "/logistics/export-categories", "/logistics/order-categories", "/logistics/incentives",
  ],
  "/finance": [
    "/finance/accounts", "/finance/cost-centres", "/finance/cost-heads",
    "/finance/bank-limits", "/finance/payables", "/finance/receivables",
    "/finance/ledger", "/finance/notes", "/finance/cheques", "/finance/forward-contracts",
    "/finance/other-entries", "/finance/party-openings", "/finance/exchange-rates",
    "/finance/provisional-invoices", "/finance/bank-journals",
    "/finance/domestic-invoices", "/finance/pnl",
  ],
  "/admin": [
    "/admin/company", "/admin/users", "/admin/roles", "/admin/audit",
    "/admin/divisions", "/admin/document-no-formats", "/admin/assets", "/admin/couriers",
  ],
};

// Old nav destinations that intentionally no longer have a sidebar row of their
// own, each kept as a redirect. Declared rather than deleted from the list
// above, so assertion 6 stays a real check: quietly dropping an entry is how a
// genuinely orphaned screen would get through next time. The redirect itself is
// asserted below, not assumed.
// `/orders/garment-orders` lived here while it was a redirect. It is a real
// sub-module hub again (restored on request, 2026-08-08), so it is reachable
// through MODULE_GROUPS and never consults this table — an entry for it now
// would be dead weight that reads as a live rule.
const REDIRECTED: Record<string, string> = {
  // Document No Format is the legacy Configure ▸ System screen, filed under
  // Administration by the 2026-07-18 dissolution of that submodule and moved
  // back when System was restored (client 2026-08-12). The Admin row is gone —
  // MOVED, not copied, because two sidebar rows opening one page is what this
  // check exists to catch — so the old URL answers as a redirect.
  //
  // The target is in ANOTHER module, which is new for this table: it resolves
  // through `lib/masters/submodules.ts`, not MODULE_GROUPS, so nothing above
  // can confirm it. What is still asserted below is the pair — the page exists
  // and it really does `redirect("…")` to exactly this string.
  "/admin/document-no-formats": "/masters/system/document-no-format",
  // Material BOM was never an amendment screen — one door, and the revision
  // case is `bomStatus`'s `recalculate` state in place. The URL was named after
  // `material_bom_amendments` (0265), which took ITS name from the legacy
  // RP-Software screen, so the route was naming the storage rather than the
  // work. Renamed on the client's report, 2026-08-19; the old URL redirects so
  // no bookmark breaks.
  //
  // ASSERTION 6 DOES NOT REACH THIS ENTRY and 6a is why it now exists: the route
  // post-dates the old flat nav, so it is not in OLD_NAV_LEAVES, so the pairing
  // below was never tested. Found by BREAKING it — the target was pointed at
  // /orders/amendments and the check still said OK.
  "/orders/material-bom-amendment": "/orders/material-bom",
  // The Amendments sub-module row was removed (request, 2026-09-04: "remove
  // the amendment child from order module"). `/orders/changes` was that
  // group's own hub route — never a screen in its own right — and with the
  // group gone from MODULE_GROUPS there is nothing left for `GroupHub` to
  // render there. Its three children (Order Amendment, Process Amendment,
  // Approve Amendment) keep their own routes unchanged, now under `retired`.
  "/orders/changes": "/orders/retired",
};

for (const [moduleHref, leaves] of Object.entries(OLD_NAV_LEAVES)) {
  const grouping = MODULE_GROUPS[moduleHref];
  if (!grouping) {
    fail(`${moduleHref} — was regrouped but is absent from MODULE_GROUPS`);
    continue;
  }
  const reachable = new Set<string>();
  for (const e of grouping.entries) {
    if (e.kind === "link") reachable.add(e.href);
    else {
      reachable.add(`${moduleHref}/${e.slug}`);
      for (const c of e.children) reachable.add(c.href);
    }
  }
  for (const leaf of leaves) {
    if (reachable.has(leaf)) continue;

    const target = REDIRECTED[leaf];
    if (!target) {
      fail(`${leaf} — reachable from the old nav, orphaned by the regrouping`);
      continue;
    }
    if (!routeExists(leaf)) {
      fail(`${leaf} — declared as redirecting to ${target}, but the page is gone`);
    } else if (!readFileSync(`${APP}${leaf}/page.tsx`, "utf8").includes(`redirect("${target}")`)) {
      fail(`${leaf} — declared as redirecting to ${target}, but does not`);
    }
  }
}

// ------------------------------------------------------------------------ 6a
// EVERY `REDIRECTED` ENTRY IS A LIVE PAIR, whether or not the old nav reached it.
//
// Assertion 6 checks the pair only for a key it happens to walk past — one that
// is in OLD_NAV_LEAVES. That list is a VERBATIM snapshot of `git show
// HEAD:components/shell/nav.ts` and must stay one, so a route renamed after the
// regrouping can never appear in it, and its entry in the table above was
// asserting nothing while reading exactly like a rule that was.
//
// That is the failure this repo keeps meeting from the other side: a check that
// prints the same "OK" whether it inspected the thing or returned before
// reaching it. Verified by breaking it first — with the loop below in place, a
// wrong target reports "declared as redirecting to X, but does not".
//
// THE TARGET IS DELIBERATELY NOT ASSERTED, and that was tried first. A
// `routeExists(to)` here fails on `/masters/system/document-no-format`, which is
// correct and live — it is served by the DYNAMIC `/masters/[submodule]/[entity]`
// route, so there is no folder to find. A check that reports a working redirect
// as broken teaches people to ignore it, which costs more than the case it
// would catch. What the pair below does assert is the half that can be known
// from this file.
for (const [from, to] of Object.entries(REDIRECTED)) {
  if (!routeExists(from)) {
    fail(`${from} — declared as redirecting to ${to}, but the page is gone`);
  } else if (!readFileSync(`${APP}${from}/page.tsx`, "utf8").includes(`redirect("${to}")`)) {
    fail(`${from} — declared as redirecting to ${to}, but does not`);
  }
}

// ------------------------------------------------------------------------- 7
// Every screen a group hides from the sidebar is still offered to nav search.
// `searchNav` itself cannot be imported here (it pulls in lucide and the `@/`
// alias, neither of which survives type stripping), so this asserts the data it
// consumes: the leaf is in `moduleLeafItems`, tagged with its group.
for (const [moduleHref, grouping] of Object.entries(MODULE_GROUPS)) {
  const searchable = new Map(moduleLeafItems(moduleHref).map((l) => [l.href, l]));
  for (const e of grouping.entries) {
    if (e.kind !== "group") continue;

    // ---------------------------------------------------------------------- 13
    // The mirror of the rule below, and the reason it is not simply "everything
    // is findable": an unbuilt child in the palette is a search result that
    // 404s, and assertion 7 would report it as correctly findable.
    for (const href of todoInSearch(e.children as Card[], new Set(searchable.keys()))) {
      fail(
        `${href} — status:"todo" but offered to nav search; an unbuilt screen in ` +
          `the command palette is a result that 404s (filter it out of moduleLeafItems)`,
      );
    }

    for (const c of e.children) {
      // Neither idle state belongs in search, and assertion 13 above has
      // already required their ABSENCE — so skipping them here is not a gap,
      // it is the other half of one rule. `todo` has no screen to find.
      // `unavailable` has one that RESOLVES, which is why it must be skipped
      // explicitly rather than left to the route check: the palette result
      // would not 404, it would land the operator on a clean empty table that
      // cannot save, and assertion 7 would have called that "findable".
      if ((c as Card).status !== undefined) continue;
      // A cardOnly child reaches search from its OWNING group, so it is absent
      // from this one by design. `searchable` is keyed by href, so counting it
      // here would report a groupLabel mismatch on whichever copy lost the map.
      if (c.cardOnly) continue;
      const hit = searchable.get(c.href);
      if (!hit) fail(`${c.href} — hidden by grouping and absent from nav search`);
      else if (hit.groupLabel !== e.label) {
        fail(`${c.href} — search says group "${hit.groupLabel}", registry says "${e.label}"`);
      }
    }
  }
}

// ------------------------------------------------------------------------- 8
// A leaf is a SCREEN. The bug this catches is the one the whole regrouping was
// meant to end, one level down: `/orders/garment-orders` sat in the registry
// described as "Create and track garment orders through their lifecycle" while
// the file was a 14-card `HubCard` grid duplicating `/orders`. Assertion 2 saw a
// route that exists and said nothing. A hub renders `HubCard` or `GroupHub`; a
// screen does not, so the import is the test.
//
// `/masters` runs its own hub scheme and is deliberately absent from
// MODULE_GROUPS, so nothing legitimate is in scope here.
for (const [moduleHref, grouping] of Object.entries(MODULE_GROUPS)) {
  // Hubs this module has DECLARED. A card may point at one of these — that is a
  // sub-module nested a level deeper, which is hierarchy, not the bug. The bug
  // is a card grid nobody registered: unreachable from the sidebar, invisible to
  // search, and free to duplicate its own parent. So the test is no longer
  // "renders cards" but "renders cards WITHOUT being a declared group".
  const declaredHubs = new Set(
    grouping.entries
      .filter((e): e is ModuleGroup => e.kind === "group")
      .map((e) => `${moduleHref}/${e.slug}`),
  );

  for (const e of grouping.entries) {
    const groupHref = e.kind === "group" ? `${moduleHref}/${e.slug}` : null;
    const children = e.kind === "group" ? e.children : [e];
    for (const c of children) {
      const href = c.href;
      if (!routeExists(href)) continue; // already reported by assertion 2
      const src = readFileSync(`${APP}${href}/page.tsx`, "utf8");
      // `HubPage` is in this list for the reason the list exists at all: it is
      // the shared renderer's caller-supplied-cards entry point (the one
      // `/masters` and the two Sales hubs use), so a leaf importing it renders a
      // card grid exactly as `HubCard` does. Adding the vocabulary without
      // adding the marker would have opened a new door into the bug assertion 8
      // was written for.
      const renders = ["GroupHub", "HubPage", "HubCard"].find((x) =>
        new RegExp(`import\\s[^;]*\\b${x}\\b[^;]*from`).test(src),
      );
      if (!renders) continue;

      // The carve-out, and it is narrow on purpose. A hub-to-hub link must be
      // DECLARED (a registered group of this module), must be marked cardOnly
      // (so the nested hub keeps its own sidebar row and its screens keep their
      // owners), and must not point at itself — a card opening the page it is
      // printed on is the loop the 08-07 regrouping was reported for.
      if (declaredHubs.has(href) && "cardOnly" in c && c.cardOnly) {
        if (href === groupHref) {
          fail(`${href} — a hub carries a card pointing at itself`);
        }
        continue;
      }

      fail(
        `${href} — registered as a leaf of ${moduleHref} but renders ${renders}: ` +
          `it is a hub, so clicking through lands on another card list. ` +
          `Promote its children to sub-modules instead, or — if it really is a ` +
          `nested sub-module — register it as a group and mark the card cardOnly.`,
      );
    }
  }
}

// ------------------------------------------------------------------------- 9
// Hub-to-hub links must not form a CYCLE. Assertion 8 now permits a card to open
// another registered hub, and self-links are caught there; this catches the
// longer loop (A cards to B, B cards back to A), which would walk an operator in
// a circle exactly as `/orders/garment-orders` → `/orders` → its own card list
// once did. Cheap to assert, and impossible to spot by reading the registry.
for (const [moduleHref, grouping] of Object.entries(MODULE_GROUPS)) {
  const groups = grouping.entries.filter((e): e is ModuleGroup => e.kind === "group");
  const edges = new Map<string, string[]>(
    groups.map((g) => {
      const self = `${moduleHref}/${g.slug}`;
      const hubs = new Set(groups.map((x) => `${moduleHref}/${x.slug}`));
      return [self, g.children.map((c) => c.href).filter((h) => hubs.has(h))];
    }),
  );

  const state = new Map<string, "open" | "done">();
  const walk = (node: string, trail: string[]) => {
    if (state.get(node) === "done") return;
    if (state.get(node) === "open") {
      fail(`hub cycle in ${moduleHref}: ${[...trail, node].join(" → ")}`);
      return;
    }
    state.set(node, "open");
    for (const next of edges.get(node) ?? []) walk(next, [...trail, node]);
    state.set(node, "done");
  };
  for (const node of edges.keys()) walk(node, []);
}

// ------------------------------------------------------------- SELF-TEST
// Proof that 10-13 fire. Every case states the WRONG card and its corrected
// twin, and both halves are asserted: the wrong one must produce an issue
// matching `expect`, the right one must produce none. Without the second half a
// rule that flagged every card would pass its own test.
//
// This runs on every invocation rather than behind a flag, deliberately. The
// alternative — break the registry by hand, watch it fail, revert — proves the
// rule for one afternoon and leaves nothing behind; 0386 shipped a check that
// reported success while doing nothing, and it had been "verified" that way.
const SELF_TEST: {
  name: string;
  module: string;
  wrong: Card;
  right: Card;
  built: string[];
  keys: string[];
  expect: RegExp;
}[] = [
  {
    name: "10 · todo over a route that exists",
    module: "/orders",
    wrong: { href: "/orders/styles", label: "Style", description: "d", status: "todo" },
    right: { href: "/orders/not-built", label: "Style", description: "d", status: "todo" },
    built: ["/orders/styles"],
    keys: [],
    expect: /marked status:"todo" while .* exists/,
  },
  {
    // 14 is 10 read backwards, and that is exactly why it needs its own proof:
    // one flag could never carry both facts, so a rule that fired on either
    // would mean the two states had quietly collapsed back into one.
    name: "14 · unavailable over a route that does NOT exist",
    module: "/orders",
    wrong: {
      href: "/orders/ghost",
      label: "Ghost",
      description: "d",
      status: "unavailable",
      unavailableNote: "n",
    },
    right: {
      href: "/orders/styles",
      label: "Style",
      description: "d",
      status: "unavailable",
      unavailableNote: "n",
    },
    built: ["/orders/styles"],
    keys: [],
    expect: /marked status:"unavailable" but .* does not exist/,
  },
  {
    name: "14 · unavailable with no reason given",
    module: "/orders",
    wrong: { href: "/orders/styles", label: "Style", description: "d", status: "unavailable" },
    right: {
      href: "/orders/styles",
      label: "Style",
      description: "d",
      status: "unavailable",
      unavailableNote: "Tables are not in this database",
    },
    built: ["/orders/styles"],
    keys: [],
    expect: /no unavailableNote/,
  },
  {
    name: "14 · a reason on a card that is not unavailable",
    module: "/orders",
    wrong: {
      href: "/orders/styles",
      label: "Style",
      description: "d",
      unavailableNote: "stale explanation nothing renders",
    },
    right: { href: "/orders/styles", label: "Style", description: "d" },
    built: ["/orders/styles"],
    keys: [],
    expect: /unavailableNote on a card that is not/,
  },
  {
    name: "2 · unmarked card over a route that does not exist",
    module: "/orders",
    wrong: { href: "/orders/ghost", label: "Ghost", description: "d" },
    right: { href: "/orders/styles", label: "Style", description: "d" },
    built: ["/orders/styles"],
    keys: [],
    expect: /leaf route missing/,
  },
  {
    name: "11 · external on a route inside the module",
    module: "/orders",
    wrong: { href: "/orders/styles", label: "Style", description: "d", external: true },
    right: { href: "/orders/styles", label: "Style", description: "d" },
    built: ["/orders/styles"],
    keys: [],
    expect: /external: true but the route is inside/,
  },
  {
    name: "11 · a card leaving the module with no ↗",
    module: "/orders",
    wrong: { href: "/finance/ledger", label: "Ledger", description: "d" },
    right: { href: "/finance/ledger", label: "Ledger", description: "d", external: true },
    built: ["/finance/ledger"],
    keys: [],
    expect: /leaves \/orders without external: true/,
  },
  {
    // THE EXEMPTION ADDED WITH ORDER SETUP'S SIX STEPS, proved from both ends —
    // which for a RELAXED rule is the half that matters. `right` asserts the
    // exemption exists at all (a cross-module card that cannot open needs no
    // ↗), and `wrong` asserts it did not swallow the neighbouring rule with it
    // (setting the glyph on an inert card is still an error). The fixture above
    // is the third side: a cross-module card that CAN open still fails without
    // the glyph, so the relaxation reaches only the idle states.
    name: "11 · an inert cross-module card needs no ↗, and must not carry one",
    module: "/orders",
    wrong: {
      href: "/planning/budgets",
      label: "Budgeting",
      description: "d",
      status: "unavailable",
      unavailableNote: "n",
      external: true,
    },
    right: {
      href: "/planning/budgets",
      label: "Budgeting",
      description: "d",
      status: "unavailable",
      unavailableNote: "n",
    },
    built: ["/planning/budgets"],
    keys: [],
    expect: /status:"unavailable" with external: true/,
  },
  {
    name: "12 · a countKey nothing counts",
    module: "/orders",
    wrong: { href: "/orders/styles", label: "Style", description: "d", countKey: "stylez" },
    right: { href: "/orders/styles", label: "Style", description: "d", countKey: "styles" },
    built: ["/orders/styles"],
    keys: ["styles"],
    expect: /countKey "stylez" resolves to nothing/,
  },
  {
    name: "13 · todo carrying flags that contradict it",
    module: "/orders",
    wrong: { href: "/orders/ghost", label: "G", description: "d", status: "todo", countKey: "styles" },
    right: { href: "/orders/ghost", label: "G", description: "d", status: "todo" },
    built: [],
    keys: ["styles"],
    expect: /status:"todo" with a countKey/,
  },
  {
    name: "status typo'd to something the renderer ignores",
    module: "/orders",
    wrong: { href: "/orders/ghost", label: "G", description: "d", status: "toto" as "todo" },
    right: { href: "/orders/ghost", label: "G", description: "d", status: "todo" },
    built: [],
    keys: [],
    expect: /unknown status/,
  },
];

let selfTested = 0;
for (const t of SELF_TEST) {
  const built = (h: string) => t.built.includes(h);
  const keys = new Set(t.keys);
  const wrong = cardIssues(t.module, t.wrong, built, keys);
  const right = cardIssues(t.module, t.right, built, keys);
  if (!wrong.some((m) => t.expect.test(m))) {
    fail(`SELF-TEST ${t.name} — the rule did not fire (got: ${JSON.stringify(wrong)})`);
  } else if (right.length) {
    fail(`SELF-TEST ${t.name} — the CORRECT card was flagged: ${JSON.stringify(right)}`);
  } else {
    selfTested++;
  }
}

// 13's search half, same two-sided shape.
{
  const children: Card[] = [
    { href: "/orders/ghost", label: "G", description: "d", status: "todo" },
    { href: "/orders/styles", label: "Style", description: "d" },
  ];
  const offered = todoInSearch(children, new Set(["/orders/ghost", "/orders/styles"]));
  const clean = todoInSearch(children, new Set(["/orders/styles"]));
  if (!offered.includes("/orders/ghost")) {
    fail("SELF-TEST 13 · todo in search — the rule did not fire");
  } else if (clean.length) {
    fail(`SELF-TEST 13 · todo in search — flagged a correct list: ${JSON.stringify(clean)}`);
  } else {
    selfTested++;
  }
}

// ------------------------------------------------------------------------ 15
// AN `unavailable` CARD MUST NOT NAME A TABLE TO COUNT. The counts key on the
// card's own href, so a dead screen left in `hub-count-map.ts` is a live query
// against a table that does not exist — and one of them was worse than that:
// `/planning/excess-order` was mapped to `excess_orders`, which EXISTS, because
// it is ORDERS' table (0328). The Planning card would have shown Orders' row
// count. Not a missing number, a confident wrong one, on a screen that cannot
// open. `null` in the map is the declared "deliberately not counted" and is
// what these must be — an absent key would pass too, but `null` is where the
// reason gets written down so nobody "fixes" the omission later.
if (COUNT_TABLES === null) {
  fail(`no count-table map could be loaded — assertion 15 cannot run`);
} else {
  for (const [moduleHref, grouping] of Object.entries(MODULE_GROUPS)) {
    for (const e of grouping.entries) {
      if (e.kind !== "group") continue;
      for (const c of e.children as Card[]) {
        if (c.status !== "unavailable") continue;
        const t = COUNT_TABLES[c.href];
        if (t != null) {
          fail(
            `${c.href} — status:"unavailable" but hub-count-map names ` +
              `${JSON.stringify(t)}; a card that cannot open must count nothing ` +
              `(set it to null, with the reason, in ${moduleHref})`,
          );
        }
      }
    }
  }
}

// --------------------------------------------------------------------------
const groupCount = Object.values(MODULE_GROUPS).reduce(
  (n, g) => n + g.entries.filter((e) => e.kind === "group").length,
  0,
);
const leafCount = Object.values(MODULE_GROUPS).reduce(
  (n, g) =>
    n +
    g.entries.reduce((m, e) => m + (e.kind === "group" ? e.children.length : 1), 0),
  0,
);

if (failures) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log(
  `OK — ${Object.keys(MODULE_GROUPS).length} modules, ${groupCount} groups, ` +
    `${leafCount} screens; ${selfTested} vocabulary self-tests fired, ` +
    `count keys: ${COUNT_KEYS ? COUNT_KEYS.size : "no table loaded"}.`,
);
