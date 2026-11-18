-- 001_init.sql – Evidence kalibrací ve sdíleném Supabase projektu „servisní záznamy“
-- Vlastní schéma `kalibrace`; na tabulky, funkce a politiky ostatních appek ve sdíleném Supabase projektu nesahá.
-- Jediná změna mimo schéma: správci se do public.profily.aplikace přidá 'kalibrace' (ostatní hodnoty zůstanou).
-- Spuštění: Supabase → SQL Editor → New query → vložit celý soubor → Run. Běží v jedné transakci.
-- Ověřeno lokálně: tests/sql.test.mjs (PGlite se stubem auth, storage a profily podle průzkumu 000_pruzkum.sql).

begin;

-- ---------- Schéma ----------
create schema kalibrace;
comment on schema kalibrace is 'Evidence kalibrací – VM73/kalibrace';

-- Smí uživatel do appky? Stejný vzor jako ostatní appky ve sdíleném projektu.
create function kalibrace.smi() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profily
    where id = (select auth.uid()) and aktivni and 'kalibrace' = any(aplikace));
$$;

-- ---------- Tabulky ----------
-- owner se doplní sám (auth.uid()), appka ho neposílá.
-- Složené cizí klíče (…, owner): přístroj i kalibrace patří vždy ke skupině / přístroji stejného uživatele.

create table kalibrace.skupiny (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nazev        text not null check (length(btrim(nazev)) > 0),
  typ          text not null default 'jiny'
               check (typ in ('anemometr', 'balometr', 'detektor_uniku', 'dif_manometr', 'jiny')),
  min_platnych int  not null default 1 check (min_platnych >= 1),
  poradi       int  not null default 0,
  created_at   timestamptz not null default now(),
  unique (id, owner)
);

create table kalibrace.pristroje (
  id               uuid primary key default gen_random_uuid(),
  owner            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  skupina_id       uuid not null,
  vyrobce          text not null default '',
  model            text not null check (length(btrim(model)) > 0),
  vyrobni_cislo    text not null check (length(btrim(vyrobni_cislo)) > 0),
  technik          text not null default '',
  interval_mesicu  int  not null default 12 check (interval_mesicu between 1 and 120),
  doba_v_lab_dni   int  not null default 14 check (doba_v_lab_dni between 0 and 365),
  predstih_dni     int  check (predstih_dni between 0 and 365), -- null = výchozí z nastavení
  stav             text not null default 'aktivni' check (stav in ('aktivni', 'na_kalibraci', 'vyrazeno')),
  odeslano_dne     date,
  ocekavany_navrat date,
  foto_path        text,
  poznamka         text not null default '',
  created_at       timestamptz not null default now(),
  unique (owner, vyrobni_cislo),
  unique (id, owner),
  -- skupinu s přístroji nejde smazat
  foreign key (skupina_id, owner) references kalibrace.skupiny (id, owner) on delete restrict
);

create table kalibrace.kalibrace (
  id              uuid primary key default gen_random_uuid(),
  owner           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pristroj_id     uuid not null,
  datum_kalibrace date not null,
  platnost_do     date not null,
  laborator       text not null default '',
  cislo_protokolu text not null default '',
  protokol_path   text,
  cena            numeric(12, 2) check (cena >= 0),
  poznamka        text not null default '',
  created_at      timestamptz not null default now(),
  check (platnost_do >= datum_kalibrace),
  foreign key (pristroj_id, owner) references kalibrace.pristroje (id, owner) on delete cascade
);

create table kalibrace.nastaveni (
  owner                uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  email_upozorneni     text,
  predstih_dni_vychozi int not null default 30 check (predstih_dni_vychozi between 0 and 365),
  -- SHA-256 (hex) tokenu skriptu upozornění; samotný token je jen v GitHub Secrets
  token_hash           text unique check (token_hash ~ '^[0-9a-f]{64}$')
);

create index skupiny_owner_idx      on kalibrace.skupiny (owner, poradi);
create index pristroje_skupina_idx  on kalibrace.pristroje (skupina_id, owner);
create index kalibrace_pristroj_idx on kalibrace.kalibrace (pristroj_id, owner, datum_kalibrace desc);
create index kalibrace_owner_idx    on kalibrace.kalibrace (owner);

-- ---------- RLS: vlastní řádky a zároveň 'kalibrace' v profily.aplikace ----------
alter table kalibrace.skupiny   enable row level security;
alter table kalibrace.pristroje enable row level security;
alter table kalibrace.kalibrace enable row level security;
alter table kalibrace.nastaveni enable row level security;

create policy vlastni on kalibrace.skupiny for all to authenticated
  using (owner = (select auth.uid()) and (select kalibrace.smi()))
  with check (owner = (select auth.uid()) and (select kalibrace.smi()));
create policy vlastni on kalibrace.pristroje for all to authenticated
  using (owner = (select auth.uid()) and (select kalibrace.smi()))
  with check (owner = (select auth.uid()) and (select kalibrace.smi()));
create policy vlastni on kalibrace.kalibrace for all to authenticated
  using (owner = (select auth.uid()) and (select kalibrace.smi()))
  with check (owner = (select auth.uid()) and (select kalibrace.smi()));
