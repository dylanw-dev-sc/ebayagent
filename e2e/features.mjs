/**
 * Optional browser test (not part of `npm test`) for fit by measurements,
 * counterfeit red flags, one-click corrections, keyboard triage, bulk
 * pricing setup (grid + CSV), the knitwear category, color preferences and
 * costing (% of retail, the deals slider, seller-stated retail, online new prices).
 *
 * It MODIFIES data, so run it against its own scratch fixture database
 * (not one already used by e2e/smoke.mjs):
 *   1. npm i --no-save playwright && npx playwright install chromium
 *   2. DATABASE_PATH=./data/e2e-features.db LISTING_PROVIDER=fixture npm run dev   (fresh file)
 *   3. curl -X POST http://localhost:3000/api/scan                                (first fixture scan)
 *   4. node e2e/features.mjs http://localhost:3000
 * Afterwards delete ./data/e2e-features.db.
 */
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:3000';
const results = [];
const check = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const settle = () => page.waitForLoadState('networkidle').then(() => page.waitForTimeout(500));
  // Server actions and keyboard navigation happen without a page load, so wait
  // for their visible result rather than a fixed delay.
  const shows = (scope, text, timeout = 15000) => scope.getByText(text).first().waitFor({ timeout }).then(() => true, () => false);
  const leaves = (url, timeout = 10000) => page.waitForURL((u) => u.toString() !== url, { timeout }).then(() => true, () => false);
  const cardText = async () => ((await page.locator('article').first().textContent()) || '');
  const scanAndWait = async () => {
    await page.request.post(`${BASE}/api/scan`);
    for (let i = 0; i < 120; i++) {
      const st = await (await page.request.get(`${BASE}/api/status`)).json();
      if (!st.running) return st.scan?.status;
      await page.waitForTimeout(500);
    }
    return 'still running';
  };

  // 1. Fit by measurements: a jacket pit-to-pit range in Preferences → Categories
  await page.goto(`${BASE}/preferences#categories`); await settle();
  const jacketCard = page.locator('div.card', { hasText: 'Jackets & Outerwear' }).filter({ has: page.locator('input[name=m_chest_min]') }).first();
  await jacketCard.locator('input[name=m_chest_min]').fill('22');
  await jacketCard.locator('input[name=m_chest_max]').fill('23.5');
  await jacketCard.getByRole('button', { name: 'Save category' }).click();
  await shows(page, 'Category saved'); await settle();
  await page.goto(`${BASE}/finder?q=Valstarino`); await settle();
  check('IT 54 Valstar with fitting measurements is now a Match', (await page.locator('article').count()) === 1 && (await cardText()).includes('Match'));
  await page.goto(`${BASE}/finder?view=excluded&q=Herno%20Down`); await settle();
  check('"54" Herno measuring 21 in is now Excluded with the reason', (await cardText()).includes('below your 22–23.5 in range'));

  // 2. Counterfeit red flags (default policy: exclude)
  await page.goto(`${BASE}/finder?view=excluded&q=Inspired`); await settle();
  check('"Inspired By Loro Piana" is excluded as a counterfeit red flag', (await cardText()).includes('counterfeit red flag') && (await cardText()).includes('Red flag'));
  await page.goto(`${BASE}/finder?q=Loro%20Piana%20Polo%20Shirt%20Size%20Large`); await settle();
  check('"not a replica" description is not flagged', (await page.locator('article').count()) === 1 && !(await cardText()).includes('Red flag'));

  // 3. One-click correction: accept 40R from the Boglioli listing
  await page.goto(`${BASE}/finder?view=excluded&q=Boglioli%20K%20Jacket`); await settle();
  await page.locator('article').first().locator('a').nth(1).click(); await settle();
  const dlg = page.getByRole('dialog');
  await dlg.getByText('Wrong decision? Fix the rule').click();
  await dlg.getByRole('button', { name: 'Accept 40R' }).click();
  check('Applying "Accept 40R" re-evaluates the open listing', await shows(dlg, '40R is now accepted'));
  await page.keyboard.press('Escape'); await settle();
  await page.goto(`${BASE}/finder?view=review&q=Boglioli%20K%20Jacket`); await settle();
  check('Boglioli 40R moves to Needs review (its fabric was never fetched)', (await cardText()).includes('item details not fetched yet'));
  const scanStatus = await scanAndWait();
  await page.goto(`${BASE}/finder?q=Boglioli%20K%20Jacket`); await settle();
  check('Next scan fetches its details → Match', (await page.locator('article').count()) === 1 && (await cardText()).includes('Match'), scanStatus === 'completed' ? '' : `scan ${scanStatus}`);

  // 4. Keyboard triage in the detail view
  await page.goto(`${BASE}/finder`); await settle();
  const firstTitle = ((await page.locator('article').first().locator('a').nth(1).textContent()) || '').trim();
  await page.locator('article').first().locator('a').nth(1).click(); await settle();
  const drawerText = (await page.getByRole('dialog').textContent()) || '';
  check('Detail view shows position and shortcuts', drawerText.includes('1 of') && drawerText.includes('dismiss & next'));
  const url1 = page.url();
  await page.keyboard.press('s'); await settle();
  await page.keyboard.press('j');
  const movedNext = await leaves(url1); await settle();
  const url2 = page.url();
  check('J moves to the next listing', movedNext && /listing=\d+/.test(url2));
  await page.keyboard.press('k');
  await page.waitForURL(url1, { timeout: 10000 }).catch(() => {}); await settle();
  check('K moves back', page.url() === url1);
  await page.keyboard.press('j');
  await page.waitForURL(url2, { timeout: 10000 }).catch(() => {}); await settle();
  await page.keyboard.press('d');
  check('D dismisses and moves on', await leaves(url2)); await settle();
  await page.keyboard.press('Escape'); await settle();
  await page.goto(`${BASE}/saved`); await settle();
  check('S saved the first listing', (await cardText()).includes(firstTitle.slice(0, 18)));
  await page.goto(`${BASE}/finder?view=dismissed`); await settle();
  check('D dismissed the second listing', (await page.locator('article').count()) === 1);

  // 5. Brand × category pricing grid
  await page.goto(`${BASE}/cost?rules=grid`); await settle();
  await page.locator('input[name=defaultPercent]').fill('40');
  await page.getByLabel('All brands (category-wide) Shirts retail').fill('100');
  await page.getByLabel('Sunspel Shirts retail').fill('120');
  await page.getByLabel('Sunspel Shirts allowed percent').fill('50');
  await page.getByRole('button', { name: 'Save grid' }).first().click();
  check('Grid save reports what changed', await shows(page, '2 added'));
  await page.goto(`${BASE}/cost`); await settle();
  const rulesText = (await page.locator('table').first().textContent()) || '';
  check('Grid rules appear with computed maxima ($40 category-wide, $60 Sunspel)', rulesText.includes('$40.00') && rulesText.includes('$60.00'));

  // 6. CSV template download + import
  const tpl = await (await page.request.get(`${BASE}/api/pricing-rules?template=1`)).text();
  check('Template CSV downloads with header and rows', tpl.startsWith('category,brand,material,reference_retail_usd') && tpl.split('\n').length > 100);
  const csv = 'category,brand,reference_retail_usd,allowed_percent,retail_source,notes,active\nJackets & Outerwear,Kiton,6500,25,kiton.com,,yes\nShirts,Nobody,1,1,,,\n';
  await page.locator('input[name=file]').setInputFiles({ name: 'rules.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const imported = await shows(page, 'Line 3: unknown brand');
  check('CSV import adds valid rows and reports bad lines', imported && ((await page.textContent('body')) || '').includes('1 added'));
  await settle();
  check('Imported Kiton rule ($1,625 max) is listed', ((await page.locator('table').first().textContent()) || '').includes('$1,625.00'));

  // 7. Sweaters & knitwear (eBay category 11484)
  await page.goto(`${BASE}/finder?q=John%20Smedley%20Merino%20Wool%20Crew%20Neck%20Sweater`); await settle();
  check('Knitwear: the merino crewneck (L) is a Match, with its color', (await page.locator('article').count()) === 1 && (await cardText()).includes('Match') && (await cardText()).includes('Charcoal'));

  // 8. Color preferences
  const choose = async (label, value) => {
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/preferences'), { timeout: 15000 }).catch(() => null),
      page.getByLabel(label).selectOption(value),
    ]);
    await settle();
  };
  await page.goto(`${BASE}/preferences#colors`); await settle();
  await choose('Navy preference', 'exclude');
  await choose('Green preference', 'prefer');
  await page.goto(`${BASE}/finder?view=excluded&q=Sunspel%20Classic%20Crew`); await settle();
  check('Excluding Navy excludes a navy-only listing, with the reason', (await cardText()).includes('navy, which you excluded'));
  await page.goto(`${BASE}/finder?view=all&color=navy`); await settle();
  const navyCards = await page.locator('article').allInnerTexts();
  check('Color filter shows only navy listings', navyCards.length > 0 && navyCards.every((t) => t.includes('Navy')), `${navyCards.length} cards`);
  await page.goto(`${BASE}/finder?view=all&sort=color`); await settle();
  check('Sorting by color preference puts your preferred color first', (await cardText()).includes('Green'));

  // 9. Measuring guide next to the measurement ranges
  await page.goto(`${BASE}/preferences#categories`); await settle();
  const guide = page.locator('details', { hasText: 'How to measure' }).first();
  await guide.locator('summary').click();
  check('"How to measure" guide opens beside the measurement ranges', await guide.getByText('1 inch below the armpits').isVisible());

  // 10. Costing: % of retail, the deals slider, your default %, seller-stated retail
  await page.goto(`${BASE}/cost`); await settle();
  const dealsCount = async () => Number((((await page.locator('#deals-title').locator('xpath=following-sibling::p[1]').innerText()) || '').match(/^(\d+)/) || [])[1]);
  const slider = page.getByLabel('Maximum % of retail');
  await slider.fill('80'); await page.waitForTimeout(250);
  const at80 = await dealsCount();
  await slider.fill('5'); await page.waitForTimeout(250);
  const at5 = await dealsCount();
  check('Deals slider filters listings by % of retail', at80 > 0 && at5 <= at80, `${at5} at 5%, ${at80} at 80%`);
  await slider.fill('25');
  await page.getByRole('button', { name: 'Make 25% my default' }).click();
  check('The slider saves your default %', await shows(page, 'Your default is 25%'));
  await page.goto(`${BASE}/finder?sort=pct`); await settle();
  check('Finder sorts by lowest % of retail and shows it on cards', (await cardText()).includes('of retail'));
  await page.goto(`${BASE}/finder?view=all&q=Cashmere%20Cardigan`); await settle();
  await page.locator('article').first().locator('a').nth(1).click(); await settle();
  const costDlg = page.getByRole('dialog');
  const claimShown = await shows(costDlg, 'The seller says retail is');
  await costDlg.getByRole('button', { name: 'Use it for this listing' }).click();
  check("Seller's stated retail can be used for that listing with one click", claimShown && (await shows(costDlg, 'In use for this listing')) && (await shows(costDlg, 'Seller-stated retail (unverified)')));
  await page.keyboard.press('Escape'); await settle();

  // 11. Online new prices (fixture mode: sample stores, clearly labeled)
  await page.goto(`${BASE}/cost`); await settle();
  const onlineCard = page.locator('section', { has: page.locator('#online') });
  const onlineText = (await onlineCard.innerText()) || '';
  check('Scans looked up new prices (sample stores) within the monthly cap', /of 1,000 lookups/.test(onlineText) && /Sample online prices/.test(onlineText) && /\$[\d,]+\.\d\d · \d stores/.test(onlineText));
  const onlineDeal = page.locator('section[aria-labelledby=deals-title] li', { hasText: 'Online price' }).first();
  await page.getByLabel('Maximum % of retail').fill('80'); await page.waitForTimeout(250);
  await onlineDeal.locator('a').nth(1).click(); await settle();
  const odlg = page.getByRole('dialog');
  const sourcesShown = await shows(odlg, 'sample-store-');
  await odlg.getByRole('button', { name: /^Use \$/ }).click();
  check('A listing shows its online stores, and the online price can be saved as yours', sourcesShown && (await shows(odlg, 'as your price')));
  await page.keyboard.press('Escape'); await settle();

  console.log(results.join('\n'));
  console.log(errors.length ? `\nConsole/page errors (${errors.length}):\n` + errors.slice(0, 10).join('\n') : '\nNo console errors.');
  await browser.close();
  if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
})().catch((e) => { console.log(results.join('\n')); console.error('E2E crashed:', e.message); process.exit(1); });
