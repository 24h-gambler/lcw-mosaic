// Headless real-screen check of the player menu (docs/08 8.6 G03 G04 G06 G10 G11 G14) at 1440 / 1024 / 390 / 844x390,
// as a linked child whose server answers are fixtures (page.route): the server bag on the hotbar, the menu button by
// the hotbar, every tab without sideways overflow, a bag → chest move request, the repair review window.
// The menu words are in the screen language (English, the learn language); KO_HELP=1 turns Korean help on and checks the Korean lines under
// the tab labels and titles (expected words: tools/frame-lang-expect.mjs).
// Fails (exit 1) on a broken rule. Headless only, audio muted, no window.
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tools/frame-menu-shots.mjs http://127.0.0.1:8982/game/ shots/frame-menu
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { COPY, COPY_KO, FRAME_LANG, KO_HELP, KO_HELP_SHOWN, inScreenLang, langInitScript } from './frame-lang-expect.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:8982/game/';
const out = process.argv[3] ?? 'shots/frame-menu';
const only = process.argv[4] ?? '';
mkdirSync(out, { recursive: true });
const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});

const VIEWPORTS = [
  { name: 'd1440', width: 1440, height: 900, touch: false },
  { name: 't1024', width: 1024, height: 768, touch: true },
  { name: 'p390', width: 390, height: 844, touch: true },
  { name: 'l844', width: 844, height: 390, touch: true }
].filter((v) => !only || v.name === only);

function fixtures() {
  const thing = (item_id, item_key, item_name_ko, emoji, location, socket, card) => ({ item_id, item_key, item_name_ko, emoji, location, socket, durability: 100, card });
  const items = [
    thing('it-1', 'honey_tea', '꿀차', '🍯', 'bag', null, { box: 1, due: false, mastered: false }),
    thing('it-2', 'cookie', '쿠키', '🍪', 'bag', null, null),
    thing('it-3', 'hat', '모자', '🎩', 'socket', 'Head_Socket', null),
    thing('it-4', 'kite', '연', '🪁', 'chest', null, { box: 2, due: true, mastered: false }),
    thing('it-5', 'ball', '공', '⚽', 'chest', null, { box: 3, due: false, mastered: false }),
    thing('it-6', 'book', '책', '📘', 'chest', null, { box: 6, due: false, mastered: true })
  ];
  const e = (key, name_ko, emoji, found) => ({ key, name_ko, emoji, found });
  return {
    items,
    collection: {
      books: [
        { id: 'food', total: 6, found: 2, entries: [e('honey_tea', '꿀차', '🍯', true), e('milk', '우유', '🥛', true), e('water', '물', '💧', false), e('tea', '차', '🍵', false), e('juice', '주스', '🧃', false), e('smoothie', '스무디', '🥤', false)] },
        { id: 'expressions', total: 2, found: 1, entries: [e('e1', 'Can I have a honey tea?', '💬', true), e('e2', '-', '💬', false)] },
        { id: 'blocks', total: 3, found: 0, entries: [e('b1', '돌', '🪨', false), e('b2', '나무', '🪵', false), e('b3', '벽돌', '🧱', false)] }
      ],
      achievements: [
        // the server's ids and Korean names (apps/edge/src/collection.ts); the screen shows English by id
        { id: 'first_order', name_ko: '첫 주문', done: true, progress: 1, goal: 1 },
        { id: 'blocks_100', name_ko: '블록 100개 설치', done: false, progress: 30, goal: 100 }
      ]
    },
    repair: {
      items: [
        { item_id: 'it-4', item_key: 'kite', item_name_ko: '연', emoji: '🪁', due: true },
        { item_id: 'it-5', item_key: 'ball', item_name_ko: '공', emoji: '⚽', due: false }
      ]
    },
    sign: { card_id: 'mc-4', item_key: 'kite', item_name_ko: '연', emoji: '🪁', ctx: 'trade_shop', text: 'Can I have a kite, please?', hint_tags: ['kite'], hint: 'keyword', listen: false, box: 2, stars: 2, due_at: 0, overdue_days: 1, label_ko: '연에 번개 표시가 떴어요' }
  };
}

