-- 0752 — Raise a concern: fewer, plainer choices (user 2026-10-26).
--
-- The concern lane offered 19 narrow choices, four of them under Behaviour
-- alone ("SHOUTING OR ABUSIVE WORDS", "THREATS OR BULLYING", "SEXUAL
-- HARASSMENT", "PHYSICAL CONTACT OR VIOLENCE"). The user: "think some normal …
-- no need this much … look higher level". A worker picks the KIND of trouble in
-- everyday words and says the rest in their own words; the handler reads the
-- detail, not the chip.
--
-- Nothing is deleted: the narrow items are switched OFF (`inactive`), so a
-- ticket that ever pointed at one still resolves (0 do today). The words that
-- found them become synonyms of the item that replaces them, so search still
-- lands. Routing is unchanged — every kept item keeps its complaint category
-- code, so Behaviour still goes to the sensitive HAR committee.

-- Pay & attendance: 5 → 2
update public.rh_catalog_items set label = 'PAY IS WRONG OR LATE',
  synonyms = array['salary','wage','pay','ot','overtime','deduction','cut','fine','not credited']
 where code = 'C-PAY-SHORT';
update public.rh_catalog_items set label = 'ATTENDANCE OR LEAVE IS WRONG',
  synonyms = array['attendance','punch','absent','leave','holiday']
 where code = 'C-PAY-PUNCH';
update public.rh_catalog_items set inactive = true where code in ('C-PAY-OT', 'C-PAY-DED', 'C-PAY-LEAVE');

-- Behaviour: 4 → 2
update public.rh_catalog_items set label = 'SOMEONE BEHAVED BADLY',
  synonyms = array['shout','abuse','scold','insult','rude','threat','bully','pressure']
 where code = 'C-BEH-SHOUT';
update public.rh_catalog_items set label = 'I DO NOT FEEL SAFE WITH SOMEONE', sort = 2,
  synonyms = array['unsafe','hit','push','violence','harassment','touch','posh']
 where code = 'C-BEH-VIOL';
update public.rh_catalog_items set inactive = true where code in ('C-BEH-THREAT', 'C-BEH-SEXUAL');

-- Fair treatment: 3 → 1
update public.rh_catalog_items set label = 'TREATED UNFAIRLY',
  synonyms = array['unfair','work','target','denied','benefit','bonus','caste','religion','gender','age','region','discrimination']
 where code = 'C-FAI-WORK';
update public.rh_catalog_items set inactive = true where code in ('C-FAI-DENIED', 'C-FAI-DISC');

-- Working conditions: 6 → 3
update public.rh_catalog_items set label = 'TOO MUCH WORK OR OVERTIME',
  synonyms = array['forced','excess','long hours','sunday','break','toilet break','water break']
 where code = 'C-WRK-OT';
update public.rh_catalog_items set label = 'UNSAFE WORK', sort = 2 where code = 'C-WRK-UNSAFE';
update public.rh_catalog_items set label = 'FOOD, BUS OR REST ROOM', sort = 3,
  synonyms = array['food','canteen','meal','bus','transport','van','creche','rest room','child care']
 where code = 'C-WRK-FOOD';
update public.rh_catalog_items set inactive = true where code in ('C-WRK-BREAK', 'C-WRK-BUS', 'C-WRK-CRECHE');
