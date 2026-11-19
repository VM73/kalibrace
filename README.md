# Kalibrace

Evidence měřicích přístrojů HVAC servisu: platnost kalibrací (semafor), skupiny zastupitelných přístrojů,
kalibrační protokoly (PDF / foto) a e-mailová upozornění před koncem platnosti.

- **Appka:** https://vm73-prace.github.io/kalibrace/ (ukázková data bez přihlášení: [`?demo=1`](https://vm73-prace.github.io/kalibrace/?demo=1))
- **Stack:** vanilla HTML/CSS/JS bez build kroku (PWA), Supabase (sdílený projekt „servisní záznamy“, schéma `kalibrace`),
  GitHub Pages, GitHub Actions + Python pro upozornění.
- Pravidla vývoje a stav projektu: [`CLAUDE.md`](CLAUDE.md), původní zadání: [`ZADANI.md`](ZADANI.md).

## Používání

1. **iPhone:** otevři appku v Safari → tlačítko Sdílet → **Přidat na plochu**. Pak se spouští jako samostatná aplikace.
   **PC:** stačí prohlížeč (Chrome / Edge nabídnou i instalaci).
2. Přihlášení e-mailem a heslem (účet ze servisních appek). Registrace je vypnutá, přístup dává správce:
   uživatel musí mít v `public.profily.aplikace` hodnotu `kalibrace` a aktivní účet.
3. **Přehled:** souhrn po skupinách, karty přístrojů se semaforem (zelená platná, oranžová brzy vyprší,
   červená propadlá / bez kalibrace, modrá na kalibraci). Filtr *Jen problémy*, přepínač *Zobrazit vyřazené*.
4. **Skupiny:** kusy, které se navzájem zastupují (např. 3× Testo 417). *Min. platných* = kolik kusů musí mít platnou
   kalibraci; volba *Každý kus musí mít platnou kalibraci* vyžaduje všechny aktivní kusy. „Na řadě“ ukazuje, který kus poslat příště.
5. **Detail přístroje:** protokol **Otevřít** (podepsaný odkaz, 10 min) a **Sdílet** (nabídka iOS: Mail, WhatsApp…),
   historie kalibrací, Přidat kalibraci / Odeslat na kalibraci / Upravit / Vyřadit (mazání jen u vyřazených, dvojí klepnutí).
6. **Nastavení:** e-mail pro upozornění (příjemce), výchozí předstih, odhlášení, číslo verze.

### Diagnostika

