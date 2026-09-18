-- ============================================================================
-- 0570 — THE FOUR ROUTING CHAINS THAT COULD NOT BE ENTERED
--
-- Client spec, 2026-09-18 ("Process Master Logic & Fabric/Yarn Routing Rules",
-- §1 base stages and §3's five standard chains), which restates and sharpens
-- doc/order/fabriprocess.md §3.
--
-- ## WHAT WAS WRONG, MEASURED ON THE LIVE MASTER RATHER THAN ASSUMED
--
-- 0563 built the stage→process rule and seeded it by matching the master's own
-- process NAMES. It applied on 2026-09-16 and produced 11 pairings — and four
-- of its fifteen declared patterns matched nothing at all, silently, because
-- **the processes they name do not exist in this database**:
--
--     washing · printing · %dip%wash% · %gum%cutting%
--
-- The live master carries 17 processes, 7 of them `for_fabric`: COMPACTING
-- [OPEN WIDTH], COMPACTING [TUBULAR], DYEING, FABRIC PURCHASE, HEAT SETTING,
-- KNITTING, STENTERING. (0294's 438-row legacy import is NOT in this database,
-- whatever a note elsewhere implies — check the master, never the note.)
--
-- So WASH and PRINT each had secondary steps classified and **no base process
-- whatsoever**, and the consequence is not subtle: of the client's five
-- standard chains only #1 (Solid / Piece-Dyed) could be entered. #2 and #4 need
-- PRINTING and DIP-WASH; #3 and #5 need WASHING. Four of five.
--
-- It was invisible because every layer of the rule fails OPEN by design (see
-- `lib/orders/fabric-bom/stage-routes.ts`): a stage with no pickable base
-- stands down to its ordinary list rather than refusing every process. The
-- operator therefore saw a working dropdown — and the stored routes show what
-- they did with it. One live fabric opens its WASH branch on STENTERING,
-- because there was no washing step to open it with.
--
-- ## WHY THE PROCESSES ARE CREATED HERE AND NOT LEFT TO THE OPERATOR
--
-- The client's decision (2026-09-18), asked explicitly. The alternative —
-- create them on Master Data ▸ Materials ▸ Processes by hand — is the same
-- work with one extra failure mode: the classification in §2 below keys on
-- NAME, so "WASHING " or "WASHING PROCESS" typed in the box would insert a
-- process the rule never binds to, and the stage would still have no base while
-- looking answered. Created and classified in one statement, they cannot
-- disagree.
--
-- NOTHING HERE RENAMES, RE-CODES OR DEACTIVATES AN EXISTING ROW, and every
-- insert is guarded on the master's own names — 0563's lesson, one file on:
-- **the row's code is not its meaning, and the operator owns both.**
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The five processes §3's WASH and PRINT stages are made of.
--
--    `for_fabric` ONLY. A stage is a state of CLOTH, so a process that reaches
--    a fabric route has to be a fabric process — and `for_yarn` is what keeps
--    YARN DYEING off one (0557), which is the whole reason chain #5's yarn leg
--    cannot corrupt a fabric ledger.
--
--    FLAGS ARE SET AT INSERT AND NEVER RE-DERIVED FROM THE NAME (0528's own
--    rule for `is_print`: "an operator-maintained checkbox from here on").
--    PRINTING is the only one of the five that is a print step — DIP-WASH and
--    GUM CUTTING are post-print FINISHING, so flagging them would withhold
--    them from every order that has not declared an all-over print, which is
--    precisely the order that needs them. None of the five is `is_dyeing`:
--    washing is not dyeing, and a WASH route exists because fabric dyeing was
--    SKIPPED. None is `is_knitting` — that flag drives the greige-purchase
--    demand suppression (0564) and a washing step is not a knitting step.
-- ---------------------------------------------------------------------------
insert into public.processes (name, for_fabric, is_print)
select v.name, true, v.is_print
from (values
  -- WASH stage (§3 chains 3 · 4 · 5) — melange and yarn-dyed cloth, which
  -- reaches colour without a fabric-dyeing step.
  ('WASHING',     false),
  ('BIO WASH',    false),
  -- PRINT stage (§3 chains 2 · 4) — all-over print after DYED or WASH.
  ('PRINTING',    true),
  ('DIP-WASH',    false),
  ('GUM CUTTING', false)
) as v(name, is_print)
where not exists (
  -- MATCHED ON MEANING, not on the exact string: an operator who has already
  -- typed "Washing" or "washing " must bind to their row rather than get a
  -- second one beside it. `btrim` + `ilike` is the same test §2 then uses to
  -- find these rows again.
  select 1 from public.processes p where btrim(p.name) ilike btrim(v.name)
);


-- ---------------------------------------------------------------------------
-- 2. Classify them — and FABRIC PURCHASE, which 0563 left unclassified.
--
--    THIS IS 0563'S OWN SEED, RE-RUN. Deliberately a copy rather than a
--    narrower insert for the four new pairings: the seed is `on conflict do
--    nothing` and matches by name, so re-running it is idempotent AND it now
--    also binds any process the operator has added by hand since 09-16.
--    Writing only the new rows would have left that second half undone, and
--    the difference would not show until a route needed it — the same class of
--    silence this whole migration exists to end.
--
--    FABRIC PURCHASE → GREIGE, AS A BASE, IS THE PROCUREMENT LOCK (§2 of the
--    client's spec: "Procurement requirements for raw yarn and greige fabric
--    are locked to GREY until the actual dyeing transaction is executed").
--    Unclassified, it was offered under EVERY stage — and a live route already
--    carries `[DYED] FABRIC PURCHASE`, which is greige cloth booked to the Dyed
--    ledger: the exact corruption §1 of the spec is about, in the data, today.
--    A BASE and not a secondary step, because it is how a Rule 2 route OPENS
--    (a factory buying greige rolls knits nothing), so GREIGE legitimately has
--    two entry steps — KNITTING for Rule 1, FABRIC PURCHASE for Rule 2.
--    `is_base` is per PAIRING precisely so this can be said.
--
--    A DYED-CLOTH PURCHASE IS A DIFFERENT PROCESS AND IS NOT CREATED HERE.
--    `suppressedBySource`'s third source ('dyed_purchase') describes buying
--    ready-dyed rolls, and this database has no process for it. When one is
--    added it must be classified to DYED — do NOT answer that case by widening
--    FABRIC PURCHASE to the Dyed stage, which would hand back exactly the
--    mis-tag this statement closes.
-- ---------------------------------------------------------------------------
with stages as (
  select distinct on (role) role, id
  from (
    select 'greige' as role, id, created_at from public.config_lookups
      where kind = 'fabric_stage'
        and (lower(code) in ('grey', 'greige') or upper(name) in ('GREY', 'GREIGE'))
    union all
    select 'dyed', id, created_at from public.config_lookups
      where kind = 'fabric_stage'
        and (lower(code) = 'dyed' or upper(name) = 'DYED')
    union all
    select 'washed', id, created_at from public.config_lookups
      where kind = 'fabric_stage'
        and (lower(code) like 'wash%' or upper(name) like 'WASH%')
    union all
    select 'printed', id, created_at from public.config_lookups
      where kind = 'fabric_stage'
        and (lower(code) like 'print%' or upper(name) like 'PRINT%')
  ) s
  -- Oldest row wins if two rows mean one stage. Deterministic, and it prefers
  -- the operator's own — this database's stages are `grey`→GREIGE (renamed by
  -- an operator) and hand-added WASH / PRINT with their own uppercase codes.
  order by role, created_at
),
routes(role, name_pat, is_base) as (values
  -- Greige: everything before dyeing is greige. Dyeing is refused here (§3).
  ('greige',  'knitting',        true),
  ('greige',  '%heat%setting%',  false),
  -- THE ROW 0563 DID NOT HAVE — see the header note above.
  ('greige',  'fabric purchase', true),
  -- Dyed: the base is DYEING exactly; the other fabric-dyeing variants
  -- (OVER DYEING, DYEING AFTER AOP) are secondary steps of the same stage.
  -- YARN DYEING is not here — it is for_yarn; the join below excludes it.
  ('dyed',    'dyeing',          true),
  ('dyed',    '%dyeing%',        false),
  ('dyed',    '%stentering%',    false),
  ('dyed',    'compacting%',     false),
  -- Washed: melange / yarn-dyed cloth that bypasses fabric dyeing. WASHING
  -- and BIO WASH exist as of §1 above, so these three now bind.
  ('washed',  'washing',         true),
  ('washed',  '%stentering%',    false),
  ('washed',  'compacting%',     false),
  ('washed',  '%bio%wash%',      false),
  -- Printed: all-over print, after dyeing or washing. PRINTING, DIP-WASH and
  -- GUM CUTTING exist as of §1 above.
  ('printed', 'printing',        true),
  ('printed', '%dip%wash%',      false),
  ('printed', '%gum%cutting%',   false),
  ('printed', 'compacting%',     false)
)
insert into public.process_fabric_stages (process_id, stage_id, is_base)
select p.id, s.id, bool_or(r.is_base)
from routes r
join stages s on s.role = r.role
-- `for_fabric` scoping is what keeps this table meaning "a FABRIC-stage route"
-- rather than "any process whose name contains DYE" — 0557's reasoning for
-- is_dyeing, and what keeps YARN PURCHASE and YARN DYEING out of every fabric
-- route however they are named.
join public.processes p
  on p.for_fabric = true
 and p.name ilike r.name_pat
group by p.id, s.id
on conflict (process_id, stage_id) do nothing;


-- ---------------------------------------------------------------------------
-- 3. What this does NOT do, said out loud.
--
--    NO STAGE IS CREATED OR RANKED HERE. All four of §1's base stages already
--    exist in `config_lookups` (GREIGE · DYED · WASH · PRINT), and the ORDER
--    between them — GREY(0) → DYED/WASH(1) → PRINT(2), the "irreversible state
--    transition" rule — is deliberately NOT a column: it is derived once, by
--    meaning, in `stageRank()` (`lib/orders/fabric-bom/stage-routes.ts`), so a
--    stage an operator invents tomorrow is left UNRANKED and therefore
--    unconstrained rather than silently assigned a position in a sequence
--    nobody declared. A ranked column would have to guess.
--
--    NO STORED ROUTE IS REPAIRED. One live fabric's route runs
--    `[DYED] DYEING → [GREIGE] HEAT SETTING → [DYED] DYEING` and carries
--    `[DYED] FABRIC PURCHASE`. Rewriting an operator's declared route from a
--    migration would be inventing production history; the screen now names both
--    faults inline and the save gate refuses them, which puts the correction in
--    the hands of whoever knows what that fabric actually ran.
-- ---------------------------------------------------------------------------
