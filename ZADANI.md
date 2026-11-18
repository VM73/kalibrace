# Mega prompt – Evidence kalibrací měřicích přístrojů

Nov 14, 2026 · @Vladan Marek

**Jak použít:** Založ složku , otevři v ní Claude Code a vlož celý text od nadpisu „Role a pravidla práce“ níž. Claude Code ho pak uloží jako `CLAUDE.md` do repa, aby platil i v dalších sezeních.

---

> **Změny proti původnímu zadání (2026-11-14):** sdílený Supabase projekt „servisní záznamy“ místo nového; vlastní schéma `kalibrace`; buckety `kalibrace-*`; přístup podle `profily.aplikace`; skript upozornění bez service\_role. Platná pravidla a konvence pojmenování jsou v `CLAUDE.md`.

## Role a pravidla práce

Jsi zkušený vývojář mobilních webových appek. Stavíš appku pro Vladana, servisního technika a vedoucího HVAC servisu (Windows, PowerShell, GitHub účet `VM73`, appky hostuje na GitHub Pages).

Pravidla:

1. **Nejdřív otázky, pak kód.** Před začátkem polož jedno kolo otázek (max 4, u každé doporučená volba první) jen na to, co v tomto zadání chybí (viz „Otázky na začátek“). U drobných oprav se neptej, napiš předpoklady.
2. **Každou práci začni blokem „Zadání:“** (2–4 řádky včetně kritéria hotovo).
3. **Jednoduchost:** nejmenší řešení, které splní zadání. Žádné funkce do zásoby, žádné frameworky navíc.
4. **Chirurgické změny:** měň jen to, co úkol vyžaduje. Velké soubory edituj cílenými záměnami, ne přepisem.
5. **Diagnostika od první verze** (debug režim, logy, verze), viz níže.
6. **Ověřitelný cíl:** před prací stanov, jak se pozná hotovo, a iteruj, dokud to neplatí. Po každé změně spusť celou sadu testů.
7. **Dopad na kredity a limity:** u každé úpravy zvaž a v souhrnu oznam dopad na Claude (tokeny), GitHub (Actions minuty, Pages), Supabase (DB, Storage, free tier) a e-mail. Když se nic nemění, napiš „bez dopadu“.
8. Komunikuj česky, stručně, v číslovaných krocích. U nasazení uveď **přesné PowerShell příkazy** (s `try/catch`, který vypíše status i tělo chyby) a řekni, kam kliknout v GitHubu a Supabase.
9. Tajné klíče (service\_role, hesla, app password) **nikdy** do kódu appky ani do repa, jen do GitHub Secrets / `.env` (v `.gitignore`).

## Zadání

Jednoduchá evidence měřicích přístrojů HVAC servisu. Hlídá platnost kalibrací, ukazuje ji semaforem, posílá e-mailová upozornění s nastavitelným předstihem a ukládá kalibrační protokoly (PDF), aby šly okamžitě doložit zákazníkovi nebo instituci.

**Hotovo (MVP)** = na iPhonu i PC na první pohled vidím, které přístroje a skupiny mají platnou kalibraci a kolik zbývá; protokol otevřu nebo pošlu do 10 s; před koncem platnosti mi přijde e-mail; všechny testy projdou.

## Uživatel a prostředí

- Zatím jediný uživatel: Vladan. Více uživatelů a role zatím ne, ale datový model má sloupec `owner`, aby šlo později rozšířit.
- Mobilní webová appka (PWA) přidaná na plochu iPhonu, použitelná i na PC v prohlížeči. Šířky od 320 px.
- Hosting: GitHub Pages, repo `VM73/kalibrace` (název potvrdit). Všechny soubory appky v **kořeni** repa.

## Přístroje, které evidujeme

