// Ověření migrace sql/001_init.sql na lokálním Postgresu (PGlite, běží v Node bez instalace).
// Supabase části (role, auth, storage, extensions, public.profily) jsou stuby podle skutečného průzkumu (000_pruzkum.sql).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const V = '11111111-1111-1111-1111-111111111111'; // správce s jinými appkami (migrace mu přidá kalibrace)
const B = '22222222-2222-2222-2222-222222222222'; // jiný uživatel s appkou kalibrace
const C = '33333333-3333-3333-3333-333333333333'; // technik jen se servisem
const D = '44444444-4444-4444-4444-444444444444'; // neaktivní účet s kalibrací
const STUB = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions; create extension pgcrypto schema extensions;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets, name text);
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  alter table storage.objects enable row level security;
  -- jako v Supabase: přímé mazání ze storage tabulek blokuje trigger, pokud není storage.allow_delete_query = true
  create function storage.protect_delete() returns trigger language plpgsql as $$ begin
    if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
      raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.' using errcode = '42501';
    end if; return null; end $$;
  create trigger protect_buckets_delete before delete on storage.buckets for each statement execute function storage.protect_delete();
  create trigger protect_objects_delete before delete on storage.objects for each statement execute function storage.protect_delete();
  insert into storage.buckets (id, name, public) values ('app1-fotky', 'app1-fotky', false);  -- bucket jiné appky
  create policy "app1 - nahrani souboru" on storage.objects for insert to authenticated with check (bucket_id = 'app1-fotky');
  -- jako v Supabase: výchozí práva pro public (nové schéma kalibrace je nemá)
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.profily (
    id uuid primary key references auth.users on delete cascade, email text, role text not null default 'technik',
    aktivni boolean not null default false, token_hash text unique, vytvoreno timestamptz not null default now(),
    aplikace text[] not null default '{}');
  alter table public.profily enable row level security;
  create policy "profily - cteni" on public.profily for select to authenticated using (id = (select auth.uid()));
  grant usage on schema auth, storage, public, extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to authenticated, service_role;
  grant select on storage.buckets to authenticated;
  insert into auth.users values ('${V}'), ('${B}'), ('${C}'), ('${D}');
  insert into public.profily (id, role, aktivni, aplikace) values
    ('${V}', 'admin', true, '{app1,app2,app3}'), ('${B}', 'technik', true, '{kalibrace}'),
    ('${C}', 'technik', true, '{app1}'), ('${D}', 'technik', false, '{kalibrace}');
`;

let db;
// Spustí SQL jako daný uživatel (role + JWT sub jako v Supabase)
async function jako(kdo, sql, params) {
  const role = kdo === 'anon' ? 'anon' : 'authenticated';
  const sub = kdo === 'anon' ? '' : kdo;
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub}', false); set role ${role};`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role;'); }
}
const chyba = (p, re) => assert.rejects(p, re);
const pocet = async (kdo, t) => (await jako(kdo, `select count(*)::int c from ${t}`)).rows[0].c;

before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  await db.exec(readFileSync(new URL('../sql/001_init.sql', import.meta.url), 'utf8').replaceAll('<UUID_SPRAVCE>', V));
  await db.exec(readFileSync(new URL('../sql/002_vsechny_platne.sql', import.meta.url), 'utf8'));
});

