"""Denní kontrola kalibrací a e-mailové upozornění (GitHub Actions, jen standardní knihovna).

Bezstavové: načte data přes kalibrace.upozorneni_data(token) (publishable klíč + vlastní token,
žádný service_role), spočítá stavy stejně jako calc.js a pošle e-mail z pracovní schránky (SMTP), když:
  - skupina (nebo kus v nezelené skupině) má právě zbývá = okno, 14, 7, 1 nebo 0 dní, nebo
  - je pondělí a některá skupina je oranžová nebo červená (týdenní souhrn).
Prázdné skupiny se nehlásí, kusy v zelené skupině (rotace) taky ne.

Použití:
  python scripts/kontrola.py              # ostrý běh (pošle e-mail, když je důvod)
  python scripts/kontrola.py --dry-run    # jen vypíše předmět, důvody a souhrn skupin (bez výrobních čísel)
  python scripts/kontrola.py --nahled f   # zapíše celý text e-mailu do souboru f (lokálně, nic neposílá)
  python scripts/kontrola.py --test-email # pošle jeden zkušební e-mail ([TEST] v předmětu) bez ohledu na pravidla
Proměnné prostředí (GitHub Secrets): KALIBRACE_SUPABASE_URL, KALIBRACE_SUPABASE_PUBLISHABLE_KEY, KALIBRACE_NOTIFY_TOKEN
  a pro ostrý běh KALIBRACE_SMTP_HOST, KALIBRACE_SMTP_PORT (465 = SSL, jinak STARTTLS), KALIBRACE_SMTP_USER,
  KALIBRACE_SMTP_PASSWORD. Odesílatel = KALIBRACE_SMTP_USER, příjemce = kalibrace.nastaveni.email_upozorneni.
Závislost: tzdata (requirements.txt) kvůli Europe/Prague i na Windows.
"""
import json
import os
import smtplib
import ssl
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from email.message import EmailMessage

APP_URL = 'https://vm73.github.io/kalibrace/'
# Konzole Windows (cp1250) neumí všechny znaky – výpis nesmí shodit skript
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(errors='replace')
PRAHY = {14, 7, 1, 0}

# ---------- výpočty (zrcadlo calc.js, testy: tests/test_kontrola.py + tests/cases.json) ----------


def den(iso):
    return date.fromisoformat(str(iso)[:10])


def plus_dni(iso, n):
    return (den(iso) + timedelta(days=n)).isoformat()


def format_datum(iso):
    d = den(iso)
    return f'{d.day}. {d.month}. {d.year}'


def dni(n):
    return '1 den' if n == 1 else (f'{n} dny' if 2 <= n <= 4 else f'{n} dní')


def pred_dny(n):
    return 'před 1 dnem' if n == 1 else f'před {n} dny'


def posledni_kalibrace(kalibrace):
    return max(kalibrace, key=lambda k: (k['datum_kalibrace'], k.get('created_at') or ''), default=None)


def okno(p, nastaveni=None):
    if p.get('predstih_dni') is not None:
        predstih = p['predstih_dni']
    elif nastaveni and nastaveni.get('predstih_dni_vychozi') is not None:
        predstih = nastaveni['predstih_dni_vychozi']
    else:
        predstih = 30
    lab = p['doba_v_lab_dni'] if p.get('doba_v_lab_dni') is not None else 14
    return predstih + lab


def stav_pristroje(p, kalibrace, dnes, nastaveni=None):
    k = posledni_kalibrace(kalibrace)
    w = okno(p, nastaveni)
    zbyva = (den(k['platnost_do']) - den(dnes)).days if k else None
    if p.get('stav') == 'vyrazeno':
        stav, text = 'vyrazeno', 'vyřazeno'
    elif p.get('stav') == 'na_kalibraci':
        stav = 'na_kalibraci'
        text = 'na kalibraci'
        if p.get('odeslano_dne'):
            d = den(p['odeslano_dne'])
            text += f' od {d.day}. {d.month}.'
    elif zbyva is None:
        stav, text = 'bez', 'bez kalibrace'
    elif zbyva < 0:
        stav, text = 'propadla', 'propadlá ' + pred_dny(-zbyva)
    elif zbyva == 0:
        stav, text = 'brzy', 'vyprší dnes'
    else:
        stav = 'platna' if zbyva > w else 'brzy'
        text = ('zbývají ' if 2 <= zbyva <= 4 else 'zbývá ') + dni(zbyva)
    return {'stav': stav, 'zbyva': zbyva, 'okno': w, 'text': text, 'platnost_do': k['platnost_do'] if k else None}


