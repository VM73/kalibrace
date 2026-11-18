-- 002_rollback.sql – vrátí 002_vsechny_platne.sql (smaže volbu u všech skupin).
-- Pozor: appka verze 4+ sloupec posílá; po rollbacku ukládání skupin selže, dokud se nevrátí i appka.
alter table kalibrace.skupiny drop column if exists vsechny_platne;