test('002: vsechny_platne má výchozí false, jde nastavit a skript ho dostane', async () => {
  const g = (await jako(B, `insert into kalibrace.skupiny (nazev) values ('Manometry') returning vsechny_platne`)).rows[0];
  assert.equal(g.vsechny_platne, false);
  await chyba(jako(B, `update kalibrace.skupiny set vsechny_platne = null`), /null value/);
  await jako(B, `update kalibrace.skupiny set vsechny_platne = true where nazev = 'Manometry'`);
  const token = 'token-b-' + 'y'.repeat(40);
  await jako(B, `insert into kalibrace.nastaveni (token_hash) values ($1)`, [createHash('sha256').update(token).digest('hex')]);
  const d = (await jako('anon', `select kalibrace.upozorneni_data($1) d`, [token])).rows[0].d;
  assert.equal(d.skupiny.find((x) => x.nazev === 'Manometry').vsechny_platne, true);
  // 002 rollback a znovu 002
  await db.exec(readFileSync(new URL('../sql/002_rollback.sql', import.meta.url), 'utf8'));
  assert.equal((await db.query(`select count(*)::int c from information_schema.columns where table_schema = 'kalibrace' and column_name = 'vsechny_platne'`)).rows[0].c, 0);
  await db.exec(readFileSync(new URL('../sql/002_vsechny_platne.sql', import.meta.url), 'utf8'));
  await jako(B, `delete from kalibrace.skupiny where nazev = 'Manometry'`);
  await jako(B, `delete from kalibrace.nastaveni`); // úklid pro další testy
});

test('správce dostal kalibrace, ostatní hodnoty zůstaly; jiné profily beze změny', async () => {
  const r = (await db.query(`select id, aplikace from public.profily order by id`)).rows;
  assert.deepEqual(Object.fromEntries(r.map((x) => [x.id, x.aplikace])), {
    [V]: ['app1', 'app2', 'app3', 'kalibrace'], [B]: ['kalibrace'], [C]: ['app1'], [D]: ['kalibrace']
  });
  const k = (await db.query(`select obj_description('kalibrace'::regnamespace) k`)).rows[0].k;
  assert.equal(k, 'Evidence kalibrací – vm73-prace/kalibrace');
});

let gV, pV;
test('vlastník se doplní sám a uživatel vidí svoje data', async () => {
  gV = (await jako(V, `insert into kalibrace.skupiny (nazev, typ) values ('Anemometry', 'anemometr') returning id, owner, min_platnych`)).rows[0];
  assert.equal(gV.owner, V); assert.equal(gV.min_platnych, 1);
  pV = (await jako(V, `insert into kalibrace.pristroje (skupina_id, model, vyrobni_cislo) values ($1, '417', 'SN1') returning *`, [gV.id])).rows[0];
  assert.equal(pV.interval_mesicu, 12); assert.equal(pV.doba_v_lab_dni, 14); assert.equal(pV.predstih_dni, null); assert.equal(pV.stav, 'aktivni');
  await jako(V, `insert into kalibrace.kalibrace (pristroj_id, datum_kalibrace, platnost_do) values ($1, '2026-01-10', '2027-01-10')`, [pV.id]);
  await jako(V, `insert into kalibrace.nastaveni (email_upozorneni) values ('v@example.com')`);
  assert.equal((await jako(V, `select predstih_dni_vychozi from kalibrace.nastaveni`)).rows[0].predstih_dni_vychozi, 30);
  assert.equal(await pocet(V, 'kalibrace.kalibrace'), 1);
});

test('cizí uživatel nevidí ani nezmění cizí data', async () => {
  for (const t of ['skupiny', 'pristroje', 'kalibrace', 'nastaveni']) assert.equal(await pocet(B, 'kalibrace.' + t), 0, t);
  assert.equal((await jako(B, `update kalibrace.pristroje set technik = 'X'`)).affectedRows, 0);
  assert.equal((await jako(B, `delete from kalibrace.skupiny`)).affectedRows, 0);
  await chyba(jako(B, `insert into kalibrace.skupiny (owner, nazev) values ('${V}', 'podvrh')`), /row-level security/);
  await chyba(jako(B, `insert into kalibrace.pristroje (skupina_id, model, vyrobni_cislo) values ($1, 'x', 'SN9')`, [gV.id]), /foreign key/);
  await chyba(jako(B, `insert into kalibrace.kalibrace (pristroj_id, datum_kalibrace, platnost_do) values ($1, '2026-01-01', '2027-01-01')`, [pV.id]), /foreign key/);
});

test('bez kalibrace v profily.aplikace nebo s neaktivním účtem nic', async () => {
  for (const kdo of [C, D]) {
    await chyba(jako(kdo, `insert into kalibrace.skupiny (nazev) values ('x')`), /row-level security/);
    assert.equal(await pocet(kdo, 'kalibrace.skupiny'), 0);
  }
});

