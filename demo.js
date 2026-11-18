// Ukázková data pro ?demo=1. Data se počítají relativně k dnešku, aby demo vypadalo vždy stejně.
function demoData(dnes) {
  var d = function (n) { var x = new Date(Calc.denCislo(dnes) * 86400000 + n * 86400000); return x.toISOString().slice(0, 10); };
  var k = function (id, pid, platnostZa, lab, cislo) {
    var platnost = d(platnostZa);
    return { id: id, pristroj_id: pid, datum_kalibrace: Calc.pridejMesice(platnost, -12), platnost_do: platnost,
      laborator: lab, cislo_protokolu: cislo, protokol_path: 'demo:' + cislo, cena: null, poznamka: '', created_at: d(0) };
  };
  var p = function (o) {
    return Object.assign({ owner: 'demo', vyrobce: '', model: '', vyrobni_cislo: '', technik: '', interval_mesicu: 12,
      doba_v_lab_dni: 14, predstih_dni: null, stav: 'aktivni', odeslano_dne: null, ocekavany_navrat: null,
      foto_path: null, poznamka: '' }, o);
  };
  return {
    skupiny: [
      { id: 'g1', nazev: 'Anemometry lopatkové', typ: 'anemometr', min_platnych: 1, poradi: 1 },
      { id: 'g2', nazev: 'Balometr', typ: 'balometr', min_platnych: 1, poradi: 2 },
      { id: 'g3', nazev: 'Detektory úniků chladiva', typ: 'detektor_uniku', min_platnych: 2, poradi: 3 },
      { id: 'g4', nazev: 'Diferenční manometry', typ: 'dif_manometr', min_platnych: 1, poradi: 4 }
    ],
    pristroje: [
      p({ id: 'p1', skupina_id: 'g1', vyrobce: 'Testo', model: '417', vyrobni_cislo: '41700101', technik: 'Petr' }),
      p({ id: 'p2', skupina_id: 'g1', vyrobce: 'Testo', model: '417', vyrobni_cislo: '41700102', technik: 'Jan' }),
      p({ id: 'p3', skupina_id: 'g1', vyrobce: 'Testo', model: '417', vyrobni_cislo: '41700103', technik: 'Tomáš',
        stav: 'na_kalibraci', odeslano_dne: d(-6), ocekavany_navrat: d(8) }),
      p({ id: 'p4', skupina_id: 'g2', vyrobce: 'Airflow', model: 'ProHood PH731 basic', vyrobni_cislo: 'PH731-2219', technik: 'Tomáš' }),
      p({ id: 'p5', skupina_id: 'g3', vyrobce: 'Testo', model: '316-3', vyrobni_cislo: '3160452', technik: 'Petr' }),
      p({ id: 'p6', skupina_id: 'g3', vyrobce: 'Inficon', model: 'D-TEK Stratus', vyrobni_cislo: 'DS-77810', technik: 'Jan' }),
      p({ id: 'p7', skupina_id: 'g4', vyrobce: 'Testo', model: '510i', vyrobni_cislo: '51088231', technik: 'Tomáš' })
    ],
    kalibrace: [
      k('k1', 'p1', 210, 'Testo Industrial Services', 'TIS-2026-0412'),
      k('k1b', 'p1', -155, 'Testo Industrial Services', 'TIS-2025-0388'),
      k('k2', 'p2', -20, 'Testo Industrial Services', 'TIS-2025-0731'),
      k('k3', 'p3', -150, 'Testo Industrial Services', 'TIS-2025-0102'),
      k('k4', 'p4', 25, 'Metrologie Brno s.r.o.', 'MB-25-1180'),
      k('k5', 'p5', 120, 'Testo Industrial Services', 'TIS-2026-0219'),
      k('k6', 'p6', -5, 'Inficon servis', 'INF-25-5521'),
      k('k7', 'p7', 300, 'Testo Industrial Services', 'TIS-2026-0907')
    ],
    nastaveni: { email_upozorneni: 'demo@example.com', predstih_dni_vychozi: 30 }
  };
}

// Malé platné PDF s textem – v demu zastupuje skutečný protokol
function demoPdf(text) {
  var obsah = 'BT /F1 18 Tf 50 780 Td (' + text.replace(/[()\\]/g, '') + ') Tj ET';
  var objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + obsah.length + ' >>\nstream\n' + obsah + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  var s = '%PDF-1.4\n', off = [];
  objs.forEach(function (o, i) { off.push(s.length); s += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  var xref = s.length;
  s += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  off.forEach(function (o) { s += String(o).padStart(10, '0') + ' 00000 n \n'; });
  s += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return new Blob([s], { type: 'application/pdf' });
}
