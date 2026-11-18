-- 000_pruzkum.sql – JEN ČTENÍ. Nic nemění (jediný SELECT).
-- Projekt „servisní záznamy“: Supabase → SQL Editor → New query → vložit → Run.
-- Výsledek: řádky (sekce, obsah). Tlačítkem Export → Copy as JSON (nebo CSV) zkopíruj celý výstup a pošli ho.
select 'tabulky_public' as sekce, (
  -- všechny tabulky v public: RLS, vlastník, práva (relacl), odhad řádků
  select coalesce(jsonb_agg(jsonb_build_object(
    'tabulka', c.relname, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
    'vlastnik', pg_get_userbyid(c.relowner), 'prava', c.relacl::text, 'radku_odhad', c.reltuples::bigint
  ) order by c.relname), '[]'::jsonb)
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v')
) as obsah
union all
select 'profily_sloupce', (
  select coalesce(jsonb_agg(jsonb_build_object(
    'sloupec', column_name, 'typ', data_type, 'udt', udt_name, 'null', is_nullable, 'default', column_default
  ) order by ordinal_position), '[]'::jsonb)
  from information_schema.columns where table_schema = 'public' and table_name = 'profily'
)
union all
select 'profily_omezeni', (
  select coalesce(jsonb_agg(jsonb_build_object('nazev', conname, 'definice', pg_get_constraintdef(oid))), '[]'::jsonb)
  from pg_constraint where conrelid = to_regclass('public.profily')
)
union all
select 'profily_data', (
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.profily p
)
union all
select 'uzivatele', (
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email) order by created_at), '[]'::jsonb) from auth.users
)
union all
select 'politiky', (
  select coalesce(jsonb_agg(jsonb_build_object(
    'schema', schemaname, 'tabulka', tablename, 'politika', policyname, 'prikaz', cmd, 'role', roles::text,
    'permissive', permissive, 'using', qual, 'with_check', with_check
  ) order by schemaname, tablename, policyname), '[]'::jsonb)
  from pg_policies where schemaname in ('public', 'storage')
)
union all
select 'funkce_public', (
  -- vlastní funkce (bez funkcí z rozšíření), včetně celé definice
  select coalesce(jsonb_agg(jsonb_build_object(
    'funkce', p.proname, 'argumenty', pg_get_function_identity_arguments(p.oid), 'vraci', pg_get_function_result(p.oid),
    'security_definer', p.prosecdef, 'nastaveni', p.proconfig::text, 'prava', p.proacl::text, 'definice', pg_get_functiondef(p.oid)
  ) order by p.proname), '[]'::jsonb)
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
)
union all
select 'triggery', (
  select coalesce(jsonb_agg(jsonb_build_object('tabulka', t.tgrelid::regclass::text, 'trigger', t.tgname, 'definice', pg_get_triggerdef(t.oid))
    order by 1), '[]'::jsonb)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where not t.tgisinternal and c.relnamespace in ('public'::regnamespace, 'auth'::regnamespace)
)
union all
select 'buckety', (
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'public', public, 'limit', file_size_limit, 'typy', allowed_mime_types) order by id), '[]'::jsonb)
  from storage.buckets
)
union all
select 'vychozi_prava', (
  select coalesce(jsonb_agg(jsonb_build_object('role', defaclrole::regrole::text, 'schema', defaclnamespace::regnamespace::text,
    'typ', defaclobjtype, 'prava', defaclacl::text)), '[]'::jsonb)
  from pg_default_acl
)
union all
select 'rozsireni', (
  select coalesce(jsonb_agg(jsonb_build_object('nazev', e.extname, 'verze', e.extversion, 'schema', e.extnamespace::regnamespace::text) order by e.extname), '[]'::jsonb)
  from pg_extension e
);
