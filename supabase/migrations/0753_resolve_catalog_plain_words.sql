-- 0753 — Fix, IT help and Buy: fewer, plainer choices (user 2026-10-26: "do
-- same for fix it and buy also", after 0752 did it for Raise a concern).
--
-- Each area now offers 1–4 everyday choices instead of 4–8 narrow ones. The
-- worker taps the KIND of problem and says the rest in their own words.
--
-- One rule decides what may merge: two items merge only when they ROUTE to the
-- same place (trade_code / sd_category_code) and share the same `dangerous`
-- flag — so no ticket goes to a different team than before, and no emergency
-- alert is lost. That is why Fire & safety keeps four: a blocked exit, a
-- missing machine guard and a gas smell go to three different places.
--
-- Nothing is deleted. A merged item is switched OFF (`inactive`); its words and
-- its old label become SYNONYMS of the item that absorbed it, so search still
-- finds "paper jam", "wi-fi" or "tag gun". One ticket points at F-ELE-FAN and
-- still resolves it.

do $$
declare
  m record;
begin
  for m in
    select * from (values
      -- FIX ------------------------------------------------------------------
      ('F-SEW-NEEDLE', 'NOT STITCHING RIGHT',              1, array['F-SEW-SKIP','F-SEW-THREAD','F-SEW-TRIM','F-SEW-NOISE','F-SEW-OIL']),
      ('F-SEW-MOTOR',  'MACHINE NOT RUNNING',              2, array['F-SEW-PEDAL']),
      ('F-MAC-CUT',    'MACHINE NOT WORKING',              1, array['F-MAC-FUSE','F-MAC-IRON','F-MAC-SNAP','F-MAC-EMB','F-MAC-GUN','F-MAC-COMP']),
      ('F-MAC-NDET',   'NEEDLE DETECTOR NOT WORKING',      2, array[]::text[]),
      ('F-MAC-BOIL',   'BOILER OR STEAM PRESSURE',         3, array[]::text[]),
      ('F-ELE-NOPWR',  'NO POWER OR BREAKER TRIPPING',     1, array['F-ELE-GEN','F-ELE-TRIP']),
      ('F-ELE-LIGHT',  'LIGHT, FAN OR SWITCH NOT WORKING', 2, array['F-ELE-FAN','F-ELE-SOCK']),
      ('F-ELE-SPARK',  'SPARKING, BURNING OR BARE WIRE',   3, array['F-ELE-WIRE']),
      ('F-WAT-NONE',   'NO WATER OR DRINKING WATER',       1, array['F-WAT-RO']),
      ('F-WAT-LEAK',   'LEAK, TAP OR TOILET PROBLEM',      2, array['F-WAT-BLOCK','F-WAT-TAP']),
      ('F-WAT-CLEAN',  'WASHROOM NEEDS CLEANING',          3, array[]::text[]),
      ('F-BLD-CHAIR',  'FURNITURE, DOOR OR WINDOW BROKEN', 1, array['F-BLD-TABLE','F-BLD-DOOR']),
      ('F-BLD-RACK',   'RACK OR SHELF COULD FALL',         2, array[]::text[]),
      ('F-BLD-ROOF',   'ROOF OR WALL LEAKING',             3, array[]::text[]),
      ('F-BLD-FLOOR',  'FLOOR BROKEN OR SLIPPERY',         4, array[]::text[]),
      ('F-SAF-GAS',    'GAS, SMOKE OR FIRE ALARM',         1, array['F-SAF-ALARM']),
      ('F-SAF-EXIT',   'EMERGENCY EXIT BLOCKED',           2, array[]::text[]),
      ('F-SAF-GUARD',  'MACHINE GUARD MISSING',            3, array[]::text[]),
      ('F-SAF-EXT',    'FIRE EXTINGUISHER OR FIRST-AID BOX', 4, array['F-SAF-FAID']),
      ('F-CMF-AC',     'TOO HOT OR AC NOT COOLING',        1, array['F-CMF-HOT']),
      ('F-CMF-CLEAN',  'NEEDS CLEANING OR PEST CONTROL',   2, array['F-CMF-PEST']),
      ('F-CMF-CANT',   'CANTEEN EQUIPMENT BROKEN',         3, array[]::text[]),
      ('F-CMF-EXH',    'EXHAUST FAN NOT WORKING',          4, array[]::text[]),
      -- IT -------------------------------------------------------------------
      ('I-PC-POWER',   'COMPUTER NOT WORKING',             1, array['I-PC-DISP','I-PC-KBM','I-PC-UPS']),
      ('I-PC-SLOW',    'VERY SLOW OR HANGING',             2, array[]::text[]),
      ('I-PRN-NOPRT',  'PRINTER OR SCANNER NOT WORKING',   1, array['I-PRN-JAM','I-PRN-SCAN','I-PRN-LABEL']),
      ('I-PRN-INK',    'TONER OR INK LOW',                 2, array[]::text[]),
      ('I-NET-NONE',   'NO INTERNET OR WI-FI',             1, array['I-NET-WIFI']),
      ('I-NET-SLOW',   'SLOW NETWORK OR SHARED FOLDER',    2, array['I-NET-SHARE']),
      ('I-ERP-ERROR',  'ERP ERROR OR CANNOT SAVE',         1, array['I-ERP-SAVE','I-ERP-WRONG']),
      ('I-ERP-ACCESS', 'NEED ACCESS TO A SCREEN',          2, array[]::text[]),
      ('I-ERP-PASS',   'FORGOT PASSWORD OR LOCKED OUT',    3, array[]::text[]),
      ('I-COM-MAIL',   'EMAIL OR PHONE PROBLEM',           1, array['I-COM-NEWID','I-COM-SIM']),
      ('I-COM-BIO',    'BIOMETRIC NOT PUNCHING',           2, array[]::text[]),
      ('I-COM-CCTV',   'CCTV CAMERA DOWN',                 3, array[]::text[]),
      ('I-NEW-PC',     'NEW COMPUTER OR SOFTWARE',         1, array['I-NEW-SW','I-NEW-JOIN']),
      ('I-NEW-MOVE',   'MOVE MY COMPUTER',                 2, array[]::text[]),
      ('I-NEW-SRV',    'SERVER OR STORAGE',                3, array[]::text[]),
      -- BUY (every Buy request goes to Stores, so only the words differ) ------
      ('B-PRD-NEEDLE', 'NEEDLES, OIL OR SPARE PARTS',      1, array['B-PRD-OIL','B-PRD-SPARE']),
      ('B-PRD-SCIS',   'SCISSORS, CHALK OR TAG GUN',       2, array['B-PRD-CHALK','B-PRD-TAGGUN']),
      ('B-PPE-MASK',   'GLOVES, MASKS OR EAR PLUGS',       1, array['B-PPE-MESH','B-PPE-EAR']),
      ('B-PPE-FAID',   'FIRST-AID OR FIRE EXTINGUISHER',   2, array['B-PPE-EXT']),
      ('B-TLS-TOOL',   'TOOLS OR REPAIR MATERIAL',         1, array['B-TLS-ELEC','B-TLS-PLMB','B-TLS-CIVIL']),
      ('B-OFF-PAPER',  'PAPER, PENS OR FILES',             1, array['B-OFF-PEN','B-OFF-REG']),
      ('B-OFF-TONER',  'PRINTER TONER',                    2, array[]::text[]),
      ('B-HSK-CLEAN',  'CLEANING OR TOILET SUPPLIES',      1, array['B-HSK-TOIL']),
      ('B-HSK-CANT',   'CANTEEN OR DRINKING WATER',        2, array['B-HSK-WATER']),
      ('B-ITE-KBM',    'MOUSE, KEYBOARD, CABLE OR HEADSET', 1, array['B-ITE-CABLE','B-ITE-HEAD'])
    ) as v(keep, label, sort, merged)
  loop
    update public.rh_catalog_items k
       set label = m.label,
           sort = m.sort,
           -- The keeper's own words, the absorbed items' words, and every old
           -- label in lower case — so the old name still finds it.
           synonyms = (
             select coalesce(array_agg(distinct w), '{}')
               from (
                 select unnest(k.synonyms) as w
                 union select lower(k.label)
                 union select unnest(o.synonyms) from public.rh_catalog_items o where o.code = any (m.merged)
                 union select lower(o.label) from public.rh_catalog_items o where o.code = any (m.merged)
               ) s
              where w is not null and w <> lower(m.label)
           )
     where k.code = m.keep;
    if not found then
      raise exception '0753: catalog item % is missing', m.keep;
    end if;
    update public.rh_catalog_items set inactive = true where code = any (m.merged);
  end loop;
end $$;
