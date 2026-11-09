/**
 * Optional UI smoke test (not part of `npm test`). Drives the running app in a
 * real browser and checks the main workflows end to end.
 *
 * It MODIFIES data, so run it against a scratch fixture database:
 *   1. npm i --no-save playwright && npx playwright install chromium
 *   2. DATABASE_PATH=./data/e2e.db LISTING_PROVIDER=fixture npm run dev   (fresh file)
 *   3. curl -X POST http://localhost:3000/api/scan                       (first fixture scan)
 *   4. node e2e/smoke.mjs http://localhost:3000
 * Afterwards delete ./data/e2e.db.
 */
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:3000';
const results = [];
const check = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };
const tabCount = async (page, label) => {
  const link = page.getByRole('link', { name: new RegExp(`^${label}\\s*\\d*$`) }).first();
  const t = (await link.textContent()) || '';
  const m = t.match(/(\d+)\s*$/); return m ? Number(m[1]) : NaN;
};
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const settle = () => page.waitForLoadState('networkidle').then(() => page.waitForTimeout(500));

  // 1. Feed renders with counts
  await page.goto(`${BASE}/finder`); await settle();
  const matches0 = await tabCount(page, 'Matches');
  const dismissed0 = await tabCount(page, 'Dismissed');
  check('Finder shows match count', matches0 > 0, `matches=${matches0}`);

  // 2. Save first card → appears in Saved, survives reload
  const firstCard = page.locator('article').first();
  const firstTitle = (await firstCard.locator('a').nth(1).textContent()).trim();
  await firstCard.getByRole('button', { name: 'Save item' }).click(); await settle();
  await page.goto(`${BASE}/saved`); await settle();
  check('Saved item appears in Saved Items', (await page.locator('article').count()) === 1 && (await page.locator('article').first().textContent()).includes(firstTitle.slice(0, 20)), firstTitle);
  await page.reload(); await settle();
  check('Saved state persists after reload', (await page.locator('article').count()) === 1);

  // 3. Dismiss second card in Matches
  await page.goto(`${BASE}/finder`); await settle();
  const second = page.locator('article').nth(1);
  const secondTitle = (await second.locator('a').nth(1).textContent()).trim();
  await second.getByRole('button', { name: /^Dismiss$/ }).click(); await settle();
  await page.reload(); await settle();
  const matches1 = await tabCount(page, 'Matches');
  const dismissed1 = await tabCount(page, 'Dismissed');
  check('Dismiss removes item from Matches', matches1 === matches0 - 1, `${matches0} → ${matches1}`);
  check('Dismissed tab counts it', dismissed1 === dismissed0 + 1, `${dismissed0} → ${dismissed1}`);
  await page.goto(`${BASE}/finder?view=dismissed`); await settle();
  check('Dismissed view shows the item', (await page.locator('article').first().textContent()).includes(secondTitle.slice(0, 20)), secondTitle);

  // 4. Mark reviewed + review filter
  await page.goto(`${BASE}/finder`); await settle();
  const third = page.locator('article').nth(1);
  const thirdTitle = (await third.locator('a').nth(1).textContent()).trim();
  await third.getByRole('button', { name: /Mark reviewed/ }).click(); await settle();
  await page.goto(`${BASE}/finder?rev=reviewed`); await settle();
  check('Reviewed filter shows the reviewed item', (await page.locator('article').count()) === 1 && (await page.locator('article').first().textContent()).includes(thirdTitle.slice(0, 20)), thirdTitle);

  // 5. Add a category-wide pricing rule → recalculated without scan
  await page.goto(`${BASE}/cost`); await settle();
  const addForm = page.locator('form', { has: page.getByRole('button', { name: 'Add rule' }) });
  await addForm.locator('select[name=categoryId]').selectOption({ label: 'Shirts' });
  await addForm.locator('input[name=retail]').fill('100');
  await addForm.locator('input[name=percent]').fill('50');
  const preview = await addForm.textContent();
  check('Rule form previews max price', preview.includes('$50.00'));
  await addForm.locator('input[name=retailSource]').fill('E2E test value');
  await addForm.getByRole('button', { name: 'Add rule' }).click(); await settle();
  const ruleRow = await page.locator('table').first().textContent();
  check('Rule appears in table with computed max', ruleRow.includes('$100.00') && ruleRow.includes('50%') && ruleRow.includes('$50.00'));
  const eligibleText = await page.locator('a', { hasText: 'Price-eligible' }).first().textContent();
  const eligibleN = Number((eligibleText.match(/(\d+)/) || [])[1]);
  check('Price-eligible count recalculated', eligibleN > 0, `eligible=${eligibleN}`);
  await page.goto(`${BASE}/finder?view=all&q=Norse%20Projects%20Niels`); await settle();
  check('Norse tee now shows "Within ceiling" ($35 + $5.50 ≤ $50)', (await page.locator('article').first().textContent()).includes('Within ceiling'));

  // 5b. Edit the rule through the expandable row (50% → 60%)
  await page.goto(`${BASE}/cost`); await settle();
  await page.getByRole('button', { name: /^Edit/ }).first().click();
  const editForm = page.locator('form', { has: page.getByRole('button', { name: 'Save rule' }) });
  check('Rule editor opens fully visible', await editForm.isVisible());
  await editForm.locator('input[name=percent]').fill('60');
  await editForm.getByRole('button', { name: 'Save rule' }).click(); await settle();
  await page.reload(); await settle();
  const ruleRow2 = await page.locator('table').first().textContent();
  check('Edited rule recalculates max ($60.00)', ruleRow2.includes('60%') && ruleRow2.includes('$60.00'));

  // 5c. Edit a brand alias through the expandable row
  await page.goto(`${BASE}/preferences`); await settle();
  const kitonRow = page.locator('tr', { hasText: 'Kiton' }).first();
  await kitonRow.getByRole('button', { name: /^Edit/ }).click();
  const brandForm = page.locator('form', { has: page.getByRole('button', { name: 'Save brand' }) });
  await brandForm.locator('input[name=aliases]').fill('Kiton Napoli, CIPA 1956');
  await brandForm.getByRole('button', { name: 'Save brand' }).click(); await settle();
  await page.reload(); await settle();
  check('Brand alias saved', ((await page.locator('tr', { hasText: 'Kiton' }).first().textContent()) || '').includes('CIPA 1956'));

  // 5d. Change a material priority via select
  const polyRow = page.locator('tr', { hasText: 'Polyester' }).first();
  await polyRow.locator('select').selectOption('exclude'); await settle();
  await page.goto(`${BASE}/finder?view=excluded&q=Acne`); await settle();
  check('Polyester set to Exclude → polyester-heavy Acne tee excluded', ((await page.locator('article').first().textContent()) || '').includes('excluded'));
  await page.goto(`${BASE}/preferences`); await settle();
  await page.locator('tr', { hasText: 'Polyester' }).first().locator('select').selectOption('avoid'); await settle();

  // 6. Disable a brand → re-evaluated
  await page.goto(`${BASE}/preferences`); await settle();
  await page.getByRole('switch', { name: 'Norse Projects enabled' }).click(); await settle();
  await page.goto(`${BASE}/finder?view=excluded&q=Norse%20Projects%20Niels`); await settle();
  const exText = (await page.locator('article').first().textContent()) || '';
  check('Disabling Norse Projects moves its listing to Excluded with reason', exText.includes('disabled'), exText.slice(0, 160));
  await page.goto(`${BASE}/preferences`); await settle();
  await page.getByRole('switch', { name: 'Norse Projects enabled' }).click(); await settle();

  // 7. Profile size override + reset (Heritage Jackets: XL jackets)
  await page.goto(`${BASE}/profiles`); await settle();
  const hjCard = page.locator('article', { hasText: 'Heritage Jackets' });
  await hjCard.getByRole('link', { name: 'Edit' }).click(); await settle();
  const jacketBlock = page.locator('div.py-4', { hasText: 'Jackets & Outerwear' }).first();
  await jacketBlock.locator('summary').click();
  await jacketBlock.locator('input[name=accepted]').fill('44R, XL');
  await jacketBlock.locator('input[name=review]').fill('');
  await jacketBlock.getByRole('button', { name: 'Save size override' }).click(); await settle();
  check('Size override shows as Override', (await page.locator('div.py-4', { hasText: 'Jackets & Outerwear' }).first().textContent()).includes('Override'));
  const profileUrl = page.url();
  await page.goto(`${BASE}/finder?q=Belstaff`); await settle();
  check('Belstaff XL jacket now matches via Heritage Jackets override', (await page.locator('article').count()) === 1 && (await page.locator('article').first().textContent()).includes('Heritage Jackets'));
  await page.goto(profileUrl); await settle();
  await page.locator('div.py-4', { hasText: 'Jackets & Outerwear' }).first().getByRole('button', { name: 'Reset to default' }).click(); await settle();
  await page.reload(); await settle();
  check('Reset restores inheritance', (await page.locator('div.py-4', { hasText: 'Jackets & Outerwear' }).first().textContent()).includes('Inherited'));

  // 8. Drawer + product override
  await page.goto(`${BASE}/finder?view=all&q=Norse%20Projects%20Niels`); await settle();
  await page.locator('article').first().locator('a').nth(1).click(); await settle();
  check('Detail drawer opens', await page.getByRole('dialog').isVisible());
  const dlg = page.getByRole('dialog');
  await dlg.locator('input[name=retail]').fill('60');
  await dlg.locator('input[name=percent]').fill('50');
  await dlg.getByRole('button', { name: /Save override/ }).click();
  // The save refreshes the drawer without a page load; wait for the result to render.
  await dlg.getByText(/· product override/).first().waitFor({ timeout: 15000 }).catch(() => {}); await settle();
  const dlgText = await page.getByRole('dialog').textContent();
  check('Product override takes precedence (max $30 → over ceiling)', dlgText.includes('product override') && dlgText.includes('$30.00 ceiling') && dlgText.includes('Over ceiling'), '');
  await page.keyboard.press('Escape'); await settle();
  check('Escape closes the drawer', !(await page.getByRole('dialog').isVisible().catch(() => false)));

  // 9. Run scan from UI → batch 2 appears
  await page.goto(`${BASE}/scans`); await settle();
  const before = await page.locator('tbody tr').count();
  await page.locator('main').getByRole('button', { name: 'Run fixture scan' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('new matches') || document.body.innerText.includes('Scan failed'), null, { timeout: 60000 });
  await settle(); await page.reload(); await settle();
  const after = await page.locator('tbody tr').count();
  check('Scan from UI records a new run', after === before + 1, `${before} → ${after}`);
  await page.goto(`${BASE}/finder?q=Loro%20Piana%20Cashmere%20Bomber`); await settle();
  check('Second scan discovered batch-2 listing', (await page.locator('article').count()) === 1);
  await page.goto(`${BASE}/saved`); await settle();
  check('Saved item still saved after rescan', (await page.locator('article').count()) === 1);

  console.log(results.join('\n'));
  console.log(errors.length ? `\nConsole/page errors (${errors.length}):\n` + errors.slice(0, 10).join('\n') : '\nNo console errors.');
  await browser.close();
})().catch((e) => { console.log(results.join('\n')); console.error('E2E crashed:', e.message); process.exit(1); });
