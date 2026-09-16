-- ============================================================================
-- Raagam ERP — 0568 Yarn Dyed ▸ the DYEING LOSS a shade carries
--
-- The legacy printout's YARN DYEING block grosses each colour by its own
-- percentage and this engine could not (2026-09-16):
--
--     20'S COMBED COTTON  GREEN  510.500  5.00  537.368
--                         RED    340.299  4.00  354.478
--                         WHITE  170.201  3.00  175.465
--                         Total 1021.000        1067.311
--
-- and that 1067.311 is the figure the YARN PURCHASE (GREY) block buys. Until
-- now nothing in this schema could hold a per-shade loss, so every colour of a
-- yarn showed that yarn's own single stage loss and the grey purchase was the
-- dyed weight un-grossed — step 3 of the client's own formula was a no-op.
--
--
-- ON THE COLOUR, NOT ON THE STRIPE — THE CLIENT'S OWN REASONING (2026-09-16)
--
-- "Yarn dyeing process loss (chemical liquor pickup, re-winding, shade
-- matching) is an intrinsic physical property of the dyestuff / colour shade
-- recipe itself. Dark reactive dyestuffs (GREEN 5.00%, RED 4.00%) experience
-- higher process loss in the dye house than bleached or light shades (WHITE
-- 3.00%)."
--
-- The alternative was `order_fabric_bom_yd_repeats`, which is where the SHARES
-- live and would have been the shorter join. It is the wrong home and the
-- client named why: a repeat is a FEEDER SLOT on the knitting cylinder, and one
-- slot loads different colours across different combinations. A loss attached
-- to the slot would float as the stripe arrangement changed — the same value
-- meaning GREEN on one combo and WHITE on the next.
--
-- 0560 already made this table the place a real colour is named ("a repeat is a
-- stripe POSITION, never a real colour: the SAME position holds a different
-- actual colour per combo, which is exactly why Combinations carries its own
-- per-combo picker"). The loss belongs beside the colour it is a property of.
--
--
-- `numeric(6,2)`, `not null default 0`, AND STRICTLY UNDER 100
--
-- The same shape and the same range every other loss column in this module
-- carries (`order_fabric_bom_processes.loss_pct`,
-- `order_fabric_bom_yarn_stages.loss_pct`). Under 100 and not up to it, for the
-- reason those two state: the markup is `/(1 - loss/100)` and a 100% loss
-- divides by zero.
--
-- DEFAULT 0 IS "NOTHING DECLARED", AND THE ENGINE TREATS IT AS NO MARKUP —
-- never as a fabricated allowance. Every existing row means exactly that today,
-- so this migration writes no values and changes no figure: the 3 stored colour
-- rows keep grossing by 1, which is what they already did.
-- ============================================================================

alter table public.order_fabric_bom_yd_combination_colors
  add column if not exists dyeing_loss_pct numeric(6,2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_ofbycc_dyeing_loss'
  ) then
    alter table public.order_fabric_bom_yd_combination_colors
      add constraint chk_ofbycc_dyeing_loss
      check (dyeing_loss_pct >= 0 and dyeing_loss_pct < 100);
  end if;
end
$$;

comment on column public.order_fabric_bom_yd_combination_colors.dyeing_loss_pct is
  'The dye house''s process loss for THIS SHADE, 0-100 exclusive (0568). A '
  'property of the dyestuff — dark reactive shades lose more to liquor pickup '
  'and re-winding than a bleached white — which is why it sits on the colour '
  'and not on order_fabric_bom_yd_repeats, whose rows are knitting FEEDER '
  'slots that hold different colours across combinations. Read by the YARN '
  'DYEING block and by yarnPurchase: grey weight = dyed weight / (1 - this/100), '
  'the same backward markup every other loss in this module uses. 0 means '
  'nothing was declared and grosses by nothing.';