create policy vlastni on kalibrace.nastaveni for all to authenticated
  using (owner = (select auth.uid()) and (select kalibrace.smi()))
  with check (owner = (select auth.uid()) and (select kalibrace.smi()));

-- ---------- Data pro skript upozornění (bez service_role) ----------
-- Skript volá POST /rest/v1/rpc/upozorneni_data (hlavička Content-Profile: kalibrace) s publishable klíčem
-- a svým tokenem. Funkce vrátí jen data kalibrací vlastníka tokenu, a jen když má appku povolenou.
create function kalibrace.upozorneni_data(token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  vlastnik uuid;
begin
  select n.owner into vlastnik
    from kalibrace.nastaveni n join public.profily p on p.id = n.owner
   where n.token_hash = encode(extensions.digest(coalesce(token, ''), 'sha256'), 'hex')
     and p.aktivni and 'kalibrace' = any(p.aplikace);
  if vlastnik is null then
    raise exception 'neplatný token' using errcode = '28000';
  end if;
  return jsonb_build_object(
    'nastaveni', (select jsonb_build_object('email_upozorneni', n.email_upozorneni, 'predstih_dni_vychozi', n.predstih_dni_vychozi)
                    from kalibrace.nastaveni n where n.owner = vlastnik),
    'skupiny',   (select coalesce(jsonb_agg(to_jsonb(s) order by s.poradi), '[]'::jsonb) from kalibrace.skupiny s where s.owner = vlastnik),
    'pristroje', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from kalibrace.pristroje x where x.owner = vlastnik),
    'kalibrace', (select coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb) from kalibrace.kalibrace k where k.owner = vlastnik)
  );
end;
$$;

-- ---------- Práva ----------
-- authenticated: tabulky (dál omezené RLS). anon: žádná tabulka, jen volání upozorneni_data (chráněno tokenem).
grant usage on schema kalibrace to authenticated, anon;
grant select, insert, update, delete on all tables in schema kalibrace to authenticated;
revoke all on all tables in schema kalibrace from anon;
revoke execute on all functions in schema kalibrace from public, anon, authenticated;
grant execute on function kalibrace.smi() to authenticated;
grant execute on function kalibrace.upozorneni_data(text) to anon;

-- ---------- Úložiště ----------
-- Soukromé buckety; cesta souboru '<uid>/<soubor>'; otevírání přes podepsané URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('kalibrace-protokoly', 'kalibrace-protokoly', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/heic']),
  ('kalibrace-fotky',     'kalibrace-fotky',     false, 1048576,  array['image/jpeg']);

create policy "kalibrace - cteni souboru" on storage.objects for select to authenticated
  using (bucket_id in ('kalibrace-protokoly', 'kalibrace-fotky')
    and (storage.foldername(name))[1] = (select auth.uid())::text and (select kalibrace.smi()));
create policy "kalibrace - nahrani souboru" on storage.objects for insert to authenticated
  with check (bucket_id in ('kalibrace-protokoly', 'kalibrace-fotky')
    and (storage.foldername(name))[1] = (select auth.uid())::text and (select kalibrace.smi()));
create policy "kalibrace - zmena souboru" on storage.objects for update to authenticated
  using (bucket_id in ('kalibrace-protokoly', 'kalibrace-fotky')
    and (storage.foldername(name))[1] = (select auth.uid())::text and (select kalibrace.smi()))
  with check (bucket_id in ('kalibrace-protokoly', 'kalibrace-fotky')
    and (storage.foldername(name))[1] = (select auth.uid())::text and (select kalibrace.smi()));
create policy "kalibrace - mazani souboru" on storage.objects for delete to authenticated
  using (bucket_id in ('kalibrace-protokoly', 'kalibrace-fotky')
    and (storage.foldername(name))[1] = (select auth.uid())::text and (select kalibrace.smi()));

-- ---------- Přístup pro správce ----------
-- <UUID_SPRAVCE> je zástupný text (bez náhrady migrace skončí chybou „invalid input syntax for type uuid“).
-- Skutečný skript je v interních podkladech; lokální kopie patří do sql/lokalni/ (je v .gitignore).
update public.profily set aplikace = array_append(aplikace, 'kalibrace')
 where id = '<UUID_SPRAVCE>' and not ('kalibrace' = any(aplikace));

-- Budoucí funkce ve schématu nesmí být spustitelné všem. Pozn.: `alter default privileges in schema kalibrace
-- revoke execute on functions from public` v Postgresu nic neudělá (výchozí práva po schématech jdou jen přidávat,
-- EXECUTE pro PUBLIC je globální výchozí) a globální varianta by změnila celý sdílený projekt. Proto pravidlo:
-- každá migrace končí touto pojistkou a kontrolou, že žádná funkce v kalibrace není spustitelná pro PUBLIC.
revoke execute on all functions in schema kalibrace from public;
do $$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'kalibrace'::regnamespace
             and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))) then
    raise exception 'Ve schématu kalibrace je funkce spustitelná pro PUBLIC';
  end if;
end $$;

commit;

-- Ať Data API (PostgREST) hned vidí nové schéma (musí být i v Exposed schemas, viz sql/README.md).
notify pgrst, 'reload schema';
