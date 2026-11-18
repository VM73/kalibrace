# Supabase – kalibrace ve sdíleném projektu „servisní záznamy“

Projekt `pqehuuamgecmdmrdhmza` sdílí další appky (viz interní podklady). Kalibrace má **vlastní schéma `kalibrace`**
a buckety `kalibrace-protokoly`, `kalibrace-fotky`; na nic ostatního nesahá. Klíč `service_role` se nepoužívá nikde.

| Soubor | Co dělá |
| --- | --- |
| `000_pruzkum.sql` | jen čte: struktura `profily`, politiky, funkce, buckety (podklad pro migraci) |
| `001_init.sql` | schéma `kalibrace`, tabulky, RLS, funkce pro skript, buckety, `'kalibrace'` do `profily.aplikace` správce. **Spuštěno 2026-11-14** jako migrace `kalibrace_001_init`. |
| `002_vsechny_platne.sql` | sloupec `skupiny.vsechny_platne`. **Spuštěno 2026-11-14** jako migrace `kalibrace_002`. Rollback `002_rollback.sql`. |
| `001_rollback.sql` | vrátí `001_init.sql`: smaže schéma (i data!), politiky „kalibrace - …“, prázdné buckety a `'kalibrace'` z profilu. Neprázdné buckety odmítne. |

## Postup (etapa 3)

1. **Migrace:** ✅ hotovo (spuštěno přes Supabase konektor, je v Database → Migrations jako `kalibrace_001_init`).
   Ručně by to bylo: SQL Editor → vložit `sql/001_init.sql` → Run (jedna transakce).
2. **Zpřístupnit schéma pro Data API:** **Project Settings → Data API** (v novějším rozhraní *Integrations → Data API → Settings*)
   → **Exposed schemas** → přidej `kalibrace` (ostatní nech) → **Save**. Bez toho appka i skript dostanou chybu `PGRST106` / „Invalid schema“.
3. **Kontrola v Dashboardu:**
   - **Table Editor** → přepni schéma na `kalibrace`: 4 tabulky, u každé *RLS enabled*.
   - **Storage:** buckety `kalibrace-protokoly` a `kalibrace-fotky`, oba *Private*.
   - **Advisors → Security Advisor:** žádná nová chyba u schématu `kalibrace`.
4. **Klíče pro appku (etapa 4):** Project Settings → **API Keys** → **Project URL** a **Publishable key**. Oba jsou veřejné, přijdou do `app.js`
   (`supabase.schema('kalibrace')`).

## Ověření z PowerShellu: anonym nevidí data

```powershell
$url = 'https://pqehuuamgecmdmrdhmza.supabase.co'; $key = 'sb_publishable_XXXX'
try {
  $r = Invoke-RestMethod "$url/rest/v1/pristroje?select=id" -Headers @{ apikey = $key; 'Accept-Profile' = 'kalibrace' }
  "POZOR – anonym dostal data: $($r | ConvertTo-Json -Compress)"
} catch {
  "Status: $($_.Exception.Response.StatusCode.value__)"
  $_.ErrorDetails.Message
}
```

Správně: **Status 401** a `permission denied for table pristroje` (42501). Status 406 a `PGRST106` znamená, že chybí krok 2.

## Token pro skript upozornění (až v etapě 6)

Skript nepoužívá `service_role`. Volá funkci `kalibrace.upozorneni_data(token)` s publishable klíčem a vlastním tokenem.
Funkce vrátí jen data kalibrací vlastníka tokenu (a jen dokud má v `profily.aplikace` hodnotu `kalibrace` a aktivní účet).
V databázi je jen SHA-256 tokenu.

1. Vygeneruj token, ulož ho rovnou do GitHub Secrets (`KALIBRACE_NOTIFY_TOKEN`) a vypiš jen jeho hash. PowerShell ve složce projektu:

   ```powershell
   cd C:\Projekty\kalibrace
   try {
     $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
     $token = [Convert]::ToBase64String($b) -replace '[+/=]', ''
     $hash = -join ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($token)) | ForEach-Object { $_.ToString('x2') })
     $token | gh secret set KALIBRACE_NOTIFY_TOKEN; if ($LASTEXITCODE) { throw "gh secret set skončil kódem $LASTEXITCODE" }
     Remove-Variable token; "Token je v GitHub Secrets. Hash do SQL: $hash"
   } catch { "CHYBA: $($_.Exception.Message)" }
   ```

2. Ostatní secrets (URL a publishable key jsou veřejné; SMTP údaje pracovní schránky – heslo se zeptá interaktivně).
   Při přechodu z dočasného Gmailu na firemní Exchange se mění **4 secrets: HOST, PORT (465 → 587), USER, PASSWORD** – postup v [README](../README.md#výměna-smtp-za-firemní-účet):

   ```powershell
   try {
     gh secret set KALIBRACE_SUPABASE_URL --body 'https://pqehuuamgecmdmrdhmza.supabase.co'
     gh secret set KALIBRACE_SUPABASE_PUBLISHABLE_KEY --body 'sb_publishable_6SgwttYu1LHUrAeInwv1Qw_chrfScN7'
     gh secret set KALIBRACE_SMTP_HOST --body '<pracovní SMTP server – viz interní podklady>' # pracovní Exchange
     gh secret set KALIBRACE_SMTP_PORT --body '587'                      # STARTTLS + AUTH LOGIN (dočasný Gmail má 465 = SSL)
     gh secret set KALIBRACE_SMTP_USER --body '<pracovní adresa>'        # přihlašovací jméno, zároveň odesílatel
     gh secret set KALIBRACE_SMTP_PASSWORD                            # zeptá se na heslo, nezobrazí ho
     gh secret list
   } catch { "CHYBA: $($_.Exception.Message)" }
   ```

3. Hash ulož v SQL Editoru (dosaď hash z kroku 1); příjemce upozornění nastav v appce (Nastavení → E-mail):

   ```sql
   insert into kalibrace.nastaveni (owner, token_hash)
   values ('<UUID_SPRAVCE>', '<hash>')  -- skutečné UUID v interních podkladech
   on conflict (owner) do update set token_hash = excluded.token_hash;
   ```

Výměna tokenu = zopakovat kroky 1–3. Zrušení = `update kalibrace.nastaveni set token_hash = null;`.

## Lokální test migrace

`npm run test:sql` spustí `001_init.sql` na PGlite (Postgres v Node) se stuby `auth`, `storage`, `extensions` a `public.profily`
podle skutečného průzkumu a ověří RLS, roli `profily.aplikace`, funkci pro skript, buckety i to, že politika jiné appky pro její bucket dál funguje.