test('anonym nemá přístup k tabulkám ani k funkci smi()', async () => {
  await chyba(jako('anon', `select * from kalibrace.pristroje`), /permission denied/);
  await chyba(jako('anon', `insert into kalibrace.skupiny (nazev) values ('x')`), /permission denied/);
  await chyba(jako('anon', `select kalibrace.smi()`), /permission denied/);
  await chyba(jako(B, `select kalibrace.upozorneni_data('x')`), /permission denied/); // přihlášený ji nepotřebuje
});

test('kontroly dat', async () => {
  await chyba(jako(V, `insert into kalibrace.pristroje (skupina_id, model, vyrobni_cislo) values ($1, '417', 'SN1')`, [gV.id]), /duplicate key/);
  const gB = (await jako(B, `insert into kalibrace.skupiny (nazev) values ('B') returning id`)).rows[0];
  await jako(B, `insert into kalibrace.pristroje (skupina_id, model, vyrobni_cislo) values ($1, '417', 'SN1')`, [gB.id]); // stejné SN u jiného uživatele je OK
  await chyba(jako(V, `insert into kalibrace.kalibrace (pristroj_id, datum_kalibrace, platnost_do) values ($1, '2026-05-01', '2026-04-01')`, [pV.id]), /check/);
  await chyba(jako(V, `update kalibrace.pristroje set stav = 'ztraceno'`), /check/);
  await chyba(jako(V, `update kalibrace.skupiny set min_platnych = 0`), /check/);
  await chyba(jako(V, `update kalibrace.nastaveni set token_hash = 'tajne'`), /check/);
});

test('skript upozornění: data jen s platným tokenem a jen vlastníka', async () => {
  const token = 'test-token-' + 'x'.repeat(40);
  const hash = createHash('sha256').update(token).digest('hex');
  await jako(V, `update kalibrace.nastaveni set token_hash = $1`, [hash]);
  const d = (await jako('anon', `select kalibrace.upozorneni_data($1) d`, [token])).rows[0].d;
  assert.equal(d.nastaveni.email_upozorneni, 'v@example.com');
  assert.equal(d.skupiny.length, 1); assert.equal(d.pristroje.length, 1); assert.equal(d.kalibrace.length, 1);
  assert.ok(d.pristroje.every((p) => p.owner === V)); // data uživatele B tam nejsou
  assert.ok(!('token_hash' in d.nastaveni));
  await chyba(jako('anon', `select kalibrace.upozorneni_data('spatny')`), /neplatný token/);
  await chyba(jako('anon', `select kalibrace.upozorneni_data(null)`), /neplatný token/);
  // odebraná appka → token přestane platit
  await db.query(`update public.profily set aplikace = array_remove(aplikace, 'kalibrace') where id = $1`, [V]);
  await chyba(jako('anon', `select kalibrace.upozorneni_data($1)`, [token]), /neplatný token/);
  await db.query(`update public.profily set aplikace = array_append(aplikace, 'kalibrace') where id = $1`, [V]);
});

test('mazání: skupina s přístroji ne, přístroj smaže i kalibrace', async () => {
  await chyba(jako(V, `delete from kalibrace.skupiny where id = $1`, [gV.id]), /foreign key/);
  await jako(V, `delete from kalibrace.pristroje where id = $1`, [pV.id]);
  assert.equal((await db.query(`select count(*)::int c from kalibrace.kalibrace where owner = $1`, [V])).rows[0].c, 0);
  assert.equal((await jako(V, `delete from kalibrace.skupiny where id = $1`, [gV.id])).affectedRows, 1);
});