| Skupina | Přístroj | Počet | Pravidlo |
| --- | --- | --- | --- |
| Anemometr – lopatkový | Testo 417 | 3 ks | Stačí, aby **1 ks** měl platnou kalibraci. Kalibrace se protáčí: příště se kalibruje kus s nejstarší kalibrací. Rozlišení podle výrobního čísla a jména technika. |
| Balometr (flow hood) | Airflow ProHood PH731 – basic | 1 ks | Sleduje se platnost kalibrace. |
| Detektory úniků chladiva | dle zadání Vladana | ? | Platnost je důležitá, sleduje se u každého kusu. |
| Diferenční manometry | dle zadání Vladana | ? | Sleduje se u každého kusu. |

Přístroje i skupiny musí jít přidávat, upravovat a vyřazovat podle potřeby. Model nesmí být napevno udělaný jen pro anemometry.

## Klíčový koncept: skupina zastupitelných přístrojů

- Každý přístroj patří do **skupiny** s parametrem `min_platnych` (výchozí 1). Skupina o jednom kusu je běžný případ.
- **Stav skupiny:**
  - zelená = počet kusů se zelenou kalibrací ≥ `min_platnych`
  - oranžová = platné kusy existují, ale bez nich by skupina do okna upozornění spadla pod minimum (nejlepší kus brzy vyprší)
  - červená = platných kusů < `min_platnych`
- **„Další na kalibraci“:** aktivní kus skupiny (ne vyřazený, ne právě na kalibraci) s nejstarší nebo chybějící platností. Zobrazit v hlavičce skupiny („Pošli na kalibraci: SN 12345678 – Petr“).
- Okno upozornění počítá s dobou, kdy je přístroj v laboratoři: nový kus musí odejít včas, aby se vrátil dřív, než vyprší ten stávající.
- Propadlý kus ve skupině, která je zelená, se zobrazí šedě nebo tlumeně, ne alarmující červenou.
- **Skupina bez aktivních přístrojů** (jen vyřazené nebo žádné): stav `prazdna`, šedá tečka a „bez přístrojů“; nepočítá se do souhrnu ani do upozornění. Kus na kalibraci je aktivní.
- **„Každý kus musí mít platnou kalibraci“** (`skupiny.vsechny_platne`, výchozí false): min. platných = počet aktivních kusů (bez vyřazených); kus na kalibraci se počítá jako neplatný. Ve formuláři se pole min. platných skryje.

## Výpočet stavu přístroje

Z poslední kalibrace (`platnost_do`, včetně toho dne) a dneška (časová zóna Europe/Prague):

- `zbyva_dni = platnost_do − dnes`
- `okno = predstih_dni + doba_v_lab_dni` (předstih z přístroje, jinak výchozí z nastavení, výchozí 30; doba v laboratoři výchozí 14)
- 🟢 **platná**: `zbyva_dni > okno`
- 🟠 **brzy vyprší**: `0 ≤ zbyva_dni ≤ okno`
- 🔴 **propadlá / bez kalibrace**: `zbyva_dni < 0` nebo žádná kalibrace
- 🔵 **na kalibraci**: stav `na_kalibraci` (zobrazit datum odeslání a očekávaný návrat; po návratu se zadá nová kalibrace a stav se vrátí na aktivní)
- ⚪ **vyřazeno**: v přehledu skryté (přepínač „Zobrazit vyřazené“)

Čisté výpočty (stav přístroje, stav skupiny, další na kalibraci, texty „zbývá 143 dní“ / „propadlá před 12 dny“) dej do samostatného modulu označeného `// <calc>` … `// </calc>`, aby šel testovat v Node. Stejnou logiku použij v Python skriptu pro upozornění a pokryj obojí testy se stejnými případy.

## Stack a architektura

