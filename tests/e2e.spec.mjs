import { test, expect } from '@playwright/test';

let chyby;
test.beforeEach(async ({ page }) => {
  chyby = [];
  page.on('pageerror', (e) => chyby.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') chyby.push(m.text()); });
});
test.afterEach(() => expect(chyby, 'chyby JS v konzoli').toEqual([]));

async function bezPreteceni(page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, 'stránka přetéká do šířky').toBeLessThanOrEqual(r.cw);
}
const karta = (page, sn) => page.locator(`a.row[data-pristroj="${sn}"]`);

test('přehled: souhrn, stavy skupin, barvy štítků', async ({ page }) => {
  await page.goto('/?demo=1&debug=1');
  await expect(page.locator('#souhrn .n')).toHaveText(['2', '1', '1']);
  const stavSkupiny = (n) => page.locator(`section[data-skupina="${n}"]`);
  await expect(stavSkupiny('Anemometry lopatkové')).toHaveAttribute('data-skupina-stav', 'zelena');
  // zelená skupina s kusem na kalibraci: žádné „na řadě“ ani „pošli“
  await expect(stavSkupiny('Anemometry lopatkové').locator('.ghead .next')).toHaveCount(0);
  await expect(stavSkupiny('Balometr')).toHaveAttribute('data-skupina-stav', 'oranzova');
  await expect(stavSkupiny('Detektory úniků chladiva')).toHaveAttribute('data-skupina-stav', 'cervena');
  await expect(stavSkupiny('Detektory úniků chladiva').locator('.ghead')).toContainText('Pošli na kalibraci: SN DS-77810 – Jan');
  await expect(stavSkupiny('Diferenční manometry')).toHaveAttribute('data-skupina-stav', 'zelena');
  // skupiny o 1 kusu jsou bez hlavičky, „Pošli na kalibraci“ je u oranžového/červeného přístroje
  await expect(stavSkupiny('Balometr').locator('.ghead')).toHaveCount(0);
  await expect(stavSkupiny('Diferenční manometry').locator('.ghead')).toHaveCount(0);
  await expect(karta(page, 'PH731-2219').locator('.next')).toHaveText('Pošli na kalibraci');
  await expect(karta(page, '51088231').locator('.next')).toHaveCount(0);

  const ocek = { '41700101': ['platna', 'PLATNÁ', /zbývá 210 dní/], '41700102': ['tlumeny', 'PROPADLÁ', /před 20 dny/], '41700103': ['na_kalibraci', 'NA KALIBRACI', /^od /],
    'PH731-2219': ['brzy', 'BRZY', /zbývá 25 dní/], 'DS-77810': ['propadla', 'PROPADLÁ', /před 5 dny/] };
  for (const [sn, [cls, stitek, text]] of Object.entries(ocek)) {
    const tag = karta(page, sn).locator('.tag');
    await expect(tag).toHaveClass(new RegExp('\\b' + cls + '\\b'));
    await expect(tag).toHaveText(stitek);
    await expect(karta(page, sn).locator('.stav .txt')).toHaveText(text);
  }
  // Štítky: bílé písmo na výplni zelená / oranžová / červená / modrá podle CSS proměnných
  await expect(karta(page, '41700101').locator('.tag')).toHaveCSS('color', 'rgb(255, 255, 255)');
  const barva = (sn) => karta(page, sn).locator('.tag').evaluate((el) => getComputedStyle(el).backgroundColor);
  const rgb = async (sn) => (await barva(sn)).match(/\d+/g).map(Number);
  const [r1, g1, b1] = await rgb('41700101'); expect(g1).toBeGreaterThan(r1); expect(g1).toBeGreaterThan(b1);
  const [r2, g2, b2] = await rgb('PH731-2219'); expect(r2).toBeGreaterThan(g2); expect(g2).toBeGreaterThan(b2);
  const [r3, g3, b3] = await rgb('DS-77810'); expect(r3).toBeGreaterThan(150); expect(g3).toBeLessThan(80); expect(b3).toBeLessThan(80);
  const [r4, , b4] = await rgb('41700103'); expect(b4).toBeGreaterThan(r4);
  // Ikony v barevných dlaždicích podle typu (anemometr modrá, balometr indigo)
  await expect(karta(page, '41700101').locator('.thumb')).toHaveCSS('background-color', 'rgb(0, 122, 255)');
  await expect(karta(page, 'PH731-2219').locator('.thumb')).toHaveCSS('background-color', 'rgb(88, 86, 214)');
  // Tlumený propadlý kus v zelené skupině
  await expect(karta(page, '41700102')).toHaveClass(/tlumeny/);
  // Řazení podle naléhavosti v anemometrech: na kalibraci, tlumený, platný
  await expect(page.locator('section[data-skupina="Anemometry lopatkové"] a.row')).toHaveText([/41700103/, /41700102/, /41700101/]);
  await expect(page.locator('#debug')).toBeVisible();
  await expect(page.locator('#debug')).not.toHaveClass(/chyba/);
  await expect(page.locator('footer')).toContainText('verze');
  await bezPreteceni(page);
});

