-- 002_vsechny_platne.sql – volba skupiny „Každý kus musí mít platnou kalibraci“ (migrace kalibrace_002)
-- Jen alter table ve schématu kalibrace. Žádné nové funkce → pojistka EXECUTE pro PUBLIC není potřeba.
-- Když je true, appka i skript upozornění počítají min. platných = počet aktivních kusů (bez vyřazených);
-- kus na kalibraci se počítá jako neplatný. min_platnych zůstává uložené pro případ, že se volba vypne.
-- Rollback: sql/002_rollback.sql

alter table kalibrace.skupiny
  add column vsechny_platne boolean not null default false;

comment on column kalibrace.skupiny.vsechny_platne is 'Každý aktivní kus musí mít platnou kalibraci (min_platnych se ignoruje)';

-- Ať Data API (PostgREST) nový sloupec vidí hned.
notify pgrst, 'reload schema';