def dalsi_na_kalibraci(polozky):
    best = None
    for x in polozky:
        if x['pristroj'].get('stav', 'aktivni') != 'aktivni':
            continue
        if best is None:
            best = x
            continue
        a, b = x['s']['zbyva'], best['s']['zbyva']
        if b is None:
            continue
        if a is None or a < b:
            best = x
    return best['pristroj'] if best else None


def stav_skupiny(skupina, polozky):
    aktivni = [x for x in polozky if x['s']['stav'] != 'vyrazeno']
    minimum = len(aktivni) if skupina.get('vsechny_platne') else (skupina.get('min_platnych') or 1)
    platne = sorted([x for x in aktivni if x['s']['stav'] in ('platna', 'brzy')], key=lambda x: -x['s']['zbyva'])
    zelene = sum(1 for x in platne if x['s']['stav'] == 'platna')
    if not aktivni:
        stav = 'prazdna'
    elif zelene >= minimum:
        stav = 'zelena'
    elif len(platne) >= minimum:
        stav = 'oranzova'
    else:
        stav = 'cervena'
    rozhod = platne[minimum - 1] if len(platne) >= minimum else None
    dalsi = dalsi_na_kalibraci(aktivni)
    na_kal = any(x['s']['stav'] == 'na_kalibraci' for x in aktivni)
    if not dalsi or stav == 'prazdna':
        vyzva = None
    elif stav == 'zelena':
        vyzva = None if na_kal else 'na_rade'
    else:
        vyzva = 'posli'
    return {
        'stav': stav, 'min': minimum, 'platnych': len(platne), 'aktivnich': len(aktivni),
        'zbyva': rozhod['s']['zbyva'] if rozhod else None, 'okno': rozhod['s']['okno'] if rozhod else None,
        'odeslat_do': plus_dni(rozhod['s']['platnost_do'], -rozhod['s']['okno']) if rozhod else None,
        'dalsi': dalsi, 'vyzva': vyzva,
    }


def je_tlumeny(s, stav_sk):
    return stav_sk == 'zelena' and s['stav'] in ('propadla', 'bez')


def souhrn_skupin(stavy):
    r = {'ok': 0, 'brzy': 0, 'nedostatek': 0}
    for gs in stavy:
        if gs['stav'] == 'prazdna':
            continue
        r['ok' if gs['stav'] == 'zelena' else 'brzy' if gs['stav'] == 'oranzova' else 'nedostatek'] += 1
    return r


# ---------- přehled, pravidlo „kdy poslat“, text e-mailu ----------


def spocitej(data, dnes):
    """data = výstup upozorneni_data: {nastaveni, skupiny, pristroje, kalibrace}"""
    nast = data.get('nastaveni') or {}
    kal = {}
    for k in data.get('kalibrace') or []:
        kal.setdefault(k['pristroj_id'], []).append(k)
    vysledek = []
    for g in sorted(data.get('skupiny') or [], key=lambda g: g.get('poradi') or 0):
        polozky = [{'pristroj': p, 's': stav_pristroje(p, kal.get(p['id'], []), dnes, nast)}
                   for p in data.get('pristroje') or [] if p['skupina_id'] == g['id']]
        gs = stav_skupiny(g, polozky)
        for x in polozky:
            x['tlumeny'] = je_tlumeny(x['s'], gs['stav'])
        vysledek.append({'g': g, 'gs': gs, 'polozky': polozky})
    return vysledek


