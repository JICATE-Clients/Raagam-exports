-- 0754 — Raise a concern in SOFT words (user 2026-10-26: "use soft words, no
-- more kind of harassment blah blah").
--
-- 0752 made the choices fewer; this makes them gentler. A worker raising a
-- concern reads everyday, non-accusing words — "Someone's behaviour upset me",
-- not a legal term. The harder words stay only where nobody raising a concern
-- reads them: as SEARCH synonyms (so typing them still finds the right choice)
-- and in the category CODES (HAR, DIS, SAF) that route the ticket. Routing,
-- sensitivity and the committee are unchanged.

-- What the worker taps --------------------------------------------------------
update public.rh_catalog_items set label = 'A QUESTION ABOUT MY PAY'               where code = 'C-PAY-SHORT';
update public.rh_catalog_items set label = 'A QUESTION ABOUT ATTENDANCE OR LEAVE'  where code = 'C-PAY-PUNCH';
update public.rh_catalog_items set label = 'SOMEONE''S BEHAVIOUR UPSET ME'         where code = 'C-BEH-SHOUT';
update public.rh_catalog_items set label = 'I FEEL UNCOMFORTABLE WITH SOMEONE'     where code = 'C-BEH-VIOL';
update public.rh_catalog_items set label = 'I WAS NOT TREATED FAIRLY'              where code = 'C-FAI-WORK';
update public.rh_catalog_items set label = 'WORKING HOURS OR WORKLOAD'             where code = 'C-WRK-OT';
update public.rh_catalog_items set label = 'SAFETY AT WORK'                        where code = 'C-WRK-UNSAFE';

update public.rh_catalog_areas set label = 'People at work',
       details = array['Happened once', 'Keeps happening', 'Others have seen it'] where code = 'C-BEH';
update public.rh_catalog_areas set label = 'Fairness'         where code = 'C-FAI';
update public.rh_catalog_areas set label = 'Work & comfort',
       details = array['Today', 'Every day', 'Others feel the same'] where code = 'C-WRK';
update public.rh_catalog_areas set details = array['This month', 'For some months', 'Others feel the same']
 where code = 'C-PAY';

-- What the worker reads back on My Reports (the category name) ---------------
update public.rh_complaint_categories
   set name = 'PERSONAL CONDUCT', description = 'How someone behaved towards you — seen by the committee only'
 where code = 'HAR';
update public.rh_complaint_categories
   set name = 'FAIR TREATMENT', description = 'Being treated differently from others — seen by the committee only'
 where code = 'DIS';
update public.rh_complaint_categories
   set name = 'SAFETY AT WORK', description = 'Something at work that does not feel safe, and is not a broken item'
 where code = 'SAF';
