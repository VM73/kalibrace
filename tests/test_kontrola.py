"""Testy scripts/kontrola.py – stejné případy jako Node (tests/cases.json) + pravidlo „kdy poslat“ a text e-mailu.
Spuštění: python -m unittest discover -s tests -p "test_*.py" -v
"""
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('kontrola', ROOT / 'scripts' / 'kontrola.py')
K = importlib.util.module_from_spec(spec)
spec.loader.exec_module(K)
C = json.loads((ROOT / 'tests' / 'cases.json').read_text(encoding='utf-8'))


def kal(platnost_do):
    return [{'datum_kalibrace': '2000-01-01', 'platnost_do': platnost_do}] if platnost_do else []


def polozky(pristroje, dnes):
    r = []
    for x in pristroje:
        p = {'id': x['id'], 'stav': x.get('stav', 'aktivni'), 'odeslano_dne': x.get('odeslano_dne'), 'vyrobni_cislo': x['id']}
        r.append({'pristroj': p, 's': K.stav_pristroje(p, kal(x['platnost_do']), dnes)})
    return r


def data_ze_skupin(skupiny):
    d = {'nastaveni': {}, 'skupiny': [], 'pristroje': [], 'kalibrace': []}
    for i, g in enumerate(skupiny):
        gid = f'g{i}'
        d['skupiny'].append({'id': gid, 'nazev': f'Skupina {i}', 'poradi': i, 'min_platnych': g.get('min_platnych', 1),
                             'vsechny_platne': g.get('vsechny_platne', False)})
        for x in g['pristroje']:
            pid = f'{gid}-{x["id"]}'
            d['pristroje'].append({'id': pid, 'skupina_id': gid, 'vyrobni_cislo': pid, 'technik': '', 'model': 'X',
                                   'stav': x.get('stav', 'aktivni'), 'doba_v_lab_dni': 14, 'predstih_dni': None})
            if x['platnost_do']:
                d['kalibrace'].append({'pristroj_id': pid, 'datum_kalibrace': '2000-01-01', 'platnost_do': x['platnost_do']})
    return d


class Pristroje(unittest.TestCase):
    def test_pripady(self):
        for c in C['pristroje']:
            with self.subTest(c['nazev']):
                p = {'stav': 'aktivni', **c['pristroj']}
                s = K.stav_pristroje(p, kal(c['platnost_do']), C['dnes'], c.get('nastaveni'))
                for k, v in c['ocekavano'].items():
                    self.assertEqual(s[k], v, k)


class Skupiny(unittest.TestCase):
    def test_pripady(self):
        for c in C['skupiny']:
            with self.subTest(c['nazev']):
                pol = polozky(c['pristroje'], C['dnes'])
                g = K.stav_skupiny({'min_platnych': c['min_platnych'], 'vsechny_platne': c.get('vsechny_platne')}, pol)
                o = c['ocekavano']
                self.assertEqual(g['stav'], o['stav'])
                for k in ('zbyva', 'vyzva', 'odeslat_do', 'min'):
                    if k in o:
                        self.assertEqual(g[k], o[k], k)
                self.assertEqual(g['dalsi']['id'] if g['dalsi'] else None, o['dalsi'])
                self.assertEqual([x['pristroj']['id'] for x in pol if K.je_tlumeny(x['s'], g['stav'])], o['tlumene'])

    def test_souhrn(self):
        for c in C['souhrn_skupin']:
            self.assertEqual(K.souhrn_skupin(c['skupiny']), c['ocekavano'])

    def test_pridej_dni_a_format(self):
        self.assertEqual(K.plus_dni('2027-01-15', -44), '2026-12-02')
        self.assertEqual(K.format_datum('2026-11-14'), '14. 11. 2026')


class KdyPoslat(unittest.TestCase):
    def test_pripady(self):
        for c in C['upozorneni']:
            with self.subTest(c['nazev']):
                prehled = K.spocitej(data_ze_skupin(c['skupiny']), c['dnes'])
                self.assertEqual(bool(K.duvody(prehled, c['dnes'])), c['poslat'], K.duvody(prehled, c['dnes']))