def duvody(prehled, dnes):
    """Seznam důvodů k odeslání (prázdný = neposílat)."""
    r = []
    for G in prehled:
        gs = G['gs']
        if gs['stav'] == 'prazdna':
            continue
        if gs['zbyva'] is not None and gs['zbyva'] in PRAHY | {gs['okno']}:
            r.append(f"skupina {G['g']['nazev']}: zbývá {gs['zbyva']} dní")
        if gs['stav'] != 'zelena':  # v zelené skupině je propadání kusů záměrné (rotace)
            for x in G['polozky']:
                s = x['s']
                if s['stav'] in ('platna', 'brzy') and s['zbyva'] in PRAHY | {s['okno']}:
                    r.append(f"přístroj ve skupině {G['g']['nazev']}: zbývá {s['zbyva']} dní")
    if den(dnes).weekday() == 0 and any(G['gs']['stav'] in ('oranzova', 'cervena') for G in prehled):
        r.append('pondělní souhrn')
    return r


POR = {'cervena': 0, 'oranzova': 1, 'zelena': 2}


def popis_skupiny(gs):
    if gs['stav'] == 'zelena':
        return 'v pořádku'
    if gs['stav'] == 'oranzova':
        return 'brzy vyprší – ' + ('dnes' if gs['zbyva'] == 0 else 'za ' + dni(gs['zbyva']))
    return f"nedostatek platných ({gs['platnych']} z {gs['min']})"


def kdo(p):
    return 'SN ' + p['vyrobni_cislo'] + (' – ' + p['technik'] if p.get('technik') else '')


def predmet(prehled):
    sm = souhrn_skupin([G['gs'] for G in prehled])
    return f"Kalibrace: {sm['brzy']} brzy vyprší, {sm['nedostatek']} propadlé"


def text_emailu(prehled, dnes):
    radky = [f'Kalibrace – stav k {format_datum(dnes)}', '']
    for G in sorted([G for G in prehled if G['gs']['stav'] != 'prazdna'], key=lambda G: POR[G['gs']['stav']]):
        gs = G['gs']
        radky.append(f"{G['g']['nazev'].upper()} – {popis_skupiny(gs)}")
        if gs['vyzva'] == 'posli':
            radky.append(f"  >> Pošli na kalibraci: {kdo(gs['dalsi'])}")
        elif gs['vyzva'] == 'na_rade':
            radky.append(f"  Na řadě: {kdo(gs['dalsi'])}" + (f" · odeslat do {format_datum(gs['odeslat_do'])}" if gs['odeslat_do'] else ''))
        for x in sorted(G['polozky'], key=lambda x: (x['s']['zbyva'] is None, x['s']['zbyva'] or 0)):
            if x['tlumeny'] or x['s']['stav'] == 'vyrazeno':
                continue
            p = x['pristroj']
            nazev = ' '.join(filter(None, [p.get('vyrobce'), p.get('model')])) or 'Přístroj'
            radky.append(f"  • {nazev} · {kdo(p)} – {x['s']['text']}")
        radky.append('')
    radky.append('Otevřít appku: ' + APP_URL)
    return '\n'.join(radky)


# ---------- běh ----------


def log(*a):
    print(datetime.now().strftime('%Y-%m-%d %H:%M:%S'), *a, flush=True)


def dnes_praha():
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo('Europe/Prague')).date().isoformat()


def env(nazev):
    v = os.environ.get(nazev, '').strip()
    if not v:
        raise SystemExit(f'Chybí proměnná prostředí {nazev} (GitHub Secrets).')
    return v


