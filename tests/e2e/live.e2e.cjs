// End-to-end test of the connected (live) app: sign-up to customer approval, against a local database
// with the real migrations. Run with: npm run e2e   (needs PostgreSQL 15+ and Playwright's Chromium)
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PGURL = process.env.PGURL;
const SHOTS = process.env.SHOTS ?? path.join(os.tmpdir(), 'wrynch-e2e');
fs.mkdirSync(SHOTS, { recursive: true });
const photoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrynch-photos-'));
const PHOTOS = JSON.parse(fs.readFileSync(path.join(__dirname, 'photos.json'), 'utf8')).map((b64, i) => {
  const f = path.join(photoDir, `IMG_${i + 1}.jpg`); fs.writeFileSync(f, Buffer.from(b64, 'base64')); return f;
});
const S = SHOTS + '/';
const ROOT = `http://localhost:${process.env.PORT ?? 5173}`;
const APPD = process.env.APP_DOMAIN ?? 'wrynch.test', SITED = process.env.SITE_DOMAIN ?? 'getwrynch.test';
const APPRE = APPD.replace(/\./g, '\\.');
const B = `${ROOT}/app/`;
(async () => {
  // Map the production hostnames to this machine so shop addresses (1001.wrynch.app) are tested for real.
  const b = await chromium.launch({ args: [`--host-resolver-rules=MAP ${APPD} 127.0.0.1, MAP *.${APPD} 127.0.0.1, MAP ${SITED} 127.0.0.1`] });
  const ctx = await b.newContext({ viewport: { width: 400, height: 860 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const step = async (name, fn) => { try { await fn(); } catch (e) { errs.push(`STEP ${name}: ${e.message.split('\n')[0]}`); await p.screenshot({ path: S + 'fail-' + name + '.png', fullPage: true }); throw e; } };
  const shot = (n) => p.screenshot({ path: S + n + '.png', fullPage: true });
    try {
    await step('landing', async () => {
      await p.goto(ROOT + '/'); await p.waitForSelector('h1:has-text("Keep them moving")');
      if (!(await p.evaluate(() => fetch('/hero.jpg').then((r) => r.ok && r.headers.get('content-type') === 'image/jpeg')))) errs.push('hero image not served');
      await shot('L00-landing');
      await p.goto(ROOT + '/#/join/abc'); await p.waitForFunction(() => location.pathname === '/app/' && location.hash.startsWith('#/join'));
    });
    await step('template-preview', async () => {
      await p.goto(ROOT + '/#try'); await p.waitForSelector('text=Choose your inspection sheet');
      await p.setInputFiles('#tfile', PHOTOS[0]);
      await p.waitForSelector('#tresult:not([hidden]) >> text=parts Wrynch would track', { timeout: 20000 });
      const chips = await p.locator('.tparts span:not(.none)').count();
      if (!chips) errs.push('template preview showed no parts');
      await p.locator('#try').screenshot({ path: S + 'L00b-template-preview.png' });
    });
    await step('pilot-apply', async () => {
      await p.click('#tuse');
      await p.fill('input[name=shopName]', 'Reyes Auto Care'); await p.fill('input[name=contactName]', 'Jordan L.');
      await p.fill('input[name=email]', 'owner@shop.test'); await p.fill('input[name=techs]', '4');
      await p.click('#psend'); await p.waitForSelector('#pdone:not([hidden])');
      if (await p.locator('#pform').isVisible()) errs.push('pilot form still visible after applying');
      await p.locator('#pilot').screenshot({ path: S + 'L00c-pilot-applied.png' });
    });
    let pilotLink;
    await step('pilot-approve', async () => {
      const q = (sql) => require('child_process').spawnSync('psql', ['-Atc', sql, PGURL], { encoding: 'utf8' }).stdout.trim();
      const row = q("select id || '|' || (template is not null) from pilot_request where email = 'owner@shop.test'");
      if (!row.endsWith('|true')) errs.push('pilot application missing or without its template: ' + row);
      pilotLink = q(`select public.approve_pilot_request('${row.split('|')[0]}', '${ROOT}')`);
      if (!pilotLink.includes('/app/#/pilot/')) throw new Error('no pilot link: ' + pilotLink);
    });
    await step('signup', async () => {
      await p.goto(B); await p.waitForSelector('text=Sign in');
      if (await p.locator('text=New here: create an account').count()) errs.push('plain sign-in still offers sign-up');
      if (!(await p.locator('text=Apply for the pilot').count())) errs.push('sign-in does not point to the pilot');
      await shot('L01-signin');
      await p.goto(pilotLink); await p.waitForSelector('text=Welcome to the Wrynch pilot');
      if ((await p.inputValue('#em')) !== 'owner@shop.test') errs.push('pilot sign-up email not prefilled');
      await p.fill('#nm', 'Jordan L.'); await p.fill('#pw', 'password123');
      await p.click('button:has-text("Create account")');
      await p.waitForSelector('text=Set up your shop'); await shot('L02-create-shop');
      if ((await p.inputValue('#sn')) !== 'Reyes Auto Care') errs.push('shop name not prefilled from the application');
    });
    await step('create-shop', async () => {
      await p.fill('#sn', 'Reyes Auto Care'); await p.fill('#yn', 'Jordan L.');
      await p.click('button:has-text("Create shop")');
      await p.waitForSelector('h2:has-text("In the bays")'); await shot('L03-dashboard');
    });
    await step('invite', async () => {
      await p.goto(B + '#/settings/team'); await p.waitForSelector('text=Invite someone');
      await p.fill('#ie', 'tech@shop.test'); await p.click('button:has-text("Create invite link")');
      await p.waitForSelector('text=Waiting to join');
      await shot('L04-team');
    });
    await step('new-inspection', async () => {
      await p.goto(B + '#/new');
      await p.fill('#vin', 'JTEBU5JR4B5012345'); await p.fill('#yr', '2011'); await p.fill('#mk', 'Toyota'); await p.fill('#md', '4Runner'); await p.fill('#tr', 'SR5');
      await p.fill('#cn', 'Dana Reyes'); await p.fill('#cp', '555-0100'); await p.fill('#ro', '48213'); await p.fill('#od', '164210'); await p.fill('#cc', 'Check engine light on');
      await p.click('button:has-text("Create and set up vehicle")');
      await p.waitForSelector('text=What this vehicle has'); await shot('L05-setup');
      await p.click('[aria-label="Rear brakes"] button:has-text("Disc")');
      await p.click('[aria-label="Drivetrain"] button:has-text("AWD")');
      await p.click('[aria-label="Drivetrain"] button:has-text("4WD")');
      await p.check('label:has-text("Transfer case") input');
      await p.waitForTimeout(400);
      await p.click('text=Start inspection');
      await p.waitForSelector('text=points done'); await shot('L06-overview');
    });
    const inspId = p.url().split('/insp/')[1].split('/')[0];
    await step('upload', async () => {
      await p.goto(B + `#/insp/${inspId}/capture/under_car`);
      await p.setInputFiles('#files', PHOTOS);
      await p.waitForSelector('text=Sort photos');
      await p.waitForFunction(() => !document.querySelector('.toast[role=status]') || !/Uploading|sorting/.test(document.querySelector('.toast').textContent), null, { timeout: 30000 });
      await p.waitForTimeout(800); await shot('L07-sorted');
    });
    await step('place-and-confirm', async () => {
      const place = p.locator('button:text-is("Place")');
      for (let k = 0; k < 5 && await place.count(); k++) {
        // One photo, two parts: it should show up under both parts' points.
        await place.first().click(); await p.locator('.sheet .pill').nth(0).click(); await p.locator('.sheet .pill').nth(1).click();
        await p.locator('.sheet button:has-text("Save 2 parts")').click(); await p.waitForTimeout(700);
      }
      const confirm = p.locator('button:has-text("AI part matches")');
      if (await confirm.isEnabled()) { await confirm.click(); await p.waitForTimeout(800); }
      await shot('L08-confirmed');
    });
    await step('looks-ok', async () => {
      // The stub AI marks some parts "looks OK"; confirming records OK for them.
      for (const pid of ['S24', 'S25', 'S26', 'S27', 'S28', 'S29', 'S30', 'S31', 'S32', 'S33', 'S34']) {
        await p.goto(B + `#/insp/${inspId}/point/${pid}`); await p.waitForTimeout(300);
        const ok = p.locator('button:has-text("Confirm looks OK")');
        if (await ok.count()) { await shot('L08b-looks-ok'); await ok.click(); await p.waitForTimeout(700); return; }
      }
      errs.push('no AI "looks OK" suggestion found on under-car points');
    });
    await step('measure', async () => {
      await p.goto(B + `#/insp/${inspId}/c/` + encodeURIComponent('73@left_front') + '/S24');
      await p.waitForSelector('text=Pad lining thickness');
      await p.fill('input[id="v-brake_pad.lining_thickness"]', '1.5');
      await p.locator('button:has-text("Save")').first().click(); await p.waitForTimeout(900);
      await shot('L09-measure');
    });
    await step('finish-gate', async () => {
      // resolve AI findings, then mark every point "nothing found"
      await p.goto(B + `#/insp/${inspId}/finish`); await p.waitForTimeout(600);
      for (let k = 0; k < 10; k++) {
        const ai = p.locator('.dark a:has-text("AI finding")').first();
        if (!(await ai.count())) break;
        await ai.click(); await p.waitForSelector('.ai-card'); await p.locator('.ai-card button:has-text("Confirm")').first().click(); await p.waitForTimeout(700);
        await p.goto(B + `#/insp/${inspId}/finish`); await p.waitForTimeout(500);
      }
      // Something to report on a point with no note: the reservoir couldn't be checked.
      await p.goto(B + `#/insp/${inspId}/c/` + encodeURIComponent('38@') + '/S14'); await p.click('button:has-text("Couldn\'t check this part")');
      await p.locator('.sheet label.item').first().click(); await p.click('.sheet button:has-text("Save")'); await p.waitForTimeout(600);
      for (const pid of ['S01','S02','S03','S04','S05','S06','S07','S08','S09','S10','S11','S12','S13','S14','S15','S16','S17','S18','S19','S20','S21','S22','S23','S24','S25','S26','S27','S28','S29','S30','S31','S32','S33','S34']) {
        await p.goto(B + `#/insp/${inspId}/point/${pid}`); await p.waitForTimeout(250);
        const btn = p.locator('button:has-text("Nothing found")');
        if (await btn.count()) { await btn.click(); await p.waitForTimeout(500); }
      }
      await p.goto(B + `#/insp/${inspId}/point/S24`); await p.waitForTimeout(300);
      // AI note draft: built from confirmed ratings, shown for approval, saved only when approved.
      await p.click('button.ai-draft'); await p.waitForSelector('.ai-card textarea');
      const draft = await p.inputValue('.ai-card textarea');
      if (!draft.includes('1.5')) errs.push('note draft missing the confirmed measurement: ' + draft);
      if ((await p.inputValue('#note')) !== '') errs.push('draft was saved before approval');
      await p.locator('.ai-card').screenshot({ path: S + 'L09b-note-draft.png' });
      await p.click('.ai-card button.primary');
      await p.waitForFunction(() => (document.querySelector('#note')?.value ?? '').includes('1.5'), null, { timeout: 10000 })
        .catch(() => errs.push('approved draft did not become the note'));
      await p.waitForTimeout(800); // let the save reach the server before the note is overwritten below
      await p.fill('#note', 'fronts 5mm/rotors major grooving. rears 6mm'); await p.locator('#note').blur(); await p.waitForTimeout(600);
      // Automatic notes: once everything is rated, Finish rewords written notes and drafts blank ones in the shop's style.
      await p.goto(B + '#/settings'); await p.click('[aria-label="Automatic note style"] button:has-text("Technical")');
      await p.waitForFunction(() => document.querySelector('[aria-label="Automatic note style"] button[aria-pressed="true"]')?.textContent === 'Technical');
      await p.waitForTimeout(600);
      await p.goto(B + `#/insp/${inspId}/finish`);
      await p.waitForSelector('.note-review[data-point="S24"]', { timeout: 20000 }).catch(() => errs.push('no automatic note for the written S24 note'));
      await p.waitForFunction(() => !/Writing notes/.test(document.querySelector('.auto-notes')?.textContent ?? ''), null, { timeout: 30000 });
      if (!(await p.locator('.auto-notes >> text=Technical').count())) errs.push('finish screen does not show the note style');
      if (!(await p.locator('.note-review:has-text("Drafted")').count())) errs.push('no blank point got a drafted note');
      if (await p.locator('button:has-text("Send to advisor")').isEnabled()) errs.push('send allowed with notes waiting for approval');
      const s24 = await p.inputValue('.note-review[data-point="S24"] textarea').catch(() => '');
      if (!s24.includes('5') || !s24.includes('6')) errs.push('reworded note lost a measurement: ' + s24);
      await shot('L10-finish-notes');
      await p.fill('.note-review[data-point="S24"] textarea', s24 + ' Recheck at next service.');
      await p.click('.note-review[data-point="S24"] button:has-text("Approve edit")'); await p.waitForTimeout(700);
      for (let k = 0; k < 40 && await p.locator('.note-review').count(); k++) { await p.locator('.note-review button:has-text("Approve")').first().click(); await p.waitForTimeout(500); }
      await p.goto(B + `#/insp/${inspId}/finish`); await p.waitForTimeout(1200); await shot('L10-finish');
      if (await p.locator('.note-review').count()) errs.push('automatic notes were written again after approval');
      await p.click('button:has-text("Send to advisor")'); await p.waitForSelector('text=Inspection results', { timeout: 10000 });
      await p.setViewportSize({ width: 1300, height: 900 }); await p.waitForTimeout(500); await shot('L11-advisor');
    });
    let link;
    await step('estimate-send', async () => {
      await p.locator('button:has-text("+ Price")').first().click();
      await p.fill('#ep', '42.50'); await p.fill('#el', '60'); await p.click('.sheet button:has-text("Save")'); await p.waitForTimeout(900);
      await p.click('button:has-text("Send to customer")');
      await p.click('.sheet button:has-text("Copy link")'); await p.click('.sheet button:has-text("Create link")');
      await p.waitForSelector('input[aria-label="Customer link"]');
      link = await p.inputValue('input[aria-label="Customer link"]');
      await shot('L12-send');
    });
    await step('customer', async () => {
      const c = await b.newPage({ viewport: { width: 400, height: 860 } });
      c.on('pageerror', (e) => errs.push('customer pageerror: ' + e.message));
      await c.goto(link.replace(/^https?:\/\/[^/]+/, `http://localhost:${process.env.PORT ?? 5173}`)); await c.waitForSelector('text=Vehicle inspection report');
      await c.waitForTimeout(800); await c.screenshot({ path: S + 'L13-customer.png', fullPage: true });
      await c.locator('label:has-text("Approve this repair") input').first().check(); await c.waitForTimeout(800);
      const body = await c.textContent('body');
      if (!body.includes('Recheck at next service.')) errs.push('approved automatic note missing for customer');
      if (body.includes('fronts 5mm/rotors')) errs.push('customer sees the raw tech note instead of the approved one');
      if (body.includes('Uneven wear (minor)')) errs.push('severity jargon shown to customer');
      await c.close();
      await p.reload(); await p.waitForTimeout(1500); await shot('L14-advisor-after');
      const approved = await p.locator('text=Approved').count();
      if (!approved) errs.push('approval not visible to advisor');
    });
    await step('shop-address', async () => {
      const port = process.env.PORT ?? 5173;
      const num = require('child_process').spawnSync('psql', ['-Atc', "select number from shop where name = 'Reyes Auto Care'", PGURL], { encoding: 'utf8' }).stdout.trim();
      if (!/^\d{4,}$/.test(num)) throw new Error('no shop number: ' + num);
      // Wait until the page is on this shop's address (tolerating redirects that replace one another).
      const atShop = async (page, path = '') => {
        const re = new RegExp(`^http://${num}\\.${APPRE}:${port}/${path.replace(/[#/]/g, (c) => '\\' + c)}`);
        for (let k = 0; k < 20; k++) { if (re.test(page.url())) return; await page.waitForTimeout(500); }
        throw new Error('not on the shop address: ' + page.url());
      };
      const ctx2 = await b.newContext({ viewport: { width: 1280, height: 860 } });
      const q = await ctx2.newPage();
      q.on('pageerror', (e) => errs.push('shop-address pageerror: ' + e.message));
      // Sign in on wrynch.app: land on the shop's own address, signed in.
      await q.goto(`http://${APPD}:${port}/`); await q.waitForSelector('text=Sign in');
      await q.fill('#em', 'owner@shop.test'); await q.fill('#pw', 'password123'); await q.click('button:has-text("Sign in")');
      await atShop(q); await q.waitForSelector('h2:has-text("In the bays")');
      if (!(await q.locator(`text=#${num}`).count())) errs.push('shop number not shown');
      await q.screenshot({ path: S + 'L15-shop-address.png' });
      // The marketing domain's /app goes to the app; the shared sign-in carries over to the shop address.
      await q.goto(`http://${SITED}:${port}/app/`).catch(() => undefined); await atShop(q); await q.waitForSelector('h2:has-text("In the bays")');
      // Someone else's (or a mistyped) shop number sends you to your own shop.
      await q.goto(`http://9999.${APPD}:${port}/#/jobs`).catch(() => undefined); await atShop(q, '#/jobs');
      // Customer report links are served on the shop's address without signing in.
      const tok = require('child_process').spawnSync('psql', ['-Atc', "select report_token from inspection where status = 'sent' limit 1", PGURL], { encoding: 'utf8' }).stdout.trim();
      const c2 = await b.newPage(); await c2.goto(`http://${num}.${APPD}:${port}/#/r/${tok}`); await c2.waitForSelector('text=Vehicle inspection report'); await c2.close();
      // The marketing site still opens at getwrynch.com.
      await q.goto(`http://${SITED}:${port}/`); await q.waitForSelector('h1:has-text("Keep them moving")');
      await ctx2.close();
    });
  } catch (e) { /* recorded */ }
  const db = require('child_process').spawnSync('psql', ['-Atc', "select config->>'drivetrain', config->>'transferCase' from vehicle", PGURL], { encoding: 'utf8' }).stdout.trim();
  if (db !== '4wd|true') errs.push('vehicle config in database: ' + db);
  const real = errs.filter((e) => !/ERR_TUNNEL_CONNECTION_FAILED|fonts\.g/.test(e));
  await b.close();
  if (real.length) {
    // In GitHub Actions, also report each failure as an annotation so it shows on the check without opening logs.
    if (process.env.GITHUB_ACTIONS) for (const e of real) console.log(`::error title=E2E::${String(e).replace(/\r?\n/g, ' ').slice(0, 900)}`);
    console.error('E2E FAILED', JSON.stringify(real, null, 1), `screenshots: ${SHOTS}`); process.exit(1);
  }
  console.log('E2E PASSED: sign-up, shop, invite, new inspection, upload + AI sort, measurement, finish, estimate, send, customer approval');
})();