test('filtr Jen problémy', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: 'Jen problémy' }).click();
  await expect(page.locator('section.group')).toHaveCount(2);
  await expect(page.locator('section[data-skupina="Balometr"]')).toBeVisible();
  await expect(karta(page, 'DS-77810')).toBeVisible();
  await expect(karta(page, '3160452')).toHaveCount(0);
  await page.getByRole('button', { name: 'Vše' }).click();
  await expect(page.locator('section.group')).toHaveCount(4);
});

test('název přístroje: výrobce se nezopakuje, když jím model začíná', async ({ page }) => {
  await page.goto('/?demo=1#/novy');
  await page.locator('#f_vyrobce').fill('Testo');
  await page.locator('#f_model').fill('Testo 417');
  await page.locator('#f_vyrobni_cislo').fill('63472674');
  await page.locator('form button[type=submit]').last().click();
  await expect(page.locator('.hero h1')).toHaveText('Testo 417');
  await page.getByRole('link', { name: '‹ Přehled' }).click(); // goto by demo data vrátil do výchozího stavu
  await expect(karta(page, '63472674').locator('.t')).toHaveText('Testo 417');
  // model bez výrobce („417“) – výrobce zůstane
  await expect(karta(page, '41700101').locator('.t')).toHaveText('Testo 417');
});