- **Frontend:** vanilla HTML/CSS/JS bez build kroku (Supabase JS z CDN, verze napevno). PWA: `manifest.json`, `sw.js` s verzovanou cache (cachovat jen shell appky, data a PDF ne).
- **Supabase:**
  - Auth: e-mail + heslo, registrace v Supabase vypnuté, uživatele založí Vladan ručně.
  - Projekt: **sdílený „servisní záznamy“** (ref `pqehuuamgecmdmrdhmza`, appky servis, klima, kucharka). Na objekty ostatních appek se nesahá.
  - Postgres: vlastní schéma **`kalibrace`** s tabulkami níže, **RLS na všech tabulkách**: `owner = auth.uid()` **a** aktivní profil s hodnotou `'kalibrace'` v `public.profily.aplikace`. Granty jen pro `authenticated`. Schéma přidat do *Data API → Exposed schemas*, v appce `supabase.schema('kalibrace')`.
  - Storage: privátní buckety `kalibrace-protokoly` (PDF / JPG, max 10 MB) a `kalibrace-fotky` (miniatury). Přístup přes podepsané URL, cesta `<uid>/<soubor>`, politiky podle ownera a `profily.aplikace`.
  - Do appky jen publishable / anon klíč.
  - Free tier: Supabase povoluje 2 aktivní projekty → nový projekt se nezakládá.
- **Upozornění:** GitHub Actions workflow (denní cron) spustí Python skript, který přes Supabase REST zavolá funkci `kalibrace.upozorneni_data(token)` (security definer, publishable klíč + vlastní token v GitHub Secrets, **nikdy service\_role**), dostane jen data kalibrací, spočítá stavy a pošle e-mail z **pracovní schránky přes SMTP** (údaje jen v GitHub Secrets `KALIBRACE_SMTP_*`; pravidlo „appka připravená k předání“ – žádný osobní Gmail). Denní dotaz zároveň brání automatickému pozastavení Supabase projektu kvůli nečinnosti.

## Datový model (návrh, uprav jen s odůvodněním)

Tabulky jsou ve schématu `kalibrace`. `nastaveni` má navíc `token_hash` (SHA-256 tokenu skriptu upozornění).

- `skupiny`: `id`, `owner`, `nazev`, `typ` (anemometr, balometr, detektor\_uniku, dif\_manometr, jiny), `min_platnych` int default 1, `vsechny_platne` bool default false (migrace 002), `poradi`, `created_at`
- `pristroje`: `id`, `owner`, `skupina_id`, `vyrobce`, `model`, `vyrobni_cislo` (unikátní v rámci ownera), `technik`, `interval_mesicu` default 12, `doba_v_lab_dni` default 14, `predstih_dni` null = výchozí, `stav` (aktivni / na\_kalibraci / vyrazeno), `odeslano_dne`, `ocekavany_navrat`, `foto_path`, `poznamka`, `created_at`
- `kalibrace`: `id`, `owner`, `pristroj_id`, `datum_kalibrace`, `platnost_do` (předvyplnit = datum + interval, ale editovatelné podle protokolu), `laborator`, `cislo_protokolu`, `protokol_path`, `cena` (volitelně), `poznamka`, `created_at`
- `nastaveni`: `owner` (PK), `email_upozorneni`, `predstih_dni_vychozi` default 30

SQL dodej jako migraci `sql/001_init.sql` (tabulky, indexy, RLS, storage politiky). Ověř ji, ideálně na lokálním Postgresu se stubem `auth.uid()`.

## Obrazovky

1. **Přehled** (výchozí)
   - Nahoře souhrn: „5 v pořádku · 1 brzy · 0 propadlé“.
   - Sekce podle skupin, v hlavičce stav skupiny a „Další na kalibraci“.
   - Karta přístroje: **miniatura** (fotka, jinak výchozí ikona podle typu), model, výrobní číslo, technik, **barevný štítek** se stavem a textem („zbývá 143 dní“, „propadlá před 12 dny“, „na kalibraci od 3. 11.“).
   - Řazení podle naléhavosti, filtr Vše / Jen problémy.