class TextEmailu(unittest.TestCase):
    def test_predmet_a_obsah(self):
        d = data_ze_skupin([
            {'pristroje': [{'id': 'A', 'platnost_do': '2027-06-01'}, {'id': 'B', 'platnost_do': '2026-10-01'}]},  # zelená, B tlumený
            {'pristroje': [{'id': 'C', 'platnost_do': '2026-12-06'}]},  # oranžová
            {'pristroje': []},  # prázdná
        ])
        d['pristroje'][2]['technik'] = 'Petr'
        prehled = K.spocitej(d, '2026-11-14')
        self.assertEqual(K.predmet(prehled), 'Kalibrace: 1 brzy vyprší, 0 propadlé')
        t = K.text_emailu(prehled, '2026-11-14')
        self.assertIn('Kalibrace – stav k 14. 11. 2026', t)
        self.assertLess(t.index('SKUPINA 1 – brzy vyprší – za 22 dní'), t.index('SKUPINA 0 – v pořádku'))  # problémy první
        self.assertIn('>> Pošli na kalibraci: SN g1-C – Petr', t)
        self.assertIn('Na řadě: SN g0-B · odeslat do', t)
        self.assertNotIn('SN g0-B – propadlá', t)  # tlumený kus se nehlásí
        self.assertNotIn('SKUPINA 2', t)  # prázdná skupina se nehlásí
        self.assertIn(K.APP_URL, t)