test('přepínač Vše / Jen problémy: vybraná volba v tmavém režimu jako Servis', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/?demo=1');
  await expect(page.locator('.seg button[aria-pressed="true"]')).toHaveCSS('background-color', 'rgb(99, 99, 102)');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('.seg button[aria-pressed="true"]')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('přidání přístroje a kalibrace s protokolem', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.getByRole('link', { name: '+ Nový přístroj' }).click();
  await page.locator('#f_skupina_id').selectOption({ label: 'Diferenční manometry' });
  await page.locator('#f_vyrobce').fill('Testo');
  await page.locator('#f_model').fill('512');
  await page.locator('#f_vyrobni_cislo').fill('512-0001');
  await page.locator('#f_technik').fill('Petr');
  await bezPreteceni(page);
  await page.locator('form button[type=submit]').last().click();
  await expect(page.locator('.hero .tag')).toHaveText('BEZ KALIBRACE');
  // duplicita výrobního čísla se nepovolí
  await page.goto('/?demo=1#/novy');
  await page.locator('#f_model').fill('X');
  await page.locator('#f_vyrobni_cislo').fill('41700101');
  await page.locator('form button[type=submit]').last().click();
  await expect(page.locator('#chyba')).toContainText('už existuje');

  await page.goto('/?demo=1');
  await karta(page, 'PH731-2219').click();
  await page.getByRole('link', { name: 'Přidat kalibraci' }).click();
  const datum = await page.locator('#f_datum_kalibrace').inputValue();
  const platnost = await page.locator('#f_platnost_do').inputValue();
  expect(Number(platnost.slice(0, 4))).toBe(Number(datum.slice(0, 4)) + 1); // předvyplněno + 12 měsíců
  await page.locator('#f_cislo_protokolu').fill('MB-26-0001');
  await page.locator('#f_soubor').setInputFiles({ name: 'protokol.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await bezPreteceni(page);
  await page.locator('form button[type=submit]').last().click();
  await expect(page.locator('.hero .tag')).toHaveClass(/platna/);
  await expect(page.getByRole('button', { name: 'Otevřít' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sdílet protokol' })).toBeVisible();
  await bezPreteceni(page);
  await page.getByRole('link', { name: 'Přehled' }).click();
  await expect(page.locator('section[data-skupina="Balometr"]')).toHaveAttribute('data-skupina-stav', 'zelena');
  await expect(karta(page, 'PH731-2219').locator('.next')).toHaveCount(0);
});

test('odeslání na kalibraci a návrat (rotace)', async ({ page }) => {
  await page.goto('/?demo=1#/');
  await karta(page, '41700102').click();
  await page.getByRole('link', { name: 'Odeslat na kalibraci' }).click();
  await page.locator('form button[type=submit]').last().click();
  await expect(page.locator('.hero .tag')).toHaveClass(/na_kalibraci/);
  await page.getByRole('link', { name: 'Vráceno – zadat kalibraci' }).click();
  await page.locator('form button[type=submit]').last().click();
  await expect(page.locator('.hero .tag')).toHaveClass(/platna/);
});

test('vyřazení dvojím klepnutím a přepínač vyřazených', async ({ page }) => {
  await page.goto('/?demo=1');
  await karta(page, '51088231').click();
  const btn = page.getByRole('button', { name: 'Vyřadit' });
  await btn.click();
  await expect(page.locator('.btn.confirm')).toHaveText('Klepni znovu pro vyřazení');
  await page.locator('.btn.confirm').click();
  await expect(page.locator('.hero .tag')).toHaveText('VYŘAZENO');
  await page.getByRole('link', { name: 'Přehled' }).click();
  await expect(karta(page, '51088231')).toHaveCount(0);
  await page.getByLabel('Zobrazit vyřazené').check();
  await expect(karta(page, '51088231')).toBeVisible();
});

test('prázdná skupina: šedá tečka, bez přístrojů, nepočítá se do souhrnu', async ({ page }) => {
  await page.goto('/?demo=1#/skupiny/nova');
  await page.locator('#f_nazev').fill('Teploměry');
  await page.locator('form button[type=submit]').last().click();
  await expect(page.locator('a.row', { hasText: 'Teploměry' })).toContainText('bez přístrojů');
  await expect(page.locator('a.row', { hasText: 'Teploměry' }).locator('.dot')).toHaveClass(/prazdna/);
  await page.getByRole('link', { name: 'Přehled' }).click();
  const sekce = page.locator('section[data-skupina="Teploměry"]');
  await expect(sekce).toHaveAttribute('data-skupina-stav', 'prazdna');
  await expect(sekce.locator('.ghead')).toHaveText('Bez přístrojů');
  await expect(page.locator('#souhrn .n')).toHaveText(['2', '1', '1']);
  const barva = await sekce.locator('.dot').evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = barva.match(/\d+/g).map(Number);
  expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(12); // šedá
  await page.getByRole('button', { name: 'Jen problémy' }).click();
  await expect(sekce).toHaveCount(0);
});

test('skupina „každý kus platný“: skryje min. platných a přepočítá stav', async ({ page }) => {
  await page.goto('/?demo=1#/skupiny/g1');
  await expect(page.locator('#f_min_platnych')).toBeVisible();
  await page.locator('#f_vsechny_platne').check();
  await expect(page.locator('#f_min_platnych')).toBeHidden();
  await bezPreteceni(page);
  await page.locator('form button[type=submit]').last().click();
  await expect(page.locator('a.row', { hasText: 'Anemometry' })).toContainText('každý kus platný');
  await page.getByRole('link', { name: 'Přehled' }).click();
  // 3 kusy: platný, propadlý, na kalibraci → nedostatek
  const sekce = page.locator('section[data-skupina="Anemometry lopatkové"]');
  await expect(sekce).toHaveAttribute('data-skupina-stav', 'cervena');
  await expect(sekce.locator('.ghead')).toContainText('Platné jen 1 z 3 potřebných');
  await expect(karta(page, '41700102')).not.toHaveClass(/tlumeny/); // propadlý už není tlumený
  await page.goto('/?demo=1#/skupiny/g1');
  await page.locator('#f_vsechny_platne').uncheck();
  await expect(page.locator('#f_min_platnych')).toBeVisible();
});

test('skupiny a nastavení se vykreslí bez přetečení', async ({ page }) => {
  await page.goto('/?demo=1#/skupiny');
  await expect(page.locator('h1')).toHaveText('Skupiny');
  await bezPreteceni(page);
  await page.goto('/?demo=1#/skupiny/g3');
  await expect(page.locator('#f_min_platnych')).toHaveValue('2');
  await bezPreteceni(page);
  await page.goto('/?demo=1#/nastaveni');
  await expect(page.locator('#verze')).toHaveText(/verze \d+/);
  await bezPreteceni(page);
});

test('zelená skupina: tlumené „Na řadě“ s datem odeslání', async ({ page }) => {
  await page.goto('/?demo=1#/p/p3');
  await page.getByRole('button', { name: 'Zrušit odeslání' }).click();
  await page.getByRole('link', { name: 'Přehled' }).click();
  // nejlepší kus platí ještě 210 dní, okno 30 + 14 → odeslat do dnes + 166
  const datum = await page.evaluate(() => Calc.formatDatum(Calc.plusDni(Calc.dnesPraha(), 166)));
  const next = page.locator('section[data-skupina="Anemometry lopatkové"] .ghead .next');
  await expect(next).toHaveText('Na řadě: SN 41700103 – Tomáš · odeslat do ' + datum);
  await expect(next).toHaveClass(/narade/);
});

test('horní lišta je zarovnaná s obsahem', async ({ page }) => {
  await page.goto('/?demo=1');
  const x1 = await page.locator('.bar .btn-text').first().evaluate((el) => el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft));
  const x2 = await page.locator('main h1').evaluate((el) => el.getBoundingClientRect().left);
  expect(Math.abs(x1 - x2)).toBeLessThanOrEqual(2);
  const r1 = await page.locator('.bar .btn-text').last().evaluate((el) => el.getBoundingClientRect().right);
  const r2 = await page.locator('main .seg').evaluate((el) => el.getBoundingClientRect().right);
  expect(Math.abs(r1 - r2)).toBeLessThanOrEqual(8);
});