test('úložiště: soukromé buckety kalibrace-*, soubory jen ve vlastní složce', async () => {
  const b = (await db.query(`select id, public, file_size_limit from storage.buckets where id like 'kalibrace-%' order by id`)).rows;
  assert.deepEqual(b, [{ id: 'kalibrace-fotky', public: false, file_size_limit: 1048576 }, { id: 'kalibrace-protokoly', public: false, file_size_limit: 10485760 }]);
  await jako(V, `insert into storage.objects (bucket_id, name) values ('kalibrace-protokoly', '${V}/p1.pdf'), ('kalibrace-fotky', '${V}/f1.jpg')`);
  await chyba(jako(V, `insert into storage.objects (bucket_id, name) values ('kalibrace-protokoly', '${B}/podvrh.pdf')`), /row-level security/);
  await chyba(jako(V, `insert into storage.objects (bucket_id, name) values ('kalibrace-protokoly', 'bez-slozky.pdf')`), /row-level security/);
  await chyba(jako(C, `insert into storage.objects (bucket_id, name) values ('kalibrace-protokoly', '${C}/x.pdf')`), /row-level security/);
  assert.equal(await pocet(V, 'storage.objects'), 2);
  assert.equal(await pocet(B, 'storage.objects'), 0);
  await chyba(jako(B, `delete from storage.objects`), /Direct deletion/); // Supabase maže soubory jen přes Storage API
  // politika jiné appky pro její bucket funguje dál
  await jako(C, `insert into storage.objects (bucket_id, name) values ('app1-fotky', '${C}/s.jpg')`);
});

test('žádná funkce v kalibrace není spustitelná pro PUBLIC; per-schema default privileges nestačí', async () => {
  const verejne = (await db.query(`select p.proname from pg_proc p where p.pronamespace = 'kalibrace'::regnamespace
    and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))`)).rows;
  assert.deepEqual(verejne, []);
  // Dokumentace chování Postgresu: nová funkce je i přes `alter default privileges in schema … revoke … from public`
  // spustitelná všem → proto pojistka na konci každé migrace (viz 001_init.sql).
  await db.exec(`alter default privileges in schema kalibrace revoke execute on functions from public;
    create function kalibrace.nova() returns int language sql as 'select 1'`);
  assert.equal((await jako('anon', `select kalibrace.nova() n`)).rows[0].n, 1);
  await db.exec(`drop function kalibrace.nova()`);
});

const ROLLBACK = readFileSync(new URL('../sql/001_rollback.sql', import.meta.url), 'utf8').replaceAll('<UUID_SPRAVCE>', V);
test('rollback: s neprázdnými buckety odmítne a nic nezmění', async () => {
  await chyba(db.exec(ROLLBACK), /nejsou prázdné/);
  await db.exec('rollback');
  assert.equal((await db.query(`select count(*)::int c from pg_namespace where nspname = 'kalibrace'`)).rows[0].c, 1);
  assert.equal((await db.query(`select count(*)::int c from storage.buckets where id like 'kalibrace-%'`)).rows[0].c, 2);
});

test('rollback: vrátí vše a ostatní appky nechá být; migrace jde pak spustit znovu', async () => {
  await db.exec(`begin; set local storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id like 'kalibrace-%'; commit;`);
  await db.exec(ROLLBACK);
  const q = async (sql) => (await db.query(sql)).rows;
  assert.deepEqual(await q(`select nspname from pg_namespace where nspname = 'kalibrace'`), []);
  assert.deepEqual(await q(`select id from storage.buckets order by id`), [{ id: 'app1-fotky' }]);
  assert.deepEqual(await q(`select policyname from pg_policies where schemaname = 'storage'`), [{ policyname: 'app1 - nahrani souboru' }]);
  assert.deepEqual((await q(`select aplikace from public.profily where id = '${V}'`))[0].aplikace, ['app1', 'app2', 'app3']);
  assert.deepEqual((await q(`select aplikace from public.profily where id = '${B}'`))[0].aplikace, ['kalibrace']); // jiné profily beze změny
  assert.equal((await q(`select count(*)::int c from storage.objects where bucket_id = 'app1-fotky'`))[0].c, 1); // soubor jiné appky zůstal
  await db.exec(readFileSync(new URL('../sql/001_init.sql', import.meta.url), 'utf8').replaceAll('<UUID_SPRAVCE>', V));
  assert.deepEqual((await q(`select aplikace from public.profily where id = '${V}'`))[0].aplikace, ['app1', 'app2', 'app3', 'kalibrace']);
});
