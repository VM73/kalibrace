-- 001_rollback.sql – vrátí 001_init.sql. Celé v jedné transakci: při chybě se neprovede nic.
-- Smaže schéma kalibrace (všechna data kalibrací!), storage politiky „kalibrace - …“, oba buckety
-- (jen když jsou prázdné) a 'kalibrace' z profily.aplikace správce. Objekty ostatních appek nechá být.
-- Spuštění: Supabase → SQL Editor → vložit → Run. Potom v Data API → Exposed schemas odeber `kalibrace`.

begin;

-- Buckety mažeme jen prázdné; soubory se musí smazat přes Storage API (Dashboard → Storage).
do $$
begin
  if exists (select 1 from storage.objects where bucket_id in ('kalibrace-protokoly', 'kalibrace-fotky')) then
    raise exception 'Buckety kalibrace-* nejsou prázdné – nejdřív smaž soubory v Dashboard → Storage.';
  end if;
end $$;

drop policy if exists "kalibrace - cteni souboru"   on storage.objects;
drop policy if exists "kalibrace - nahrani souboru" on storage.objects;
drop policy if exists "kalibrace - zmena souboru"   on storage.objects;
drop policy if exists "kalibrace - mazani souboru"  on storage.objects;

-- Supabase chrání storage tabulky triggerem protect_delete; povolení platí jen do konce této transakce.
set local storage.allow_delete_query = 'true';
delete from storage.buckets where id in ('kalibrace-protokoly', 'kalibrace-fotky');

drop schema if exists kalibrace cascade;

-- <UUID_SPRAVCE> je zástupný text; skutečný skript je v interních podkladech (lokálně sql/lokalni/, v .gitignore).
update public.profily set aplikace = array_remove(aplikace, 'kalibrace')
 where id = '<UUID_SPRAVCE>';

commit;

notify pgrst, 'reload schema';
