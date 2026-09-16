-- ============================================================================
-- Raagam ERP — 0566  A DECLARED DIA IS TEXT, NOT A NUMBER
--
-- Client, 2026-09-16 (screenshots 2884 · 2885, then verbatim): "i need to allow
-- it 23 cm also". The Dia / Size Width Details panel had `64`, `23CM` and
-- `25BOX` typed into it; only `64` reached the Manual tab's Finish Dia list,
-- and `23CM` would have become NULL on the next Save.
--
--
-- ## THIS REVERSES 0490 AND 0494, WHICH BOTH CHOSE numeric DELIBERATELY
--
-- Neither picked it by default. 0490's header argues the case and names the
-- exact price it was paying:
--
--     "`dia` IS numeric(10,2), MATCHING THE TWO PLACES A WIDTH IS ALREADY
--      STORED … a text column here would make that comparison a string match.
--      IT COSTS THE ABILITY TO WRITE "36 x 44"; a woven width that needs two
--      numbers is two rows, which is what the grid is for."
--
-- 0494 then matched it — "one type across all four, so a value can be compared
-- rather than string-matched" — for `order_fabric_bom_manual_sizes.dia`.
--
-- The client has now asked for the one thing that reasoning ruled out. The
-- later instruction wins, and the cost 0490 named is the cost we are now
-- accepting, in full and on purpose. A reader who finds 0490's paragraph quoted
-- somewhere is holding the OLDER decision; this migration supersedes it.
--
--
-- ## WHAT IT COSTS, MEASURED RATHER THAN ASSUMED
--
-- The fear behind numeric was that a dia would be compared as a string. So
-- every reader of these two columns was traced before this was written, and
-- NOT ONE OF THEM DOES ARITHMETIC:
--
--   * both reports PRINT it (the Entry Register's `Dia / Size`, and the stage
--     ledger's `Dia/Size` across Knitting / Dyeing / Washing / Stenter /
--     Compacting) — display only;
--   * `declaredDiaOptions` on the screen DE-DUPLICATES it to build the Manual
--     tab's option list — an equality test, which text answers as well as
--     numeric once both sides are trimmed and cased alike;
--   * nothing sums, multiplies, orders or ranges by a dia anywhere.
--
-- A dia is a LABEL for the roll width, not a quantity. That is what makes this
-- safe, and it is the whole argument — if a future feature needs to compute
-- with a dia, it needs a number column beside this one, not this one back.
--
--
-- ## ONE BEHAVIOUR DOES CHANGE: THE REPORT'S ABSTAIN GETS STRICTER
--
-- The requirement report prints a stage block's dia only when every size under
-- it agrees on one (`dias.size === 1 ? [...dias][0] : null`, reports.ts), and
-- that set is now a set of STRINGS. Numerically `64` and `64.00` were one
-- answer; as text `"64"` and `"64 CM"` are two, so a block whose sizes disagree
-- on the UNIT now prints a blank where it used to print a number.
--
-- That is the right stricter and it is deliberate: the unit is part of what the
-- planner said, and silently printing one of two units against a stage that
-- mixes them is the "empty report is the dangerous one" failure with a number
-- in it instead of a blank. `trim_scale` above is what stops this firing on
-- data that has not changed — without it every converted row would arrive as
-- "64.00" and disagree with every freshly typed "64".
--
--
-- ## ONLY TWO OF THE FOUR COLUMNS CHANGE, AND THE SPLIT IS THE POINT
--
-- 0494 lists four dia columns of one type. After this migration they are two
-- and two, which is a real fragmentation and is stated here rather than left to
-- be discovered:
--
--   TEXT (converted here) — the two an OPERATOR TYPES INTO:
--     `order_fabric_bom_dias.dia`           the declared vocabulary
--     `order_fabric_bom_manual_sizes.dia`   the value picked from it
--
--   numeric (UNCHANGED) — the two the CAD SIDE writes and reads:
--     `order_fabric_bom_lines.dia`          written by `seedFabricBomFromCad`,
--                                           read back by `cad/service.ts` and
--                                           compared for marker agreement in
--                                           `cad/weights.ts`. Nobody types it —
--                                           its cell was removed 2026-09-01 —
--                                           so it never sees "23 CM".
--     `order_cad_marker_layouts.dia`        the CAD sheet's own entry (0460).
--
-- The two halves do not meet today: the declared list feeds the Manual tab, and
-- CAD writes the line. THE DAY THEY DO — if the line's Dia cell is ever
-- re-exposed picking from the declared list, which 0490 wired and 09-01 removed
-- — that pairing is a text column against a numeric one and must be resolved
-- THEN, in whichever direction the client wants. Do not "tidy" it by converting
-- the CAD columns here: they are compared numerically today and this migration
-- has no mandate over them.
--
--
-- ## trim_scale, OR EVERY STORED DIA GAINS ".00"
--
-- `numeric(10,2)` renders 64 as "64.00", so a bare `dia::text` would silently
-- rewrite every operator's `64` into `64.00` — a cosmetic change to data nobody
-- asked to edit, in the exact column this migration exists to stop mangling.
-- `trim_scale()` (PG13+, and this database is PG15) drops the trailing zeros so
-- 64.00 becomes "64" and a genuine 23.50 stays "23.50".
--
-- Catalog before running (2026-09-16): 11 declared dia rows, 91 manual size
-- rows all carrying a dia. Every one is a whole number today, so every one
-- converts to the digits the operator originally typed.
--
--
-- ## A LENGTH CHECK, BECAUSE text HAS NO SHAPE AT ALL
--
-- The column is deliberately not constrained to a pattern — the point of the
-- change is that "23 cm", "36 x 44" and "58 inch" are all legitimate. But a
-- field with no ceiling is one paste away from holding a paragraph, so 32
-- characters: long enough for "36 x 44 INCH" and short enough to stay a label.
-- The screen uppercases as it types (the `Input` default since 2026-08-18), so
-- what lands here is "23 CM" rather than "23 cm".
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The declared vocabulary (0490).
-- ---------------------------------------------------------------------------
alter table public.order_fabric_bom_dias
  alter column dia type text
  using case when dia is null then null else trim_scale(dia)::text end;

