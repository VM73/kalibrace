// Čisté výpočty – bez DOM a sítě. Testuje se v Node (tests/calc.test.mjs),
// stejnou logiku zrcadlí scripts/kontrola.py (společné případy v tests/cases.json).
// <calc>
var Calc = (function () {
  'use strict';
  var VYCHOZI = { predstih_dni: 30, doba_v_lab_dni: 14, interval_mesicu: 12 };

  // 'YYYY-MM-DD' -> počet dní od epochy (UTC, bez vlivu časových zón)
  function denCislo(iso) {
    var p = String(iso).slice(0, 10).split('-');
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }
  function dnyMezi(od, do_) { return denCislo(do_) - denCislo(od); }
  function plusDni(iso, n) { return new Date((denCislo(iso) + n) * 86400000).toISOString().slice(0, 10); }

  // Dnešek v Europe/Prague jako 'YYYY-MM-DD'
  function dnesPraha(now) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(now || new Date());
  }

  // Datum + n měsíců; konec měsíce se zarovná (31. 1. + 1 = 28./29. 2.)
  function pridejMesice(iso, n) {
    var p = iso.split('-').map(Number);
    var m = p[1] - 1 + n, y = p[0] + Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    var posledni = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    var d = Math.min(p[2], posledni);
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function formatDatum(iso) {
    if (!iso) return '';
    var p = iso.slice(0, 10).split('-');
    return (+p[2]) + '. ' + (+p[1]) + '. ' + p[0];
  }
  function formatDatumKratce(iso) {
    var p = iso.slice(0, 10).split('-');
    return (+p[2]) + '. ' + (+p[1]) + '.';
  }

  // Česká slova k počtu dní
  function dni(n) { return n === 1 ? '1 den' : (n >= 2 && n <= 4 ? n + ' dny' : n + ' dní'); }
  function predDny(n) { return n === 1 ? 'před 1 dnem' : 'před ' + n + ' dny'; }

  function posledniKalibrace(kalibrace) {
    var best = null;
    (kalibrace || []).forEach(function (k) {
      if (!best || k.datum_kalibrace > best.datum_kalibrace ||
          (k.datum_kalibrace === best.datum_kalibrace && (k.created_at || '') > (best.created_at || ''))) best = k;
    });
    return best;
  }

  function okno(pristroj, nastaveni) {
    var predstih = pristroj.predstih_dni != null ? pristroj.predstih_dni
      : (nastaveni && nastaveni.predstih_dni_vychozi != null ? nastaveni.predstih_dni_vychozi : VYCHOZI.predstih_dni);
    var lab = pristroj.doba_v_lab_dni != null ? pristroj.doba_v_lab_dni : VYCHOZI.doba_v_lab_dni;
    return predstih + lab;
  }

  // Stav jednoho přístroje. stav: platna | brzy | propadla | bez | na_kalibraci | vyrazeno
  function stavPristroje(pristroj, kalibrace, dnes, nastaveni) {
    var k = posledniKalibrace(kalibrace);
    var w = okno(pristroj, nastaveni);
    var zbyva = k ? dnyMezi(dnes, k.platnost_do) : null;
    var stav, text;
    if (pristroj.stav === 'vyrazeno') { stav = 'vyrazeno'; text = 'vyřazeno'; }
    else if (pristroj.stav === 'na_kalibraci') {
      stav = 'na_kalibraci';
      text = 'na kalibraci' + (pristroj.odeslano_dne ? ' od ' + formatDatumKratce(pristroj.odeslano_dne) : '');
    }
    else if (zbyva === null) { stav = 'bez'; text = 'bez kalibrace'; }
    else if (zbyva < 0) { stav = 'propadla'; text = 'propadlá ' + predDny(-zbyva); }
    else if (zbyva === 0) { stav = 'brzy'; text = 'vyprší dnes'; }
    else {
      stav = zbyva > w ? 'platna' : 'brzy';
      text = (zbyva >= 2 && zbyva <= 4 ? 'zbývají ' : 'zbývá ') + dni(zbyva);
    }
    return { stav: stav, zbyva: zbyva, okno: w, text: text, platnost_do: k ? k.platnost_do : null };
  }

  // Další na kalibraci: aktivní kus s chybějící nebo nejstarší platností
  function dalsiNaKalibraci(polozky) {
    var best = null;
    polozky.forEach(function (x) {
      if (x.pristroj.stav !== 'aktivni') return;
      if (!best) { best = x; return; }
      var a = x.s.zbyva, b = best.s.zbyva;
      if (b === null) return;
      if (a === null || a < b) best = x;
    });
    return best ? best.pristroj : null;
  }

  // polozky: [{ pristroj, s: stavPristroje(...) }]
  // Vrací stav skupiny (zelena | oranzova | cervena | prazdna), počty, zbyva/okno rozhodujícího kusu a další na kalibraci.
  // prazdna = žádný aktivní kus (jen vyřazené nebo nic): šedá, nepočítá se do souhrnu ani do upozornění.
  // vsechny_platne = každý aktivní kus musí mít platnou kalibraci (min = počet aktivních; kus na kalibraci je neplatný).
  function stavSkupiny(skupina, polozky) {
    var aktivni = polozky.filter(function (x) { return x.s.stav !== 'vyrazeno'; });
    var min = skupina.vsechny_platne ? aktivni.length : (skupina.min_platnych || 1);
    var platne = aktivni.filter(function (x) { return x.s.stav === 'platna' || x.s.stav === 'brzy'; })
      .sort(function (a, b) { return b.s.zbyva - a.s.zbyva; });
    var zelene = platne.filter(function (x) { return x.s.stav === 'platna'; }).length;
    var stav = !aktivni.length ? 'prazdna' : zelene >= min ? 'zelena' : (platne.length >= min ? 'oranzova' : 'cervena');
    // Rozhodující kus = min-tý nejlepší platný; jeho vypršení shodí skupinu pod minimum
    var rozhod = platne.length >= min ? platne[min - 1] : null;
    var dalsi = dalsiNaKalibraci(aktivni);
    var naKal = aktivni.some(function (x) { return x.s.stav === 'na_kalibraci'; });
    // Výzva v hlavičce: zelená skupina → tlumené „na řadě“ (ne když už je kus na kalibraci),
    // oranžová/červená → výrazné „Pošli na kalibraci“
    var vyzva = !dalsi || stav === 'prazdna' ? null : (stav === 'zelena' ? (naKal ? null : 'na_rade') : 'posli');
    return {
      stav: stav, min: min, platnych: platne.length, aktivnich: aktivni.length,
      zbyva: rozhod ? rozhod.s.zbyva : null, okno: rozhod ? rozhod.s.okno : null,
      // Kdy nejpozději odeslat další kus: platnost rozhodujícího kusu − předstih − doba v laboratoři
      odeslat_do: rozhod ? plusDni(rozhod.s.platnost_do, -rozhod.s.okno) : null,
      dalsi: dalsi, vyzva: vyzva
    };
  }

  // Propadlý kus ve skupině, která je zelená, se zobrazí tlumeně (rotace je záměrná)
  function jeTlumeny(s, skupinaStav) {
    return skupinaStav === 'zelena' && (s.stav === 'propadla' || s.stav === 'bez');
  }

  var PORADI = { propadla: 0, bez: 0, brzy: 1, na_kalibraci: 2, platna: 3, vyrazeno: 4 };
  function naleh(x) { return x.tlumeny ? 2.5 : PORADI[x.s.stav]; }
  function porovnejNalehavost(a, b) {
    var d = naleh(a) - naleh(b);
    if (d) return d;
    var za = a.s.zbyva === null ? -1e9 : a.s.zbyva, zb = b.s.zbyva === null ? -1e9 : b.s.zbyva;
    return za - zb;
  }

  // Souhrn přes aktivní kusy: { ok, brzy, propadle, na_kalibraci }
  function souhrn(polozky) {
    var r = { ok: 0, brzy: 0, propadle: 0, na_kalibraci: 0 };
    polozky.forEach(function (x) {
      var st = x.s.stav;
      if (st === 'vyrazeno') return;
      if (st === 'na_kalibraci') r.na_kalibraci++;
      else if (st === 'platna' || x.tlumeny) r.ok++;
      else if (st === 'brzy') r.brzy++;
      else r.propadle++;
    });
    return r;
  }

  // Souhrn po skupinách (bez skupin, které nemají žádný aktivní kus): { ok, brzy, nedostatek }
  function souhrnSkupin(stavy) {
    var r = { ok: 0, brzy: 0, nedostatek: 0 };
    stavy.forEach(function (gs) {
      if (gs.stav === 'prazdna') return;
      if (gs.stav === 'zelena') r.ok++; else if (gs.stav === 'oranzova') r.brzy++; else r.nedostatek++;
    });
    return r;
  }

  return {
    VYCHOZI: VYCHOZI, denCislo: denCislo, dnyMezi: dnyMezi, plusDni: plusDni, souhrnSkupin: souhrnSkupin, dnesPraha: dnesPraha, pridejMesice: pridejMesice,
    formatDatum: formatDatum, formatDatumKratce: formatDatumKratce, posledniKalibrace: posledniKalibrace,
    okno: okno, stavPristroje: stavPristroje, stavSkupiny: stavSkupiny, dalsiNaKalibraci: dalsiNaKalibraci,
    jeTlumeny: jeTlumeny, porovnejNalehavost: porovnejNalehavost, souhrn: souhrn
  };
})();
// </calc>