class Beh(unittest.TestCase):
    """Celý běh main(): falešný Supabase (lokální HTTP) a falešné SMTP – nic nejde ven."""

    def setUp(self):
        import http.server
        import os
        import threading
        self.pozadavky = []
        test = self
        self.data = data_ze_skupin([{'pristroje': [{'id': 'A', 'platnost_do': '2026-01-01'}]}])  # červená
        self.data['nastaveni'] = {'email_upozorneni': 'prijemce@example.com'}

        class H(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers['Content-Length']))
                test.pozadavky.append((self.path, self.headers, json.loads(body)))  # hlavičky bez ohledu na velikost písmen
                ok = json.loads(body).get('token') == 'tajny-token'
                self.send_response(200 if ok else 403)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(test.data if ok else {'message': 'neplatný token'}).encode())

            def log_message(self, *a):
                pass

        self.srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.env = {'KALIBRACE_SUPABASE_URL': f'http://127.0.0.1:{self.srv.server_address[1]}', 'KALIBRACE_SUPABASE_PUBLISHABLE_KEY': 'sb_publishable_x',
                    'KALIBRACE_NOTIFY_TOKEN': 'tajny-token', 'KALIBRACE_SMTP_HOST': 'smtp.firma.cz', 'KALIBRACE_SMTP_PORT': '587',
                    'KALIBRACE_SMTP_USER': 'servis@firma.cz', 'KALIBRACE_SMTP_PASSWORD': 'heslo'}
        self.puvodni_env = dict(os.environ)
        os.environ.update(self.env)
        self.odeslane = []
        odeslane = self.odeslane

        class FakeSMTP:
            def __init__(self, host, port, timeout=None, context=None):
                self.info = {'host': host, 'port': port, 'tls': False, 'ctx': context}

            def ehlo(self):
                pass

            def starttls(self, context=None):
                self.info['tls'] = True
                self.info['ctx'] = context

            def login(self, u, p):
                self.info['login'] = u

            def send_message(self, m):
                self.info['msg'] = m
                odeslane.append(self.info)

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        self.puvodni_smtp = (K.smtplib.SMTP, K.smtplib.SMTP_SSL, K.dnes_praha)
        K.smtplib.SMTP = K.smtplib.SMTP_SSL = FakeSMTP
        K.dnes_praha = lambda: '2026-11-16'  # pondělí → týdenní souhrn

    def tearDown(self):
        import os
        self.srv.shutdown()
        os.environ.clear()
        os.environ.update(self.puvodni_env)
        K.smtplib.SMTP, K.smtplib.SMTP_SSL, K.dnes_praha = self.puvodni_smtp

    def test_rpc_hlavicky_a_odeslani_starttls(self):
        K.main([])
        path, h, body = self.pozadavky[0]
        self.assertEqual(path, '/rest/v1/rpc/upozorneni_data')
        self.assertEqual((h['apikey'], h['Content-Profile'], body), ('sb_publishable_x', 'kalibrace', {'token': 'tajny-token'}))
        self.assertNotIn('Authorization', h)  # žádný service_role
        m = self.odeslane[0]
        self.assertEqual((m['host'], m['port'], m['tls'], m['login']), ('smtp.firma.cz', 587, True, 'servis@firma.cz'))
        self.assertEqual((m['msg']['From'], m['msg']['To']), ('servis@firma.cz', 'prijemce@example.com'))
        self.assertEqual(m['msg']['Subject'], 'Kalibrace: 0 brzy vyprší, 1 propadlé')
        self.assertEqual((m['ctx'].verify_mode, m['ctx'].check_hostname), (K.ssl.CERT_REQUIRED, True))

    def test_port_465_ssl(self):
        import os
        os.environ['KALIBRACE_SMTP_PORT'] = '465'
        K.main([])
        m = self.odeslane[0]
        self.assertEqual((m['port'], m['tls']), (465, False))
        self.assertEqual((m['ctx'].verify_mode, m['ctx'].check_hostname), (K.ssl.CERT_REQUIRED, True))

    def test_dry_run_a_nahled_nic_neposilaji(self):
        import tempfile
        K.main(['--dry-run'])
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / 'nahled.txt'
            K.main(['--nahled', str(f)])
            self.assertIn('>> Pošli na kalibraci: SN g0-A', f.read_text(encoding='utf-8'))
        self.assertEqual(self.odeslane, [])

    def test_bez_prijemce_chyba(self):
        self.data['nastaveni'] = {}
        with self.assertRaises(SystemExit):
            K.main([])
        self.assertEqual(self.odeslane, [])

    def test_zkusebni_email_bez_ohledu_na_pravidla(self):
        K.dnes_praha = lambda: '2026-11-14'  # sobota, červená skupina mimo práh → normálně by nic nešlo
        K.main([])
        self.assertEqual(self.odeslane, [])
        K.main(['--test-email', '--dry-run'])  # test má přednost před dry-run
        m = self.odeslane[0]['msg']
        self.assertEqual(m['Subject'], '[TEST] Kalibrace: 0 brzy vyprší, 1 propadlé')
        self.assertTrue(m.get_content().startswith('Zkušební e-mail'))
        self.assertEqual(m['To'], 'prijemce@example.com')

    def test_zkusebni_email_bez_prijemce_chyba(self):
        self.data['nastaveni'] = {}
        with self.assertRaises(SystemExit):
            K.main(['--test-email'])
        self.assertEqual(self.odeslane, [])

    def test_spatny_token(self):
        import os
        os.environ['KALIBRACE_NOTIFY_TOKEN'] = 'spatny'
        with self.assertRaises(SystemExit):
            K.main([])