- Číslo verze je v patičce a v Nastavení (`verze N`); po nasazení musí odpovídat `VERZE` v `app.js`.
- `?debug=1` (např. https://vm73-prace.github.io/kalibrace/?debug=1) zapne panel s logem: každá odpověď Supabase se statusem
  a chybou (bez tokenů), chyby JS v červeném rámečku. Při potížích pošli jeho obsah.
- Když se nová verze neprojeví: zavřít a znovu otevřít appku (service worker načítá síť první, cache jen offline).

## Nasazení

- **Appka:** každý push do větve `main` = nová verze na GitHub Pages (Settings → Pages → *Deploy from a branch*, `main`, `/ (root)`),
  obvykle do 1 minuty. Při změně zvýšit `VERZE` v `app.js` a `CACHE` v `sw.js`.
- **Databáze:** migrace v [`sql/`](sql/README.md), spouštějí se přes Supabase jako `kalibrace_NNN`; ke každé je rollback.
  Na tabulky ostatních appek ve sdíleném Supabase projektu (viz interní podklady) se nesahá.
- **Kontrola nasazení (PowerShell):**

  ```powershell
  try {
    $r = Invoke-WebRequest 'https://vm73-prace.github.io/kalibrace/app.js' -UseBasicParsing
    ($r.Content -split "`n" | Select-String 'var VERZE').ToString()
    gh api repos/vm73-prace/kalibrace/pages/builds/latest --jq '.status, .updated_at'
  } catch {
    "Status: $($_.Exception.Response.StatusCode.value__)"; $_.ErrorDetails.Message
  }
  ```

## Jak přidat / vyměnit správce

Appka má zatím jediného uživatele; data patří účtu ve sloupci `owner` (RLS: `owner = auth.uid()` a `kalibrace.smi()`).
Konkrétní UUID, e-maily a hotové skripty patří jen do interních podkladů, ne do tohoto repa.

1. **Účet:** Supabase → *Authentication → Users → Add user* (e-mail + heslo; registrace v appce je vypnutá).
2. **Přístup:** v `public.profily` musí mít účet aktivní profil a v poli `aplikace` hodnotu `'kalibrace'`
   (přidat k existujícím hodnotám, ostatní appky ve sdíleném projektu nechat beze změny). Tím je **přidání** správce hotové;
   nový účet začíná s prázdnou evidencí.
3. **Výměna (převod dat ze starého účtu):**
   - Novým účtem se do appky **nepřihlašovat**, dokud data nejsou převedená (uložení Nastavení by založilo druhý řádek `nastaveni`).
   - **Soubory:** skriptem zkopírovat obsah složky `<staré uid>/` v bucketech `kalibrace-protokoly` a `kalibrace-fotky`
     do `<nové uid>/` (přihlášení oběma účty, bez service_role; ověřit velikost a SHA-256, staré soubory zatím nemazat).
   - **Databáze:** jeden SQL příkaz s CTE (složené cizí klíče `(…, owner)` nejsou odložitelné, postupné updaty po tabulkách selžou):
     změnit `owner` ve `skupiny`, `pristroje`, `kalibrace`, `nastaveni` a prefix `<uid>/` v `protokol_path` a `foto_path`.
     Předem kontrola, že nový účet nemá žádné řádky; potom kontrola počtů (starý účet 0). Připravit rollback a vše
     otestovat na PGlite. Token upozornění jde s řádkem `nastaveni`, appka ani skript upozornění se nemění.
   - **Ověření:** přihlásit se novým účtem (PC, iPhone), otevřít fotku a protokol; ruční běh `kontrola.yml` s `dry_run`.
   - **Úklid:** starému účtu odebrat `'kalibrace'` z `profily.aplikace` a smazat jeho složky v obou bucketech
     (vč. souborů, na které DB neodkazuje). Po smazání už rollback nejde.

## E-mailová upozornění

- Workflow [`.github/workflows/kontrola.yml`](.github/workflows/kontrola.yml) denně v 5:00 UTC (6:00 v zimě / 7:00 v létě)
  spustí [`scripts/kontrola.py`](scripts/kontrola.py). E-mail přijde, když skupině (nebo kusu v nezelené skupině) zbývá
  právě *předstih + doba v laboratoři*, 14, 7, 1 nebo 0 dní, a každé pondělí souhrn, pokud je něco oranžové nebo červené.
- Data čte funkce `kalibrace.upozorneni_data` s vlastním tokenem (v databázi jen jeho SHA-256), **žádný service_role**.
- Příjemce se bere z appky (Nastavení → E-mail), ne z repa. Log v Actions je veřejný, proto neobsahuje výrobní čísla, jména ani e-maily.
- **Ruční běh:** GitHub → Actions → *Kontrola kalibrací* → *Run workflow*:
  `dry_run` = jen vypíše důvody a předmět; `test_email` = pošle jeden zkušební e-mail bez ohledu na pravidla.
  Z PowerShellu: `gh workflow run kontrola.yml -f dry_run=false -f test_email=true`.

### GitHub Secrets (jen názvy, hodnoty nikdy do repa)

| Secret | Obsah |
| --- | --- |
| `KALIBRACE_SUPABASE_URL` | URL projektu Supabase |
| `KALIBRACE_SUPABASE_PUBLISHABLE_KEY` | publishable klíč (veřejný) |
| `KALIBRACE_NOTIFY_TOKEN` | token pro `kalibrace.upozorneni_data` (vygenerování a výměna: [sql/README.md](sql/README.md#token-pro-skript-upozornění-až-v-etapě-6)) |
| `KALIBRACE_SMTP_HOST` | server odchozí pošty |
| `KALIBRACE_SMTP_PORT` | port (587 = STARTTLS, 465 = SSL) |
| `KALIBRACE_SMTP_USER` | přihlašovací jméno = odesílatel |
| `KALIBRACE_SMTP_PASSWORD` | heslo schránky |

Skript se nikdy nepřihlásí bez úspěšného STARTTLS (žádný fallback na nešifrované spojení) a ověřuje certifikát
i jméno serveru. Hlídají to testy v [`tests/test_kontrola.py`](tests/test_kontrola.py) proti lokálnímu SMTP serveru.

### Výměna SMTP za firemní účet

Zatím se odesílá dočasně přes Gmail. Firemní schránka (Exchange): **pracovní SMTP server – viz interní podklady, port 587, STARTTLS + AUTH LOGIN**.
Až IT dodá účet, přepiš **4 secrets: HOST, PORT, USER a PASSWORD** – i port se mění, z 465 (Gmail, SSL) na **587** (Exchange, STARTTLS).
Heslo se zadá interaktivně a nezobrazí se. Pak pošli zkušební e-mail:

```powershell
cd C:\Projekty\kalibrace
try {
  gh secret set KALIBRACE_SMTP_HOST --body '<pracovní SMTP server – viz interní podklady>'; if ($LASTEXITCODE) { throw 'HOST' }
  gh secret set KALIBRACE_SMTP_PORT --body '587';                     if ($LASTEXITCODE) { throw 'PORT' }  # dřív 465 (Gmail)
  gh secret set KALIBRACE_SMTP_USER --body '<firemní adresa>';        if ($LASTEXITCODE) { throw 'USER' }
  gh secret set KALIBRACE_SMTP_PASSWORD;                              if ($LASTEXITCODE) { throw 'PASSWORD' }
  gh workflow run kontrola.yml -f dry_run=false -f test_email=true;   if ($LASTEXITCODE) { throw 'workflow' }
  "Hotovo – za minutu zkontroluj: gh run list --workflow kontrola.yml --limit 1"
} catch { "CHYBA u kroku: $($_.Exception.Message)" }
```

Když běh selže, log je v Actions u běhu (a jako artefakt `kontrola-log`). Typické příčiny: špatné heslo
(`SMTPAuthenticationError`), server bez STARTTLS nebo s neplatným certifikátem (skript odmítne pokračovat).

### Keepalive plánovaného běhu

GitHub ve **veřejném** repu automaticky vypíná plánovaná workflow po 60 dnech bez aktivity v repu (žádný push apod.) –
upozornění by pak potichu přestala chodit. Proto [`.github/workflows/keepalive.yml`](.github/workflows/keepalive.yml)
1. den v měsíci (cron `41 4 1 * *`) zavolá API *enable workflow* pro `kontrola.yml` i pro sebe – jen s `GITHUB_TOKEN`
(`permissions: actions: write`), bez osobního tokenu a bez prázdných commitů. Ručně: Actions → *Keepalive plánovaných běhů* → *Run workflow*.
Kontrola: u workflow *Kontrola kalibrací* nesmí být „This scheduled workflow is disabled“; když je, tlačítko *Enable workflow*.

## Vývoj a testy

```powershell
cd C:\Projekty\kalibrace
npm install; pip install -r requirements.txt
npm run serve   # http://localhost:8123 (s ?demo=1 bez Supabase, s ?debug=1 log)
npm test        # Node (výpočty, SQL na PGlite) + Python (skript upozornění) + Playwright (demo i Supabase mock)
```

| Část | Kde |
| --- | --- |
| Appka | `index.html`, `app.css`, `app.js`, `calc.js` (čisté výpočty, sdílené testy), `demo.js`, `sw.js`, `manifest.json`, ikony |
| Databáze | `sql/` (průzkum, migrace, rollbacky, návod) |
| Upozornění | `scripts/kontrola.py`, `requirements.txt`, `.github/workflows/kontrola.yml` |
| Testy | `tests/cases.json` (společné případy Node + Python), `calc.test.mjs`, `sql.test.mjs`, `test_kontrola.py`, `e2e.spec.mjs`, `supabase.spec.mjs` |

## Limity a náklady

- **Supabase (free tier, sdílený projekt):** data v kB, fotky ~50 kB, protokoly obvykle 0,2–2 MB (limit 10 MB / soubor), Storage 1 GB.
- **GitHub:** Pages zdarma; Actions ~1 min denně (veřejné repo zdarma). Naplánované workflow GitHub vypne po 60 dnech bez
  aktivity v repu – pak stačí v Actions kliknout *Enable workflow*.
- **E-mail:** pár zpráv týdně.