2. **Detail přístroje:** údaje, aktuální protokol (tlačítka **Otevřít** a **Sdílet**), historie kalibrací, akce Přidat kalibraci / Odeslat na kalibraci / Upravit / Vyřadit. Mazání jen u vyřazených, potvrzení dvojím klepnutím.
3. **Formulář přístroje:** včetně fotky z fotoaparátu (`<input type=file accept=image/* capture>`). Fotku před nahráním zmenši v prohlížeči (cca 400 px, JPEG).
4. **Formulář kalibrace:** datum, platnost (předvyplněná), laboratoř, číslo protokolu, soubor PDF nebo foto protokolu.
5. **Skupiny:** přidat, upravit, nastavit `min_platnych` a pořadí.
6. **Nastavení:** e-mail pro upozornění, výchozí předstih, „Přihlášen jako“, odhlásit, číslo verze.

**Sdílení protokolu:** stáhni PDF z podepsané URL a předej ho přes `navigator.share({ files: [...] })` (iOS nabídka sdílení: Mail, WhatsApp…). Když to prohlížeč neumí, otevři ho v nové záložce.

**Vzhled iOS:** SF Pro font stack, velké nadpisy, seskupené seznamy, světlý i tmavý režim přes CSS proměnné, navigace nahoře (ne spodní lišta s plovoucím tlačítkem). Data česky (`14. 11. 2026`).

## Upozornění e-mailem

- Workflow `.github/workflows/kontrola.yml`: cron denně v 6:00 pražského času (v UTC zohledni letní čas, stačí 5:00 UTC) + `workflow_dispatch` se vstupem `dry_run` (jen vypíše, co by poslal).
- Skript `scripts/kontrola.py` je **bezstavový**. E-mail pošle, když:
  - některý přístroj nebo skupina má právě `zbyva_dni` rovno `okno`, 14, 7, 1 nebo 0, **nebo**
  - je pondělí a existuje cokoli oranžového nebo červeného (týdenní souhrn).
- Obsah e-mailu: předmět „Kalibrace: 1 brzy vyprší, 0 propadlé“; v těle seznam podle skupin, u skupin „Pošli na kalibraci: …“ a odkaz do appky.
- U kusů v zelené skupině se propadlost nehlásí (rotace je záměrná), hlásí se stav skupiny.
- Prázdné skupiny (bez aktivních přístrojů) se nehlásí vůbec.
- Secrets: `KALIBRACE_SUPABASE_URL`, `KALIBRACE_SUPABASE_PUBLISHABLE_KEY`, `KALIBRACE_NOTIFY_TOKEN` (token pro `kalibrace.upozorneni_data`, ne service\_role), `KALIBRACE_SMTP_HOST`, `KALIBRACE_SMTP_PORT`, `KALIBRACE_SMTP_USER`, `KALIBRACE_SMTP_PASSWORD` (pracovní schránka, ne osobní Gmail). Příjemce z `kalibrace.nastaveni.email_upozorneni`.

## Diagnostika (od první verze)

- `?debug=1` zapne panel s logem a chybami JS (červený rámeček), včetně odpovědí Supabase (status a chyba, bez tokenů).
- V patičce a v Nastavení viditelné „verze N“. Při každé změně ji zvyš, stejně jako verzi cache v `sw.js`.
- Python skript: logy s časem do stdout; při chybě nahrát log jako artefakt (`actions/upload-artifact`, `if: failure()`).
- Při chybě nejdřív požádej o skutečný výstup (log, screenshot, konzole), teprve pak oprav. Když přístup selže dvakrát, změň ho a řekni proč.

## Testy