class FalesnySMTP:
    """Lokální SMTP server (skutečný socket a TLS) pro test skutečného smtplib ve skriptu.
    rezim: 'bez_starttls' (nabízí AUTH LOGIN bez šifrování), 'starttls_454' (odmítne STARTTLS),
           'starttls_rozbity' (220 a pak zavře spojení), 'tls' (řádné TLS s certifikátem pro 127.0.0.1)."""

    def __init__(self, rezim, cert=None, klic=None):
        import socket
        import threading
        self.rezim, self.cert, self.klic, self.prikazy, self.tls_chyba = rezim, cert, klic, [], None
        self.sock = socket.socket()
        self.sock.bind(('127.0.0.1', 0))
        self.sock.listen(1)
        self.sock.settimeout(10)
        self.port = self.sock.getsockname()[1]
        self.vlakno = threading.Thread(target=self._obsluha, daemon=True)
        self.vlakno.start()

    def _obsluha(self):
        import ssl
        try:
            conn, _ = self.sock.accept()
        except OSError:
            return
        conn.settimeout(10)
        f = conn.makefile('rwb')
        tls = False

        def posli(t):
            f.write((t + '\r\n').encode())
            f.flush()

        posli('220 falesny ESMTP')
        try:
            while True:
                radek = f.readline().decode().strip()
                if not radek:
                    return
                cmd = radek.split()[0].upper()
                self.prikazy.append(cmd)
                if cmd in ('EHLO', 'HELO'):
                    rozsireni = []
                    if self.rezim != 'bez_starttls' and not tls:
                        rozsireni.append('STARTTLS')
                    if tls or self.rezim == 'bez_starttls':
                        rozsireni.append('AUTH LOGIN')
                    for x in ['falesny'] + rozsireni:
                        posli('250-' + x)
                    posli('250 OK')
                elif cmd == 'STARTTLS':
                    if self.rezim == 'starttls_454':
                        posli('454 TLS not available')
                    elif self.rezim == 'starttls_rozbity':
                        posli('220 go ahead')
                        conn.close()
                        return
                    else:
                        posli('220 go ahead')
                        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                        ctx.load_cert_chain(self.cert, self.klic)
                        try:
                            conn = ctx.wrap_socket(conn, server_side=True)
                        except (ssl.SSLError, OSError) as e:
                            self.tls_chyba = e  # klient odmítl certifikát
                            return
                        f = conn.makefile('rwb')
                        tls = True
                elif cmd == 'AUTH':
                    posli('334 UGFzc3dvcmQ6')
                    f.readline()
                    self.prikazy.append('AUTH-HESLO')
                    posli('235 ok')
                elif cmd == 'DATA':
                    posli('354 data')
                    while f.readline().strip() != b'.':
                        pass
                    posli('250 prijato')
                elif cmd == 'QUIT':
                    posli('221 bye')
                    return
                else:
                    posli('250 OK')
        except OSError:
            return
        finally:
            for x in (f, conn, self.sock):
                try:
                    x.close()
                except OSError:
                    pass


