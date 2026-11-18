import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../calc.js', import.meta.url), 'utf8');
const blok = src.slice(src.indexOf('// <calc>'), src.indexOf('// </calc>'));
const Calc = vm.runInNewContext(blok + '\nCalc', { Intl, Date, Math, String, Number });
const C = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));

const kal = (platnost_do) => (platnost_do ? [{ datum_kalibrace: '2000-01-01', platnost_do }] : []);

for (const c of C.pristroje) {
  test('přístroj: ' + c.nazev, () => {
    const p = { stav: 'aktivni', ...c.pristroj };
    const s = Calc.stavPristroje(p, kal(c.platnost_do), C.dnes, c.nastaveni);
    for (const [k, v] of Object.entries(c.ocekavano)) assert.equal(s[k], v, k);
  });
}

for (const c of C.skupiny) {
  test('skupina: ' + c.nazev, () => {
    const polozky = c.pristroje.map((x) => {
      const p = { id: x.id, stav: x.stav || 'aktivni', odeslano_dne: x.odeslano_dne };
      return { pristroj: p, s: Calc.stavPristroje(p, kal(x.platnost_do), C.dnes) };
    });
    const g = Calc.stavSkupiny({ min_platnych: c.min_platnych, vsechny_platne: c.vsechny_platne }, polozky);
    const o = c.ocekavano;
    assert.equal(g.stav, o.stav, 'stav');
    if ('zbyva' in o) assert.equal(g.zbyva, o.zbyva, 'zbyva');
    assert.equal(g.dalsi ? g.dalsi.id : null, o.dalsi, 'dalsi');
    if ('vyzva' in o) assert.equal(g.vyzva, o.vyzva, 'vyzva');
    if ('odeslat_do' in o) assert.equal(g.odeslat_do, o.odeslat_do, 'odeslat_do');
    if ('min' in o) assert.equal(g.min, o.min, 'min');
    const tl = polozky.filter((x) => Calc.jeTlumeny(x.s, g.stav)).map((x) => x.pristroj.id);
    assert.deepEqual(tl, o.tlumene, 'tlumene');
  });
}

for (const c of C.souhrn_skupin) {
  test('souhrn skupin: ' + c.nazev, () => assert.deepEqual({ ...Calc.souhrnSkupin(c.skupiny) }, c.ocekavano));
}

for (const c of C.pridej_mesice) {
  test(`pridejMesice ${c.datum} + ${c.mesicu}`, () => assert.equal(Calc.pridejMesice(c.datum, c.mesicu), c.vysledek));
}

test('formát data a dnešek v Praze', () => {
  assert.equal(Calc.formatDatum('2026-11-14'), '14. 11. 2026');
  // 23:30 UTC 14. 11. = 0:30 15. 11. v Praze
  assert.equal(Calc.dnesPraha(new Date('2026-11-14T23:30:00Z')), '2026-11-15');
  assert.equal(Calc.dnesPraha(new Date('2026-07-14T21:59:00Z')), '2026-07-14');
});

test('řazení podle naléhavosti', () => {
  const mk = (stav, zbyva, tlumeny) => ({ s: { stav, zbyva }, tlumeny });
  const arr = [mk('platna', 200), mk('propadla', -5, true), mk('brzy', 10), mk('bez', null), mk('propadla', -3)];
  const r = arr.sort(Calc.porovnejNalehavost).map((x) => x.s.stav + (x.tlumeny ? '*' : ''));
  assert.deepEqual(r, ['bez', 'propadla', 'brzy', 'propadla*', 'platna']);
});