- **Node:** unit testy modulu `<calc>` na pevném „dnes“ (např. 2026-11-14): platná, hranice okna, den vypršení (0), propadlá, bez kalibrace, na kalibraci; skupina 3× Testo s jedním platným → zelená; skupina, kde jediný platný vyprší za 20 dní → oranžová; volba „Další na kalibraci“.
- **Python:** stejné případy pro výpočet stavu + test pravidla „kdy poslat e-mail“ (prahové dny, pondělí).
- **Playwright:** `iPhone 13`, `Pixel 7`, šířky 320 / 390 / 1280, v demo režimu (`?demo=1` s realistickými ukázkovými daty bez Supabase): přehled se vykreslí, barvy štítků sedí, přidání přístroje a kalibrace funguje, nic nepřetéká.
- Po každé změně celá sada. Když test selže, nejdřív zkontroluj, jestli není chyba v testu, a řekni to otevřeně.

## Ikona (s prvním prototypem)

- Pošli 3 návrhy A/B/C v jednom náhledu a zeptej se na výběr. Rodinná barva pracovních appek: přechod **#4a8fd4 → #2c5f94**, bílý jednoduchý symbol na 60–75 % plochy, bez textu, čitelný v 60 px.
- Návrhy motivu: A) ciferník měřidla s fajfkou, B) štítek / visačka s fajfkou, C) kalendář s ručičkou měřidla.
- Sada: `icon-1024.png`, `icon-512.png` (+ maskable), `icon-192.png`, `apple-touch-icon.png` (180), `favicon-32.png`; manifest, `apple-touch-icon`, `theme-color`.

## Postup po etapách

1. Otázky na začátek → blok „Zadání:“.
2. **Prototyp** v demo režimu s ukázkovými daty (3× Testo 417 s rotací, ProHood, 2 detektory, 1 manometr) + 3 ikony → Vladan schválí vzhled.
3. SQL migrace + RLS + storage politiky + návod krok za krokem v Supabase.
4. Napojení appky: přihlášení, CRUD skupin, přístrojů a kalibrací.
5. Fotky a PDF (nahrání, otevření, sdílení).
6. E-mailová upozornění (workflow + skript + test přes `dry_run`).
7. Nasazení na GitHub Pages, `README.md` s návodem a PowerShell příkazy, `CLAUDE.md` v repu.

Každou etapu ukonči souhrnem: co appka teď umí, co nahrát a v jakém pořadí, jak ověřit (verze, `?debug=1`), stav ikony a dopad na limity.

## Otázky na začátek (jen tyto, jedno kolo)

1. Výrobní čísla a technici pro 3× Testo 417 a ProHood a seznam detektorů úniků a diferenčních manometrů (model, výrobní číslo). Případně je zadám až v appce.
2. Nový Supabase projekt, nebo existující s prefixem `kal_`? (Doporučeno: nový, pokud je volný slot.)
3. Výchozí interval kalibrace a doba v laboratoři (doporučeno 12 měsíců a 14 dní, u každého kusu jde změnit).
4. Název repa a e-mail pro upozornění (doporučeno `kalibrace`; odesílá se z pracovní schránky přes SMTP, ne z osobního Gmailu).

## Mimo rozsah v1 (v2 a dál)

QR štítky na přístroje s odkazem na detail a protokol; ZIP export všech platných protokolů; CSV export pro Excel (středník, UTF-8 BOM); více uživatelů a role; push notifikace; export do kalendáře (.ics); evidence předání přístroje mezi techniky.

## Odhad dopadu na kredity a limity

- **Supabase free tier:** DB v řádu kB, PDF a fotky v desítkách MB z 1 GB. Bez Edge Functions. Bez dopadu na placení.
- **GitHub:** Pages zdarma; Actions zhruba 1 min denně, tj. asi 30 min měsíčně (veřejné repo zdarma, soukromé z 2000 min free).
- **SMTP pracovní schránky:** pár e-mailů týdně, bez dopadu.
- **OpenAI / Anthropic API:** nepoužívá se.
- **Claude Code:** hlavní spotřeba při stavbě prototypu a testech. Šetřit cílenými editacemi místo přepisů souborů.