const fails = [];
const report = [];
const check = (vp, ok, what) => {
  if (!ok) fails.push(`${vp}: ${what}`);
};
const overlap = (a, b) => a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const rect = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0 || b.width === 0) return null;
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, sel);
const noSideways = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('.lcw-menu__body');
    return !!b && b.scrollWidth <= b.clientWidth + 1;
  });

for (const vp of VIEWPORTS) {
  const fx = fixtures();
  const posts = [];
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, hasTouch: vp.touch, isMobile: vp.touch && vp.width < 500 });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('lcw.deviceToken', 'd'.repeat(40));
      localStorage.setItem('lcw.deviceNickname', '지우');
    } catch {
      /* storage blocked */
    }
  });
  await langInitScript(ctx);
  await ctx.route('**/v1/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() !== 'GET') posts.push({ p, body: req.postData() ?? '' });
    if (p === '/v1/device/me') return json({ nickname: '지우', level: 'L1', voice_store: false, play_allowed: true, seat: { state: 'active', ends_at: null } });
    if (p === '/v1/items') return json({ bag_slots: 5, coins_total: 340, items: fx.items });
    if (p === '/v1/items/equip') {
      const b = JSON.parse(req.postData() || '{}');
      const it = fx.items.find((x) => x.item_id === b.item_id);
      if (it) it.location = b.to;
      return json({ ok: true, item_id: b.item_id, location: b.to });
    }
    if (p === '/v1/items/use') return json({ ok: true, uses: 1 });
    if (p === '/v1/collection') return json(fx.collection);
    if (p === '/v1/review/repair') return json(fx.repair);
    if (p === '/v1/review/repair/pick') return json({ ok: true, sign: fx.sign });
    if (p === '/v1/review/due') return json({ signs: [], next_due_at: null });
    if (p === '/v1/settings') return json(req.method() === 'GET' ? { settings: {}, updated_at: null } : { ok: true, updated_at: Date.now() });
    if (p === '/v1/health') return json({ ok: true });
    return json({ error: 'not_in_fixture' }, 404);
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (er) => errs.push(`pageerror: ${er.message.slice(0, 200)}`));
  await page.goto(base, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => !!window.__lcwWorld && document.querySelector('.lw-load.done'), null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  // the title screen (world lane) and the first-visit / mic cards (dialog domain): step past them like a child would
  const start = page.getByRole('button', { name: /^(시작하기|Start)/ });
  // the title can come up a moment after the load bar on a busy machine: wait for it rather than count once
  if (await start.first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) {
    await start.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
  for (const label of ['건너뛰기', '좋아요, 출발!', 'Skip', "OK, let's go!"]) {
    const b = page.getByRole('button', { name: label });
    if (await b.count()) await b.first().click({ timeout: 2000 }).catch(() => {});
  }
  await page.waitForTimeout(800);

  // 1. the server bag on the hotbar, coins from the ledger, the menu button by the hotbar
  const hud = await page.evaluate(() => ({
    empties: document.querySelectorAll('.lw-slot.empty').length,
    coins: document.querySelector('.lw-stars .cn')?.textContent ?? ''
  }));
  check(vp.name, hud.empties === 3, `hotbar should show the 2 bag things from the server (empty slots ${hud.empties})`);
  check(vp.name, hud.coins === '340', `coins should be the ledger's 340 (${hud.coins})`);
  const btn = await rect(page, '.lcw-hudbtn--bag');
  const bar = await rect(page, '.lw-hotbar');
  const help = await rect(page, '.lw-help');
  check(vp.name, !!btn, 'menu button missing');
  check(vp.name, !!btn && btn.x >= 0 && !overlap(btn, bar) && !overlap(btn, help), 'menu button off-screen or covering the hotbar/help');
  await page.screenshot({ path: `${out}/${vp.name}-0hud.png` });

  // 2. bag tab
  await page.click('.lcw-hudbtn--bag');
  await page.waitForSelector('.lcw-menu__win', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.lcw-chest .lcw-thing').length > 0, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  const bag = await page.evaluate(() => ({
    sel: document.querySelector('.lcw-menu__tab[aria-selected="true"]')?.id,
    bag: document.querySelectorAll('.lcw-bagrow .lcw-thing:not(.empty)').length,
    sockets: document.querySelectorAll('.lcw-sockets .lcw-thing:not(.empty)').length,
    chest: document.querySelectorAll('.lcw-chest .lcw-thing').length
  }));
  await page.screenshot({ path: `${out}/${vp.name}-1bag.png` });
  check(vp.name, bag.sel === 'lcw-menu-tab-bag', `menu should open on the bag (${bag.sel})`);
  check(vp.name, bag.bag === 2 && bag.sockets === 1 && bag.chest === 3, `bag 2 / socket 1 / chest 3 expected (${bag.bag}/${bag.sockets}/${bag.chest})`);
  check(vp.name, await noSideways(page), 'bag tab scrolls sideways');
  // menu words in the learn language; with Korean help a Korean line under each tab label and title
  const words = await page.evaluate(() => {
    const plain = (el) => {
      const c = el.cloneNode(true);
      c.querySelectorAll('.ko, kbd, .ic').forEach((x) => x.remove());
      return (c.textContent ?? '').trim();
    };
    return {
      lang: document.documentElement.lang,
      tabs: [...document.querySelectorAll('.lcw-menu__tab')].map(plain),
      titles: [...document.querySelectorAll('.lcw-menu__body h2, .lcw-menu__body h3')].map(plain),
      koTabs: [...document.querySelectorAll('.lcw-menu__tab .ko')].map((x) => x.textContent),
      koAll: document.querySelectorAll('.lcw-menu .ko').length
    };
  });
  report.push({ vp: vp.name, words });
  check(vp.name, words.lang === FRAME_LANG, `<html lang> should be the screen language (${words.lang})`);
  check(vp.name, words.tabs.length === 6 && words.tabs.every((t) => t && inScreenLang(t)), `tab labels not in the screen language (${words.tabs.join(',')})`);
  check(vp.name, words.titles.length >= 3 && words.titles.every((t) => inScreenLang(t)), `bag titles not in the screen language (${words.titles.join(',')})`);
  if (KO_HELP_SHOWN) check(vp.name, words.koTabs.length === 6 && words.koTabs[0] === COPY_KO.bagTab && words.koAll >= 10, `Korean help lines missing (${words.koTabs.join(',')} / ${words.koAll})`);
  else check(vp.name, words.koAll === 0, `Korean lines shown while Korean help is off (${words.koAll})`);
  // move the first bag thing to the chest: a server request, then the HUD follows
  await page.locator('.lcw-bagrow .lcw-thing:not(.empty) .btn').first().click();
  await page.waitForTimeout(1500);
  check(vp.name, posts.some((x) => x.p === '/v1/items/equip' && /"to":"chest"/.test(x.body)), 'bag → chest did not ask the server');
  const empties2 = await page.evaluate(() => document.querySelectorAll('.lw-slot.empty').length);
  check(vp.name, empties2 === 4, `hotbar should follow the server bag after the move (empty slots ${empties2})`);

  for (const tab of ['mirror', 'map', 'book', 'repair', 'settings']) {
    await page.click(`#lcw-menu-tab-${tab}`);
    await page.waitForTimeout(tab === 'mirror' ? 2500 : 1000);
    await page.screenshot({ path: `${out}/${vp.name}-2${tab}.png` });
    check(vp.name, await noSideways(page), `${tab} tab scrolls sideways`);
    if (tab === 'mirror') {
      const m = await page.evaluate(() => ({ canvas: !!document.querySelector('.lcw-mirror__view canvas'), worn: document.querySelectorAll('.lcw-mirror__list li:not(.empty)').length }));
      check(vp.name, m.canvas && m.worn === 1, `mirror: 3D view ${m.canvas}, worn ${m.worn} (expected 1)`);
    }
    if (tab === 'book') {
      const b = await page.evaluate(() => ({ books: document.querySelectorAll('.lcw-books button').length, found: document.querySelectorAll('.lcw-entries li:not(.no)').length, ach: Array.from(document.querySelectorAll('.lcw-ach li')).map((li) => li.textContent ?? '') }));
      check(vp.name, b.books === 6 && b.found >= 1 && b.ach.length === 2, `book: 6 books / found / 2 achievements (${b.books}/${b.found}/${b.ach.length})`);
      const found = await page.evaluate(() => Array.from(document.querySelectorAll('.lcw-entries li:not(.no)')).map((li) => li.textContent ?? ''));
      check(vp.name, found.length >= 1 && found.every((t) => /[가-힣]/.test(t) === KO_HELP_SHOWN), `found entries in English by key (${found.join(' | ')})`);
      check(vp.name, b.ach[0]?.includes('First order') && b.ach[1]?.includes('Place 100 blocks'), `achievements in English by id (${b.ach.join(' | ')})`);
      check(vp.name, b.ach.every((t) => /[가-힣]/.test(t) === KO_HELP_SHOWN), `achievement Korean help ${KO_HELP_SHOWN ? 'missing' : 'shown while off'} (${b.ach.join(' | ')})`);
    }
    if (tab === 'repair') {
      const n = await page.evaluate(() => document.querySelectorAll('.lcw-repair li').length);
      check(vp.name, n === 2, `repair: 2 stored things expected (${n})`);
      await page.locator('.lcw-repair li:not(.later) .btn').first().click();
      await page.waitForSelector('.lcw-dlg', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${out}/${vp.name}-3repair-dialog.png` });
      check(vp.name, posts.some((x) => x.p === '/v1/review/repair/pick'), 'repair pick did not ask the server');
      check(vp.name, !!(await rect(page, '.lcw-dlg__win')), 'repair review window did not open');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      if (await page.locator('.lcw-dlg').count()) {
        const x = page.locator('.lcw-dlg button', { hasText: '✕' });
        if (await x.count()) await x.first().click().catch(() => {});
        await page.waitForTimeout(600);
      }
      check(vp.name, !(await page.locator('.lcw-dlg').count()), 'repair review window did not close');
      check(vp.name, !!(await rect(page, '.lcw-menu__win')), 'menu should still be open after the repair window closes');
    }
    if (tab === 'settings') {
      // G14: five sections, each with real controls; a change is kept on the device and sent to the server
      const secs = await page.evaluate(() => [...document.querySelectorAll('.lcw-set__nav [data-sec]')].map((b) => b.getAttribute('data-sec')));
      check(vp.name, ['controls', 'sound', 'screen', 'access', 'mic'].every((x) => secs.includes(x)), `settings sections ${secs.join(',')}`);
      const ctl = await page.evaluate(() => ({ ranges: document.querySelectorAll('.lcw-set input[type="range"]').length, switches: document.querySelectorAll('.lcw-set [role="switch"]').length }));
      check(vp.name, ctl.ranges >= 2 && ctl.switches >= 1, `controls: look sliders and invert switch (${ctl.ranges}/${ctl.switches})`);
      const r0 = page.locator('.lcw-set input[type="range"]').first();
      await r0.focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(1600);
      const stored = await page.evaluate(() => {
        try {
          return JSON.parse(localStorage.getItem('lcw.settings') || '{}').lookMouse ?? null;
        } catch {
          return null;
        }
      });
      check(vp.name, typeof stored === 'number' && stored > 1, `mouse look speed kept on the device (${stored})`);
      // the server save is debounced: give a busy machine up to 6 s before calling it missing
      const sent = () => posts.some((x) => x.p === '/v1/settings' && /lookMouse|look_mouse/.test(x.body));
      for (let i = 0; i < 30 && !sent(); i++) await page.waitForTimeout(200);
      check(vp.name, sent(), 'settings change did not reach the server');
      for (const sec of ['sound', 'screen', 'access', 'mic']) {
        await page.click(`#lcw-set-tab-${sec}`);
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${out}/${vp.name}-4settings-${sec}.png` });
        check(vp.name, await noSideways(page), `settings ${sec} scrolls sideways`);
      }
      await page.click('#lcw-set-tab-sound');
      await page.waitForTimeout(400);
      const sound = await page.evaluate(() => ({ text: document.querySelector('.lcw-set__main')?.textContent ?? '', ranges: document.querySelectorAll('.lcw-set input[type="range"]').length, switches: document.querySelectorAll('.lcw-set [role="switch"]').length }));
      check(vp.name, COPY.naturalVoice.test(sound.text) && sound.ranges >= 4 && sound.switches >= 1, `sound: volumes, voice speed, natural voice (${sound.ranges} sliders)`);
      await page.click('#lcw-set-tab-screen');
      await page.waitForTimeout(400);
      const scr = await page.evaluate(() => document.querySelector('.lcw-set__main')?.textContent ?? '');
      check(vp.name, COPY.screenWords.every((w) => scr.includes(w)), `screen: ${COPY.screenWords.join(' / ')}`);
      // the Korean help switch: first in the access section, named in Korean too, matching the setting
      await page.click('#lcw-set-tab-access');
      await page.waitForTimeout(400);
      const kh = await page.evaluate(() => {
        const row = document.querySelector('.lcw-set__main .lcw-set__row');
        return { text: row?.textContent ?? '', on: row?.querySelector('[role="switch"]')?.getAttribute('aria-checked') ?? null };
      });
      check(vp.name, kh.text.includes(COPY.helpKoTitle) && kh.text.includes(COPY_KO.helpKoTitle) && kh.on === String(KO_HELP), `Korean help switch (${kh.text.slice(0, 60)} / ${kh.on})`);
      await page.screenshot({ path: `${out}/${vp.name}-4settings-access-top.png` });
    }
  }
  // Esc closes the menu
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check(vp.name, !(await page.locator('.lcw-menu').count()), 'Esc should close the menu');
  if (!vp.touch) {
    // another window up (a review dialog has no HUD mark): K must not open the menu over it
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'fake-modal';
      d.setAttribute('role', 'dialog');
      d.setAttribute('aria-modal', 'true');
      document.body.appendChild(d);
    });
    await page.keyboard.press('KeyK');
    await page.waitForTimeout(400);
    check(vp.name, !(await page.locator('.lcw-menu').count()), 'K opened the menu over another window');
    await page.evaluate(() => document.getElementById('fake-modal')?.remove());
  }
  if (!vp.touch) {
    await page.keyboard.press('KeyK');
    await page.waitForTimeout(500);
    const sel = await page.evaluate(() => document.querySelector('.lcw-menu__tab[aria-selected="true"]')?.id);
    check(vp.name, sel === 'lcw-menu-tab-book', `K should open the book (${sel})`);
    await page.keyboard.press('Escape');
  }
  check(vp.name, errs.length === 0, `page errors: ${errs.join(' | ')}`);
  report.push({ vp: vp.name, hud, bag, posts: posts.map((x) => x.p), errs });
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify({ fails, report }, null, 1));
console.log(fails.length ? `FAIL\n${fails.join('\n')}` : `PASS ${VIEWPORTS.length} viewports`);
process.exit(fails.length ? 1 : 0);
