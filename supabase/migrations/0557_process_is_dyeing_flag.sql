-- ============================================================================
-- Raagam ERP — 0557 Process master ▸ `is_dyeing` flag.
--
-- doc/order/update.md §7.3 ("Yarn-Dyed Workflow Trigger") asks that when a
-- fabric's BOM-level Yarn-Dyed flag is set, the system "skip the standard
-- Fabric Dyeing stage logic" when offering that fabric's Fabric Process route
-- (`lib/orders/fabric-bom/processes.ts`, 0492). Nothing on the Process master
-- distinguishes a Dyeing process from any other — 0227's five `for_*` flags
-- say WHERE a process may appear, not WHAT KIND of step it is, exactly the gap
-- 0528 already named and closed once for `is_print` ("nothing on the master
-- distinguishes a print process from any other ... nothing for the Fabric
-- Process picker to test today").
--
-- SAME SHAPE AS `is_print` (0528), DELIBERATELY — one process-master flag,
-- seeded once from the master's own data, an operator-maintained checkbox
-- from here on, never re-derived from the name at read time. A name-match
-- heuristic at READ time was rejected there for a reason that applies
-- identically here: "DYE"/"DYEING" also appears in Yarn Dyeing, Trims Dyeing
-- and Garment Dyeing process names this flag must NOT catch — those are
-- different stages, gated by `for_yarn`/`for_trims`/`for_garments`, not
-- `for_fabric`. Seeding scoped to `for_fabric = true` is what keeps this flag
-- meaning "a FABRIC-stage dyeing step", not "any process with DYE in its
-- name".
-- ============================================================================

alter table public.processes
  add column if not exists is_dyeing boolean not null default false;

comment on column public.processes.is_dyeing is
  'This process represents a FABRIC-STAGE Dyeing step. Read by the Fabric '
  'BOM ▸ Fabric Process picker (0557) to withhold Dyeing from a Yarn-Dyed '
  'fabric''s offered route, the same way is_print (0528) withholds Print '
  'until an AOP/Roll form print is declared. Seeded once from for_fabric '
  'processes already named DYE/DYEING; an operator-maintained checkbox from '
  'here on, never re-derived from the name at read time.';

update public.processes
  set is_dyeing = true
  where is_dyeing = false
    and for_fabric = true
    and name ilike '%dye%';
