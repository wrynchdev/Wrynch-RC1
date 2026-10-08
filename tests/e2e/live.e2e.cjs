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
  const b = await chromium.launch({ args: [`--host-resolver-rules=MAP ${APPD} 127.0.0.1, MAP *.${APPD} 127.0.0.1, MAP ${SITED} 127.0.0.1`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, permissions: ['camera'] });
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
    await step('admin-panel', async () => {
      // Wrynch staff review pilot applications in the app: the used one shows the shop it became; a new one is approved
      // (email isn't set up in this run, so the link is shown to copy). Non-staff never see the panel.
      const q = (sql) => require('child_process').spawnSync('psql', ['-Atc', sql, PGURL], { encoding: 'utf8' }).stdout.trim();
      await p.goto(B + '#/admin');
      await p.waitForSelector('[role=alert]:has-text("access to the admin panel")');
      if (await p.locator('a:has-text("Wrynch admin")').count()) errs.push('admin link shown to someone who is not staff');
      q("insert into platform_admin (user_id) select id from auth.users where email = 'owner@shop.test'");
      const r = await p.request.post(`${ROOT}/api/pilot`, { data: { shopName: 'Corner Garage', contactName: 'Sam Lee', email: 'sam@corner.test', techs: '2' } });
      if (!r.ok()) errs.push('second pilot application failed: ' + r.status());
      await p.goto(B + '#/settings'); await p.reload();
      await p.waitForSelector('a:has-text("Wrynch admin")', { timeout: 10000 }).catch(() => errs.push('admin link missing for staff'));
      await p.goto(B + '#/admin');
      const card = p.locator('section[aria-label="Corner Garage"]');
      await card.waitFor({ timeout: 10000 });
      await shot('L03b-admin-pilots');
      await card.locator('button:has-text("Approve and email link")').click();
      await card.locator('input[id^="link-"]').waitFor({ timeout: 10000 }).catch(() => {});
      if (q("select status from pilot_request where email = 'sam@corner.test'") !== 'approved') errs.push('approving in the admin panel was not saved');
      const link = await p.locator('section[aria-label="Corner Garage"] input[id^="link-"]').inputValue().catch(() => '');
      if (!/#\/pilot\/[0-9a-f]{64}$/.test(link)) errs.push('approved application shows no sign-up link: ' + link);
      await p.click('button:has-text("Signed up")');
      await p.waitForSelector('text=as Reyes Auto Care', { timeout: 10000 }).catch(() => errs.push('used application does not name its shop'));
      await p.click('button:has-text("Shops")');
      await p.waitForSelector('td:has-text("Reyes Auto Care")', { timeout: 10000 }).catch(() => errs.push('shops list missing the shop'));
      await shot('L03c-admin-shops');
    });
    await step('tekmetric', async () => {
      // Owner links Tekmetric; a "repair order created" notification imports the RO; pulling by number finds the same one.
      await p.goto(B + '#/settings'); await p.waitForSelector('#tm-shop');
      await p.fill('#tm-shop', '238'); await p.click('form:has(#tm-shop) button:has-text("Save")');
      const hookInput = p.locator('input[aria-label="Webhook address"]');
      await hookInput.waitFor({ timeout: 10000 });
      const token = new URL(await hookInput.inputValue()).searchParams.get('token');
      const r = await p.request.post(`http://localhost:${process.env.PORT ?? 5173}/api/tekmetric-webhook?token=${token}`, { data: { event: 'Repair Order Created', data: { id: 55 } } });
      const out = await r.json().catch(() => ({}));
      if (!out.inspectionId) errs.push('Tekmetric notification did not import the repair order: ' + JSON.stringify(out));
      await p.reload(); await p.waitForSelector('text=RO 10421', { timeout: 10000 }).catch(() => errs.push('import not shown in Tekmetric activity'));
      await shot('L04b-tekmetric');
      await p.goto(B + '#/new'); await p.fill('input[aria-label="Tekmetric RO number"]', '10421'); await p.click('button:has-text("Pull")');
      await p.waitForFunction(() => location.hash.includes('/setup/'), null, { timeout: 15000 }).catch(() => errs.push('pull by RO number did not open the inspection'));
      if (out.inspectionId && !p.url().includes(out.inspectionId)) errs.push('pulling the same RO made a second inspection');
      await p.waitForSelector('text=Honda', { timeout: 10000 }).catch(() => errs.push('imported vehicle not shown'));
    });
    await step('ai-key', async () => {
      // Owners see the AI provider section with a masked key field.
      await p.goto(B + '#/settings'); await p.waitForSelector('#aik-key');
      if ((await p.getAttribute('#aik-key', 'type')) !== 'password') errs.push('AI key field is not masked');
      // (Saving is covered by the server tests with a stand-in provider; this run has no real provider to check against.)
      if (!(await p.locator('text=This shop uses Wrynch').count()) && !(await p.locator('text=No AI is set up').count())) errs.push('AI provider status missing');
      await shot('L04c-ai-key');
    });
    await step('template-optimize', async () => {
      // "Optimize order" reorders points for one pass around the car; Undo puts the shop's order back. Nothing is saved.
      await p.goto(B + '#/settings/template'); await p.waitForSelector('button:has-text("Optimize order")');
      const order = () => p.$$eval('input[id^="pt-"]', (els) => els.map((e) => e.value));
      const before = await order();
      await p.click('button:has-text("Optimize order")');
      await p.waitForSelector('text=for one pass around the car').catch(() => errs.push('optimize summary missing'));
      const after = await order();
      if (!(after.indexOf('RR tire') < after.indexOf('Visual brake system condition'))) errs.push('wheels are not grouped in a lap after optimizing');
      if (after.length !== before.length || [...after].sort().join() !== [...before].sort().join()) errs.push('optimizing added or dropped points');
      await shot('L04d-template-optimized');
      await p.click('button:has-text("Undo")');
      if ((await order()).join('|') !== before.join('|')) errs.push('undo did not restore the order');
    });
    await step('component-checks', async () => {
      // The owner turns a tire check off in the default template and saves (a new template version in the database),
      // then back on. A part's last check can't go off.
      const q = (sql) => require('child_process').spawnSync('psql', ['-Atc', sql, PGURL], { encoding: 'utf8' }).stdout.trim();
      const offInTemplate = () => q("select count(*) from template where is_active and data -> 'checksOff' ? 'tire.age'");
      await p.goto(B + '#/settings/components'); await p.waitForSelector('#cc-q');
      await p.fill('#cc-q', 'tire age');
      const sw = p.getByRole('switch', { name: 'Tire age (DOT date code)' }).first();
      await sw.waitFor();
      if (!(await sw.isChecked())) errs.push('tire age should start on');
      await sw.uncheck();
      await p.click('button:has-text("Save checks")');
      await p.waitForTimeout(1200);
      if (offInTemplate() !== '1') errs.push('turning a check off was not saved to the template');
      await shot('L04e-component-checks');
      await p.fill('#cc-q', 'tire age');
      const sw2 = p.getByRole('switch', { name: 'Tire age (DOT date code)' }).first();
      await sw2.check();
      await p.click('button:has-text("Save checks")');
      await p.waitForTimeout(1200);
      if (offInTemplate() !== '0') errs.push('turning a check back on was not saved to the template');
      await p.fill('#cc-q', 'vin label'); await p.uncheck('text=Only parts with more than one check');
      if (!(await p.getByRole('switch').first().isDisabled())) errs.push('a part\'s only check can be turned off');
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
      // Inspection mode: full screen (no app menu), straight into the first point, wizard Back / Jump / Next.
      await p.waitForSelector('text=/Point 1 of \\d+/');
      if (await p.locator('.side').count()) errs.push('the app menu is still shown during the inspection');
      if (await p.locator('button.mic').count()) errs.push('note box (and its mic) shown before tapping add note');
      await p.click('button.note-add');
      if (!(await p.locator('button.mic').count())) errs.push('no voice note button in the note box');
      await p.click('.tech-note button:has-text("Done")');
      const big = await p.locator('.footer.wizard .wiz-next').boundingBox();
      if (!big || big.height < 64) errs.push('Next button is not glove-sized: ' + JSON.stringify(big));
      await shot('L06a-wizard-point');
      await p.click('.footer.wizard .wiz-next'); await p.waitForSelector('text=/Point 2 of \\d+/').catch(() => errs.push('Next did not move to point 2'));
      await p.click('.footer.wizard .wiz-back'); await p.waitForSelector('text=/Point 1 of \\d+/').catch(() => errs.push('Back did not return to point 1'));
      await p.click('.footer.wizard .wiz-jump'); await p.waitForSelector('.jump-list');
      await shot('L06b-jump');
      await p.locator('.jump-item', { hasText: 'Brake fluid' }).first().click();
      await p.waitForSelector('.topbar h1:has-text("Brake fluid")').catch(() => errs.push('jumping to a point did not open it'));
      await p.goto(p.url().replace(/\/point\/.*$/, ''));
      await p.waitForSelector('text=points done'); await shot('L06-overview');
      if (!(await p.locator('.resume a:has-text("Continue inspection"), .resume a:has-text("Start with the first point")').count())) errs.push('no Continue button on the overview');
      // One stage open at a time; tapping another stage's name opens it and closes the first.
      if ((await p.locator('.stage.open').count()) !== 1) errs.push('expected exactly one open stage');
      const heads = p.locator('.stage-head');
      const firstOpen = await p.locator('.stage.open .stage-head').textContent();
      for (let k = 0; k < await heads.count(); k++) {
        if ((await heads.nth(k).getAttribute('aria-expanded')) === 'false') { await heads.nth(k).click(); break; }
      }
      if ((await p.locator('.stage.open').count()) !== 1 || (await p.locator('.stage.open .stage-head').textContent()) === firstOpen) errs.push('tapping a stage did not switch the open stage');
      await p.locator('.stage.open .stage-head').click();
      if ((await p.locator('.stage.open').count()) !== 0) errs.push('tapping the open stage did not close it');
    });
    const inspId = p.url().split('/insp/')[1].split('/')[0];
    await step('corner-capture', async () => {
      // In-app camera: pick a corner, tap or hold the shutter for a burst, switch corners without leaving the camera.
      await p.goto(B + `#/insp/${inspId}/capture/under_car`); await p.waitForSelector('text=Where are you shooting?');
      await p.click('.corner-btn.c-right_front');
      await p.click('button:has-text("Open camera")');
      await p.waitForSelector('.cam-shutter:not([disabled])', { timeout: 15000 });
      const sh = await p.locator('.cam-shutter').boundingBox();
      await p.mouse.move(sh.x + sh.width / 2, sh.y + sh.height / 2);
      await p.mouse.down(); await p.waitForTimeout(800); await p.mouse.up(); // hold: a burst
      await p.locator('.cam-shutter').click();                               // tap: one more
      await p.click('.cam-corner[aria-label="Left front"]');
      await p.locator('.cam-shutter').click();
      await p.waitForTimeout(300); await shot('L06a-camera');
      const n = Number((await p.textContent('.cam-count')).match(/\d+/)[0]);
      if (n < 4) errs.push('burst did not take several photos: ' + n);
      await p.waitForFunction(() => !/saving/.test(document.querySelector('.cam-count')?.textContent ?? ''), null, { timeout: 60000 })
        .catch(() => errs.push('camera photos did not finish saving'));
      await p.click('.cam-done');
      const status = await p.textContent('.corner-pick [role=status]').catch(() => '');
      if (!/RF \d+/.test(status) || !/LF 1/.test(status)) errs.push('corner counts wrong: ' + status);
      await shot('L06b-corner-capture');
    });
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
    await step('point-photos', async () => {
      // The camera button on a point uploads photos for that point only.
      await p.goto(B + `#/insp/${inspId}/point/S26`); await p.waitForSelector('label[for="point-files"]');
      const before = await p.locator('.thumbs .thumb').count();
      await p.setInputFiles('#point-files', PHOTOS.slice(0, 1));
      await p.waitForFunction((n) => document.querySelectorAll('.thumbs .thumb').length > n, before, { timeout: 30000 })
        .catch(() => errs.push('photo added from a point did not show on that point'));
      await p.waitForTimeout(800); await shot('L09c-point-photo');
      const names = await p.locator('.thumbs .thumb .t').allTextContents();
      if (names.some((t) => /Exhaust|Brake/.test(t))) errs.push('point photo matched to a part outside the point: ' + names.join(', '));
      await p.goto(B + `#/insp/${inspId}/sort/under_car`); await p.waitForTimeout(600);
      const confirm = p.locator('button:has-text("AI part matches")');
      if (await confirm.count() && await confirm.isEnabled()) { await confirm.click(); await p.waitForTimeout(800); }
    });
    await step('training', async () => {
      // Owner shares training data; Wrynch staff (added in the database) label a confirmed photo and export.
      await p.goto(B + '#/settings'); await p.waitForSelector('text=Help improve Wrynch');
      await p.check('section[aria-labelledby="tr-h"] input[type=checkbox]'); await p.waitForTimeout(800);
      require('child_process').spawnSync('psql', ['-Atc', "insert into platform_admin select user_id from shop_member where role = 'owner' on conflict do nothing", PGURL]);
      await p.reload(); await p.waitForSelector('a[href="#/training"]', { timeout: 10000 }).catch(() => errs.push('staff do not see Training data'));
      await p.goto(B + '#/training');
      await p.waitForSelector('.tbox', { timeout: 20000 }).catch(() => errs.push('AI pre-draw boxes did not appear'));
      // Draw one more box by hand for the first part.
      const f = await p.locator('.train-frame').boundingBox();
      if (f) { await p.mouse.move(f.x + f.width * 0.6, f.y + f.height * 0.6); await p.mouse.down(); await p.mouse.move(f.x + f.width * 0.9, f.y + f.height * 0.9, { steps: 5 }); await p.mouse.up(); }
      await shot('L09d-training');
      const before = Number((await p.textContent('.train-kpis .card b')).trim());
      await p.click('button:has-text("Approve")');
      await p.waitForFunction((n) => Number(document.querySelector('.train-kpis .card b')?.textContent) > n, before, { timeout: 10000 }).catch(() => errs.push('approved count did not go up'));
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }).catch(() => null), p.click('button:has-text("Export dataset")')]);
      if (!dl) errs.push('dataset export did not download');
      else {
        const m = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
        if (m.format !== 'wrynch-yolo-1' || !m.images.length || !m.images[0].labels.length) errs.push('dataset export is empty or malformed');
      }
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
      // Something to report on a point with no note: the reservoir couldn't be inspected (the button sits under the ratings).
      await p.goto(B + `#/insp/${inspId}/c/` + encodeURIComponent('38@') + '/S14'); await p.click('button.skip-part');
      await p.locator('.sheet label.item').first().click(); await p.click('.sheet button:has-text("Save")'); await p.waitForTimeout(600);
      if (!(await p.locator('button.skip-part:has-text("Couldn’t inspect:")').count())) errs.push('skip reason not shown under the ratings');
      // Findings belong to a check and appear only once it is rated Monitor or Immediate.
      await p.goto(B + `#/insp/${inspId}/c/` + encodeURIComponent('72@left_front') + '/S24'); await p.waitForSelector('.check-card[data-check="brake_caliper.visual"]');
      const cal = p.locator('.check-card[data-check="brake_caliper.visual"]');
      if (await cal.locator('.check-findings').count()) errs.push('findings shown before Monitor/Immediate');
      await cal.locator('button.monitor').click(); await cal.locator('.check-findings').waitFor({ timeout: 10000 });
      await cal.locator('.check-findings button.pill:has-text("Leak")').first().click(); await p.waitForTimeout(900);
      await shot('L09b-check-findings');
      await p.goto(B + `#/insp/${inspId}/c/` + encodeURIComponent('72@left_front') + '/S24'); await p.waitForTimeout(800);
      if (!(await cal.locator('.check-findings button.pill[aria-pressed="true"]:has-text("Leak")').count())) errs.push('check finding not saved');
      for (const pid of ['S01','S02','S03','S04','S05','S06','S07','S08','S09','S10','S11','S12','S13','S14','S15','S16','S17','S18','S19','S20','S21','S22','S23','S24','S25','S26','S27','S28','S29','S30','S31','S32','S33','S34']) {
        await p.goto(B + `#/insp/${inspId}/point/${pid}`); await p.waitForTimeout(250);
        const btn = p.locator('button:has-text("Nothing found")');
        if (await btn.count()) { await btn.click(); await p.waitForTimeout(500); }
      }
      await p.goto(B + `#/insp/${inspId}/point/S24`); await p.waitForTimeout(500);
      const summary = await p.textContent('.point-findings').catch(() => '');
      if (!/leak/i.test(summary)) errs.push('point summary misses the check finding: ' + summary);
      // The note box opens only from the add-note icon.
      if (await p.locator('#note').count()) errs.push('note box shown before tapping add note');
      await p.click('button.note-add'); await p.waitForSelector('#note');
      await p.fill('#note', 'fronts 5mm/rotors major grooving. rears 6mm'); await p.click('.tech-note button:has-text("Done")'); await p.waitForTimeout(800);
      if (!(await p.locator('.tech-note >> text=fronts 5mm').count())) errs.push('note not shown after Done');
      // Rewording follows the shop's style; summaries of blank points are always customer-friendly.
      await p.goto(B + '#/settings'); await p.click('[aria-label="Automatic note style"] button:has-text("Technical")');
      await p.waitForFunction(() => document.querySelector('[aria-label="Automatic note style"] button[aria-pressed="true"]')?.textContent === 'Technical');
      await p.waitForTimeout(600);
      await p.goto(B + `#/insp/${inspId}/finish`); await p.waitForSelector('text=Report notes');
      if (await p.locator('.note-review').count()) errs.push('the technician is still asked to approve notes');
      await shot('L10-finish');
      await p.click('button:has-text("Send to advisor")'); await p.waitForSelector('text=Inspection results', { timeout: 10000 });
      await p.setViewportSize({ width: 1300, height: 900 }); await p.waitForTimeout(500);
      // The advisor gets a note for every point (AI summaries for the blank ones) and approves each before sending.
      await p.waitForSelector('.report-notes-review .note-row[data-point="S24"]', { timeout: 20000 });
      await p.waitForFunction(() => !/Writing summaries/.test(document.querySelector('.report-notes-review')?.textContent ?? ''), null, { timeout: 60000 });
      await p.waitForTimeout(1500);
      if (!(await p.locator('button:has-text("Send to customer")').isDisabled())) errs.push('send allowed with notes waiting for approval');
      const blankRows = await p.$$eval('.report-notes-review .note-row textarea', (els) => els.filter((e) => !e.value.trim()).length);
      if (blankRows) errs.push(`${blankRows} points have no proposed note`);
      const s24 = await p.inputValue('.note-row[data-point="S24"] textarea').catch(() => '');
      if (!s24.includes('5') || !s24.includes('6')) errs.push('reworded note lost a measurement: ' + s24);
      await shot('L11-advisor-notes');
      await p.fill('.note-row[data-point="S24"] textarea', s24 + ' Recheck at next service.');
      await p.click('.note-row[data-point="S24"] button:has-text("Approve edit")'); await p.waitForTimeout(800);
      const all = p.locator('.report-notes-review button:has-text("as written")');
      if (await all.count()) { await all.click(); await p.waitForTimeout(2500); } else errs.push('no Approve all button');
      for (let k = 0; k < 40 && await p.locator('.note-row:not(.approved) button:has-text("Approve")').count(); k++) {
        await p.locator('.note-row:not(.approved) button:has-text("Approve")').first().click(); await p.waitForTimeout(500);
      }
      await p.waitForFunction(() => /all approved/.test(document.querySelector('.report-notes-review h2')?.textContent ?? ''), null, { timeout: 15000 })
        .catch(() => errs.push('notes not all approved'));
      await shot('L11-advisor');
    });
    await step('profile', async () => {
      // The finished inspection counts on the person's profile, with timing from the database.
      await p.goto(B + '#/profile'); await p.waitForSelector('text=inspections completed', { timeout: 10000 });
      const n = Number((await p.locator('.profile-kpis .card b').first().textContent()).trim());
      if (!(n >= 1)) errs.push('profile does not count the finished inspection');
      const t = require('child_process').spawnSync('psql', ['-Atc', "select (started_at is not null and first_submitted_at is not null)::text from inspection where vehicle_id = (select id from vehicle where vin = 'JTEBU5JR4B5012345')", PGURL], { encoding: 'utf8' }).stdout.trim();
      if (t !== 'true') errs.push('inspection start/finish not recorded: ' + t);
      await shot('L11b-profile');
      await p.goto(B + `#/advisor/${inspId}`); await p.waitForSelector('text=Inspection results', { timeout: 10000 });
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
      if (!body.includes('Everything we inspected')) errs.push('the customer report does not list every point');
      const pts = await c.locator('.report-points .item').count();
      if (pts < 30) errs.push(`only ${pts} inspection points on the customer report`);
      if (body.includes('waiting for the service advisor')) errs.push('a point on the customer report has no approved note');
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
  const db = require('child_process').spawnSync('psql', ['-Atc', "select config->>'drivetrain', config->>'transferCase' from vehicle where vin = 'JTEBU5JR4B5012345'", PGURL], { encoding: 'utf8' }).stdout.trim();
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