class SmtpBezpecnost(unittest.TestCase):
    """a) bez úspěšného STARTTLS se skript nikdy nepřihlásí; b) certifikát serveru se ověřuje.
    Skutečný smtplib a ssl ze skriptu proti lokálnímu serveru; certifikát vyrobí openssl (Git for Windows / Ubuntu)."""

    @classmethod
    def setUpClass(cls):
        import shutil
        import subprocess
        import tempfile
        cls.tmp = tempfile.TemporaryDirectory()
        cls.cert, cls.klic = str(Path(cls.tmp.name) / 'cert.pem'), str(Path(cls.tmp.name) / 'klic.pem')
        openssl = shutil.which('openssl') or r'C:\Program Files\Git\usr\bin\openssl.exe'
        cls.cert_jiny, cls.klic_jiny = str(Path(cls.tmp.name) / 'jiny.pem'), str(Path(cls.tmp.name) / 'jiny-klic.pem')
        openssl = shutil.which('openssl') or r'C:\Program Files\Git\usr\bin\openssl.exe'
        for cn, san, klic, cert in (('localhost', 'DNS:localhost,IP:127.0.0.1', cls.klic, cls.cert),
                                    ('jiny.example', 'DNS:jiny.example', cls.klic_jiny, cls.cert_jiny)):
            subprocess.run([openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=' + cn,
                            '-addext', 'subjectAltName=' + san, '-keyout', klic, '-out', cert], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def posli(self, server):
        import os
        stare = dict(os.environ)
        os.environ.update({'KALIBRACE_SMTP_HOST': '127.0.0.1', 'KALIBRACE_SMTP_PORT': str(server.port),
                           'KALIBRACE_SMTP_USER': 'servis@firma.cz', 'KALIBRACE_SMTP_PASSWORD': 'tajne-heslo'})
        try:
            K.posli('prijemce@example.com', 'Test', 'text')
        finally:
            os.environ.clear()
            os.environ.update(stare)
            server.vlakno.join(5)

    def assertNeprihlasil(self, server):
        self.assertNotIn('AUTH', server.prikazy)
        self.assertNotIn('AUTH-HESLO', server.prikazy)
        self.assertNotIn('MAIL', server.prikazy)

    def test_a_server_bez_starttls_chyba_bez_prihlaseni(self):
        s = FalesnySMTP('bez_starttls')
        with self.assertRaises(K.smtplib.SMTPNotSupportedError):
            self.posli(s)
        self.assertNeprihlasil(s)

    def test_a_odmitnuty_starttls_chyba_bez_prihlaseni(self):
        s = FalesnySMTP('starttls_454')
        with self.assertRaises(K.smtplib.SMTPResponseException):
            self.posli(s)
        self.assertNeprihlasil(s)

    def test_a_selhany_tls_handshake_chyba_bez_prihlaseni(self):
        s = FalesnySMTP('starttls_rozbity')
        with self.assertRaises((K.ssl.SSLError, OSError, K.smtplib.SMTPException)):
            self.posli(s)
        self.assertNeprihlasil(s)

    def test_b_neduveryhodny_certifikat_odmitnut(self):
        s = FalesnySMTP('tls', self.cert, self.klic)  # self-signed, systém mu nedůvěřuje
        with self.assertRaises(K.ssl.SSLCertVerificationError):
            self.posli(s)
        self.assertNeprihlasil(s)

    def test_b_cizi_jmeno_serveru_odmitnuto(self):
        # Certifikátu důvěřujeme, ale je vydaný pro jiný server → odmítnout (ověřuje se i jméno, check_hostname)
        puvodni = K.ssl.create_default_context
        K.ssl.create_default_context = lambda: puvodni(cafile=self.cert_jiny)
        try:
            s = FalesnySMTP('tls', self.cert_jiny, self.klic_jiny)
            with self.assertRaises(K.ssl.SSLCertVerificationError) as e:
                self.posli(s)
        finally:
            K.ssl.create_default_context = puvodni
        self.assertIn('mismatch', str(e.exception).lower())
        self.assertNeprihlasil(s)

    def test_b_kontrola_duveryhodny_certifikat_projde(self):
        # Kontrola testu: když certifikátu důvěřujeme, stejný server přihlášení i odeslání přijme
        puvodni = K.ssl.create_default_context
        K.ssl.create_default_context = lambda: puvodni(cafile=self.cert)
        try:
            s = FalesnySMTP('tls', self.cert, self.klic)
            self.posli(s)
        finally:
            K.ssl.create_default_context = puvodni
        self.assertEqual(s.prikazy[:3], ['EHLO', 'STARTTLS', 'EHLO'])
        self.assertIn('AUTH-HESLO', s.prikazy)
        self.assertIn('MAIL', s.prikazy)

    def test_b_skript_nikde_nevypina_overovani(self):
        zdroj = (ROOT / 'scripts' / 'kontrola.py').read_text(encoding='utf-8')
        kod = '\n'.join(r for r in zdroj.splitlines() if not r.strip().startswith('#'))
        for zakazane in ('CERT_NONE', 'check_hostname = False', '_create_unverified_context', '_create_stdlib_context', '.starttls()'):
            self.assertNotIn(zakazane, kod)


class Praha(unittest.TestCase):
    """Na Windows vyžaduje tzdata (pip install -r requirements.txt)."""
    def test_dnes_v_praze(self):
        from datetime import datetime, timezone
        from zoneinfo import ZoneInfo
        self.assertRegex(K.dnes_praha(), r'^\d{4}-\d{2}-\d{2}$')
        # 23:30 UTC 14. 11. = 0:30 15. 11. v Praze (zima); 21:59 UTC 14. 7. = 23:59 v Praze (léto)
        p = ZoneInfo('Europe/Prague')
        self.assertEqual(datetime(2026, 11, 14, 23, 30, tzinfo=timezone.utc).astimezone(p).date().isoformat(), '2026-11-15')
        self.assertEqual(datetime(2026, 7, 14, 21, 59, tzinfo=timezone.utc).astimezone(p).date().isoformat(), '2026-07-14')


if __name__ == '__main__':
    unittest.main()