alter table public.order_fabric_bom_dias
  drop constraint if exists chk_ofbd_dia_len;

alter table public.order_fabric_bom_dias
  add constraint chk_ofbd_dia_len
  check (dia is null or char_length(dia) <= 32);

comment on column public.order_fabric_bom_dias.dia is
  'The declared roll width, as the operator writes it — "64", "23 CM", '
  '"36 x 44" (0566, client 2026-09-16). TEXT since that date, reversing 0490''s '
  'numeric(10,2) and the "36 x 44 costs us nothing" argument in its header: the '
  'client asked for exactly that. Safe because no reader computes with a dia — '
  'both reports print it and the Manual tab de-duplicates it to build an option '
  'list. NOT the same type as order_fabric_bom_lines.dia or '
  'order_cad_marker_layouts.dia, which stay numeric because CAD compares them; '
  'see 0566''s header before pairing a text dia with either.';


-- ---------------------------------------------------------------------------
-- 2. The value a Manual size row picks from that list (0494).
--
--    CONVERTED IN THE SAME MIGRATION, NOT A LATER ONE. This column exists to
--    hold a value chosen from the list above, so a version of this database
--    where one is text and the other is numeric cannot round-trip a "23 CM" the
--    operator just picked — the Manual cell would offer it and fail to store it,
--    which is the bug this whole change is fixing, moved one table along.
-- ---------------------------------------------------------------------------
alter table public.order_fabric_bom_manual_sizes
  alter column dia type text
  using case when dia is null then null else trim_scale(dia)::text end;

alter table public.order_fabric_bom_manual_sizes
  drop constraint if exists chk_ofbms_dia_len;

alter table public.order_fabric_bom_manual_sizes
  add constraint chk_ofbms_dia_len
  check (dia is null or char_length(dia) <= 32);

comment on column public.order_fabric_bom_manual_sizes.dia is
  'The finishing dia this size is knitted at, picked from '
  'order_fabric_bom_dias (0490) and shown on the Manual grid as "Finish Dia". '
  'TEXT since 0566 so it can hold the unit the operator writes — it must match '
  'the type of the list it picks from or the pick cannot be stored. Printed by '
  'both reports; never computed with.';


-- ---------------------------------------------------------------------------
-- 3. Verify, rather than trust that the statements above ran.
--
--    "{"success": true} means the SQL ran, not that it achieved its stated
--    goal" — AGENTS.md, from 0386/0387, where a lockdown migration applied
--    cleanly and did nothing. Both columns must now report `text`.
-- ---------------------------------------------------------------------------
do $verify$
declare
  t_dias text;
  t_sizes text;
begin
  select data_type into t_dias
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'order_fabric_bom_dias'
     and column_name = 'dia';

  select data_type into t_sizes
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'order_fabric_bom_manual_sizes'
     and column_name = 'dia';

  if t_dias is distinct from 'text' then
    raise exception '0566: order_fabric_bom_dias.dia is %, expected text', t_dias;
  end if;

  if t_sizes is distinct from 'text' then
    raise exception '0566: order_fabric_bom_manual_sizes.dia is %, expected text', t_sizes;
  end if;
end $verify$;
