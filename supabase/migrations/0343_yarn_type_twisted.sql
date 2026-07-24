-- Add "Twisted" to the yarn_type lookup so it is selectable in the Material
-- master. Twisted yarn (like Doubling/Melange) is an inherently combined yarn
-- and drives the Mixing grid's visibility (client 2026-07-24). Idempotent:
-- no-op if the value already exists (matches the 0279 yarn_type seed pattern).

insert into public.config_lookups (kind, code, name, is_active)
select 'yarn_type', 'twisted', 'Twisted', true
where not exists (
  select 1 from public.config_lookups where kind = 'yarn_type' and code = 'twisted'
);