def nacti_data():
    url = env('KALIBRACE_SUPABASE_URL').rstrip('/') + '/rest/v1/rpc/upozorneni_data'
    req = urllib.request.Request(url, data=json.dumps({'token': env('KALIBRACE_NOTIFY_TOKEN')}).encode(), method='POST', headers={
        'apikey': env('KALIBRACE_SUPABASE_PUBLISHABLE_KEY'), 'Content-Profile': 'kalibrace', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            log('Supabase', r.status)
            return json.load(r)
    except urllib.error.HTTPError as e:
        log('Supabase CHYBA', e.code, e.read().decode(errors='replace')[:500])
        raise SystemExit(1)


def posli(prijemce, predmet_, telo):
    """Odešle z pracovní schránky; port 465 = SMTP přes SSL, jinak (587) povinně STARTTLS.

    Bezpečnost (ověřeno testy proti lokálnímu SMTP serveru v tests/test_kontrola.py):
      - certifikát i jméno serveru se ověřují (ssl.create_default_context, nic se nevypíná);
        pozor: starttls bez parametru context certifikát NEověřuje, proto se context předává vždy,
      - když STARTTLS chybí, server ho odmítne nebo selže TLS handshake, skončí chybou –
        nikdy se nepřihlásí ani nepošle heslo bez šifrování (žádný fallback).
    """
    host, port, user = env('KALIBRACE_SMTP_HOST'), int(env('KALIBRACE_SMTP_PORT')), env('KALIBRACE_SMTP_USER')
    msg = EmailMessage()
    msg['From'] = user
    msg['To'] = prijemce
    msg['Subject'] = predmet_
    msg.set_content(telo)
    ctx = ssl.create_default_context()
    if port == 465:
        s = smtplib.SMTP_SSL(host, port, timeout=30, context=ctx)
    else:
        s = smtplib.SMTP(host, port, timeout=30)
    with s:
        if port != 465:
            s.ehlo()
            s.starttls(context=ctx)  # výjimka při chybě → login se nezavolá
            s.ehlo()
        s.login(user, env('KALIBRACE_SMTP_PASSWORD'))
        s.send_message(msg)
    log('SMTP', host, port, 'ok')


def main(argv):
    test = '--test-email' in argv  # jeden zkušební e-mail bez ohledu na pravidla (má přednost před --dry-run)
    dry = '--dry-run' in argv and not test
    nahled = argv[argv.index('--nahled') + 1] if '--nahled' in argv else None
    dnes = dnes_praha()
    log('start', 'dnes', dnes, '(dry-run)' if dry else '', '(náhled)' if nahled else '', '(zkušební e-mail)' if test else '')
    data = nacti_data()
    prehled = spocitej(data, dnes)
    # Repo je veřejné → log bez výrobních čísel, jmen a e-mailu
    for G in prehled:
        log('skupina', G['g']['nazev'], G['gs']['stav'], 'zbývá', G['gs']['zbyva'], 'ks', G['gs']['aktivnich'])
    d = duvody(prehled, dnes)
    log('důvody:', '; '.join(d) if d else 'žádné')
    pr, telo = predmet(prehled), text_emailu(prehled, dnes)
    log('předmět:', pr)
    if nahled:
        with open(nahled, 'w', encoding='utf-8') as f:
            f.write(pr + '\n\n' + telo + '\n')
        log('náhled zapsán do', nahled)
        return
    if test:
        pr = '[TEST] ' + pr
        telo = 'Zkušební e-mail ze skriptu upozornění (spuštěno ručně, bez ohledu na pravidla).\n\n' + telo
        log('zkušební e-mail – pravidla se nepoužijí, předmět:', pr)
    elif not d or dry:
        log('e-mail se neposílá', '(dry-run)' if dry else '(žádný důvod)')
        return
    prijemce = ((data.get('nastaveni') or {}).get('email_upozorneni') or '').strip()
    if not prijemce:
        log('CHYBA: v appce (Nastavení, E-mail) není vyplněný příjemce upozornění')
        raise SystemExit(1)
    try:
        posli(prijemce, pr, telo)
    except (smtplib.SMTPException, ssl.SSLError, OSError) as e:
        log('SMTP CHYBA', type(e).__name__, str(e)[:300])
        raise SystemExit(1)
    log('e-mail odeslán (příjemce z nastavení appky)')


if __name__ == '__main__':
    main(sys.argv[1:])
