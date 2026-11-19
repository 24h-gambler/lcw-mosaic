// Headless real-screen run of /adventure/ (docs/22 5장): all four chapters per viewport (1440 keys, 390 touch,
// 844x390 touch and keys), every TALK mode, fps from the page's own loop (≥ 30), 0 page errors, the guardian summary,
// and with a document link the day file read and the contract v1 envelope sent. english-day.pages.dev and /v1/* are
// answered inside the browser: no real student, no real document, nothing leaves the machine. Headless, audio muted.
//
//   PLAYWRIGHT_CORE=<path to playwright-core/index.mjs> node tools/adventure-play.mjs http://127.0.0.1:8994/adventure/ shots/adventure [viewport]
//
// Live smoke (after the document site is deployed): ADV_LIVE_SECRET=<english-day.secret file> runs any viewport
// (every viewport carries the document link in this mode, 390 touch included) against the real https://engday.pages.dev as the smoke student `smoke-adv` (reports and teacher screens skip smoke-
// students). The write key is the adventure key the document puts in its link, HMAC-SHA256(secret, "a:smoke-adv")[:24] (lcw-adventure writes only), made here and never printed. The day file is
// read from the document's own student page named by ADV_LIVE_DAY_FROM (read only; smoke-adv has no page), and only
// the result POST goes out, as smoke-adv. Real Oreo data is never written.
import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LIVE = process.env.ADV_LIVE_SECRET
  ? {
      key: createHmac('sha256', readFileSync(process.env.ADV_LIVE_SECRET, 'utf8').trim()).update('a:smoke-adv').digest('hex').slice(0, 24),
      origin: 'https://engday.pages.dev',
      dayFrom: (process.env.ADV_LIVE_DAY_FROM ?? '').replace(/[^a-z0-9_-]/g, '')
    }
  : null;
// Everything this tool prints or writes goes through hide(): a console or crash message can quote the result URL
// (?k=) or the page URL (&edk=), and the write key must never reach a log, a report or the terminal.
const hide = (s) => {
  const t = String(s).replace(/([?&](?:k|edk)=)[^&\s'"]+/g, '$1***');
  return LIVE ? t.split(LIVE.key).join('***') : t;
};

const base = process.argv[2] ?? 'http://127.0.0.1:8994/adventure/';
const out = process.argv[3] ?? 'shots/adventure';
const only = process.argv[4] ?? null;
const pw = process.env.PLAYWRIGHT_CORE ? await import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href) : await import('playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
// Voice only (ADV_VOICE_DIR): Chrome's fake microphone plays <dir>/turn.wav, a synthetic sentence made per turn
// (tools/say-wav.ps1, Windows speech), and every answer goes through the real recorder and /v1/converse/stt. One
// silent turn first shows the say-again note. ADV_JOIN_CODE: a class code typed into the code box when the page has no
// token (a smoke lesson's code; the student token stays in the browser tab).
const VOICE = process.env.ADV_VOICE_DIR ?? null;
const JOIN = process.env.ADV_JOIN_CODE ?? null;
const TURN_WAV = VOICE ? path.resolve(VOICE, 'turn.wav') : null;
const SAY_PS1 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'say-wav.ps1');
function wavFor(text) {
  const f = path.resolve(VOICE, `say-${createHash('sha1').update(text).digest('hex').slice(0, 12)}.wav`);
  if (!existsSync(f)) {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SAY_PS1, '-Out', f], { env: { ...process.env, ADV_SAY_TEXT: text }, stdio: 'ignore' });
  }
  return f;
}
if (VOICE) {
  mkdirSync(VOICE, { recursive: true });
  copyFileSync(wavFor(' '), TURN_WAV);
}
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    ...(VOICE ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${TURN_WAV}`] : [])
  ]
});

const VIEWPORTS = [
  { name: 'd1440-keys', width: 1440, height: 900, touch: false, ed: true },
  { name: 'p390-touch', width: 390, height: 844, touch: true, ed: false },
  { name: 'l844-touch', width: 844, height: 390, touch: true, ed: false },
  { name: 'l844-keys', width: 844, height: 390, touch: false, ed: false }
];

const DAY = {
  v: 1,
  student: 'smoke-adv',
  date: '2026-11-16',
  day: 1,
  level: 1,
  topic: 'animals',
  words: ['rabbit', 'owl', 'fox'],
  wordInfo: [
    { w: 'rabbit', ko: '토끼' },
    { w: 'owl', ko: '부엉이' },
    { w: 'fox', ko: '여우' }
  ],
  sentence: 'I like the rabbit.',
  review_words: [],
  typing: ['The owl can fly.']
};

if (LIVE && !LIVE.dayFrom) {
  console.error('ADV_LIVE_DAY_FROM: name the student page whose day file is read (read only)');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];
const fails = [];

async function run(vp) {
  const dir = `${out}/${vp.name}`;
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.touch,
    isMobile: vp.touch,
    deviceScaleFactor: vp.touch ? 2 : 1
  });
  const page = await ctx.newPage();
  const errors = [];
  const beacons = [];
  const dayFetches = [];
  page.on('pageerror', (e) => errors.push(hide(`pageerror: ${e.message}`)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|tts|net::ERR/.test(m.text())) errors.push(hide(`console: ${m.text()}`));
  });
  const results = [];
  if (LIVE) {
    // the real site: the smoke student's day file is read from the named student page (GET only), the POST goes out
    await page.route(`${LIVE.origin}/smoke-adv/**`, async (route) => {
      const req = route.request();
      if (req.method() !== 'GET') return route.continue();
      dayFetches.push(req.url());
      const res = await route.fetch({ url: req.url().replace('/smoke-adv/', `/${LIVE.dayFrom}/`) });
      return route.fulfill({ response: res });
    });
    page.on('response', (r) => {
      if (r.url().startsWith(`${LIVE.origin}/api/result`) && r.request().method() === 'POST') {
        results.push({ status: r.status(), acao: r.headers()['access-control-allow-origin'] ?? null });
        beacons.push({ url: `${LIVE.origin}/api/result`, body: r.request().postData() });
      }
    });
  }
  // otherwise never touch the real english-day site: the day file and the result endpoint are answered here
  if (!LIVE) await page.route('https://english-day.pages.dev/**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      beacons.push({ url: req.url(), body: req.postData() });
      return route.fulfill({ status: 200, body: '{"ok":true}', headers: { 'access-control-allow-origin': '*' } });
    }
    dayFetches.push(req.url());
    if (/days\/2026-11-16\.json/.test(req.url())) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DAY), headers: { 'access-control-allow-origin': '*' } });
    return route.fulfill({ status: 404, body: 'no' });
  });
  // the neural voice is not part of this check (no token): answer fast so the device voice fallback is exercised.
  // Voice only: the class code and the speech recognition go to the real server.
  // ADV_API_BASE (a local build): those two calls are forwarded to that server, e.g. production with a smoke lesson.
  await page.route('**/v1/**', async (route) => {
    const u = new URL(route.request().url());
    if (!(VOICE && /[/]v1[/](converse[/]stt|join)$/.test(u.pathname))) return route.fulfill({ status: 404, body: '' });
    if (!process.env.ADV_API_BASE) return route.continue();
    const res = await route.fetch({ url: `${process.env.ADV_API_BASE}${u.pathname}` });
    return route.fulfill({ response: res });
  });
  const voice = { turns: 0, stt: [], join: [], silentNote: null, notes: [] };
  if (VOICE) {
    await ctx.grantPermissions(['microphone']);
    await page.addInitScript(() => {
      // proof that the page never leans on the browser's own recognition
      delete window.SpeechRecognition;
      delete window.webkitSpeechRecognition;
    });
    page.on('response', async (r) => {
      const u = new URL(r.url());
      if (u.pathname === '/v1/converse/stt') {
        const j = await r.json().catch(() => null);
        voice.stt.push({ status: r.status(), transcript: j?.transcript ?? null, confidence: j?.confidence ?? null, sec: j?.stt_sec ?? null, error: j?.error ?? null });
      }
      // the join answer holds the student token: only its status is kept
      if (u.pathname === '/v1/join') voice.join.push({ status: r.status() });
    });
  }

  const q = new URLSearchParams({ unlock: 'all', autopilot: '1' });
  if (vp.ed || LIVE) {
    q.set('ed', 'smoke-adv');
    q.set('edd', '2026-11-16');
    q.set('edk', LIVE ? LIVE.key : 'smoke-key');
    q.set('edr', LIVE ? `${LIVE.origin}/smoke-adv/` : 'https://english-day.pages.dev/smoke-adv/');
    if (LIVE) q.delete('edd'); // the document's newest day (today.json of the page read)
  }
  await page.addInitScript(() => {
    window.__advFps = [];
    setInterval(() => {
      const e = window.__adv;
      if (e) window.__advFps.push({ t: performance.now(), f: e.frames, dodge: e.battle?.phase === 'dodge' });
    }, 1000);
  });
  await page.goto(`${base}?${q}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid=adv-root]');
  // start waits for the day file and the server progress (docs/22 1.2)
  await page.waitForFunction(() => window.__adv?.getSnapshot().booted, null, { timeout: 15000 });
  const lastDayNote = await page.evaluate(() => ({ note: window.__adv.getSnapshot().dayNote, words: window.__adv.day?.words ?? null }));
  await sleep(800);
  await page.screenshot({ path: `${dir}/00-title.png` });

  const snap = () => page.evaluate(() => {
    const e = window.__adv;
    const s = e.getSnapshot();
    return {
      scene: s.scene,
      selected: s.selected,
      chapter: s.chapter,
      exploreMsg: s.exploreMsg ? { stone: s.exploreMsg.stone ?? null, i: s.exploreMsg.i } : null,
      battle: s.battle ? { phase: s.battle.phase, ready: s.battle.ready, current: s.battle.current, choices: s.battle.choices.map((c) => ({ id: c.id, mode: c.mode })), items: s.battle.items } : null,
      end: s.end ? { stars: s.end.activity.stars, outcome: s.end.activity.extra.outcome, sent: s.end.sent, lines: s.end.activity.lines.length, words: s.end.activity.words.length } : null,
      player: { x: e.player.x, y: e.player.y },
      camX: e.camX,
      ents: e.entities.map((x) => ({ id: x.e.id, kind: x.e.kind, x: x.x, y: x.y, state: x.state, talked: x.talked })),
      frames: e.frames,
      hp: e.battle?.hp ?? null
    };
  });
  const tid = (t) => page.locator(`[data-testid="${t}"]`);
  const press = async (sel) => {
    const l = typeof sel === 'string' ? tid(sel) : sel;
    // force: the FRIEND button pulses when ready (a moving target is fine for a finger, not for the stability wait)
    // a button can go away while we reach for it (the poke ring runs out, a message moves on): the loop reads the
    // state again instead of failing the run
    try {
      if (vp.touch) await l.first().tap({ force: true, timeout: 4000 });
      else await l.first().click({ timeout: 4000 });
      return true;
    } catch {
      return false;
    }
  };
  const exists = async (t) => (await tid(t).count()) > 0 && (await tid(t).first().isVisible());
  const canvasPoint = async (lx, ly) => {
    const b = await tid('adv-canvas').boundingBox();
    return { x: b.x + (lx / 320) * b.width, y: b.y + (ly / 240) * b.height };
  };
  const typeAnswer = async (inputTid, text) => {
    if (VOICE) return sayAnswer(text);
    if (!(await exists(inputTid)) && (await exists('adv-type-open'))) await press('adv-type-open');
    await tid(inputTid).first().fill(text);
    await tid(inputTid).first().press('Enter');
  };
  // One spoken turn: the class code first when the page asks for it, then the sentence into the fake microphone.
  const micTurn = async (wav) => {
    copyFileSync(wav, TURN_WAV);
    const n = voice.stt.length;
    if (!(await press('adv-mic'))) return false;
    voice.turns++;
    await sleep(1500);
    await shot('voice-listening');
    // the turn ends by itself after the voice stops (or nobody spoke); then the upload and the model
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      const busy = await page.evaluate(() => {
        const b = document.querySelector('[data-testid=adv-mic]');
        return !!b && (b.getAttribute('aria-pressed') === 'true' || b.disabled);
      });
      if (!busy) break;
      await sleep(250);
    }
    await sleep(300);
    return voice.stt.length > n;
  };
  const sayAnswer = async (text) => {
    if (await exists('adv-join')) {
      await shot('voice-join-need');
      if (!JOIN) {
        fails.push(`${vp.name}: the page asks for a class code and ADV_JOIN_CODE is not set`);
        return;
      }
      await tid('adv-join-code').first().fill(JOIN);
      await press('adv-join-ok');
      await page.waitForFunction(() => !document.querySelector('[data-testid=adv-join]'), null, { timeout: 15000 }).catch(() => {});
      await sleep(300);
      if (await exists('adv-join')) {
        // the code did not work: clear it so no screenshot keeps it
        await tid('adv-join-code').first().fill('');
        fails.push(`${vp.name}: the class code was refused (${JSON.stringify(voice.join)})`);
        return;
      }
      await shot('voice-join-ok');
    }
    if (!(await exists('adv-mic'))) {
      fails.push(`${vp.name}: no microphone button for "${text}"`);
      return;
    }
    if (voice.silentNote === null) {
      // a turn with nobody speaking: the panel must say "say it again", and nothing is typed for the child
      await micTurn(wavFor(' '));
      voice.silentNote = await tid('adv-mic-note').first().innerText().catch(() => '');
      await shot('voice-say-again');
    }
    await micTurn(wavFor(text));
    const note = await tid('adv-mic-note').first().innerText().catch(() => null);
    if (note) voice.notes.push(note.split(String.fromCharCode(10))[0]);
  };

  const allModes = new Set();
  const shotsTaken = new Set();
  const shot = async (name) => {
    if (shotsTaken.has(name)) return;
    shotsTaken.add(name);
    await page.screenshot({ path: `${dir}/${name}.png` });
  };

  for (const ch of [1, 2, 3, 4].slice(0, Number(process.env.MAXCH || 4))) {
    const t0 = Date.now();
    let talks = 0;
    const modesUsed = new Set();
    let poked = false;
    let pouched = false;
    let stoneVisited = false;
    let lastScene = '';
    let stuck = 0;
    let lastX = -1;
    while (true) {
      // a spoken turn waits for the recording, the upload and the model: voice only gets more time
      if (Date.now() - t0 > (VOICE ? 15 : 4) * 60_000) {
        fails.push(`${vp.name} ch${ch}: timeout`);
        await page.screenshot({ path: `${dir}/ch${ch}-timeout.png` });
        break;
      }
      const s = await snap();
      if (s.scene !== lastScene) lastScene = s.scene;
      if (s.scene === 'title') {
        if (s.selected !== ch) {
          if (vp.touch) await press(`adv-isle-${ch}`);
          else await page.keyboard.press('ArrowRight');
          continue;
        }
        if (ch === 1) await shot('01-title-selected');
        if (vp.touch) await press('adv-start');
        else {
          await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
          await page.keyboard.press('Enter');
        }
        await sleep(300);
        continue;
      }
      if (s.scene === 'explore') {
        if (s.exploreMsg) {
          if (s.exploreMsg.stone) {
            await shot(`ch${ch}-stone`);
            if (!s.exploreMsg.stone.lit) {
              // voice: a word Whisper did not catch is said again (up to three times), like a child would
              for (let k = 0; k < (VOICE ? 3 : 1); k++) {
                await typeAnswer('adv-stone-type', s.exploreMsg.stone.w);
                await sleep(250);
                if ((await snap()).exploreMsg?.stone?.lit !== false) break;
              }
            }
            await sleep(200);
            await press('adv-next');
          } else if (vp.touch) await press('adv-next');
          else await page.keyboard.press('z');
          await sleep(120);
          continue;
        }
        await shot(`ch${ch}-explore`);
        const stone0 = s.ents.find((e) => e.id === 'stone-0' || (e.kind === 'stone' && e.talked === 0));
        if (!stoneVisited && stone0 && stone0.talked === 0) {
          // walk to the first word stone
          if (vp.touch) {
            const p = await canvasPoint(stone0.x - s.camX, stone0.y - 6);
            await page.touchscreen.tap(p.x, p.y);
            await sleep(1500);
          } else {
            const dx = stone0.x - s.player.x;
            const dy = stone0.y - s.player.y;
            const key = Math.abs(dx) > 10 ? (dx > 0 ? 'ArrowRight' : 'ArrowLeft') : dy < 0 ? 'ArrowUp' : 'ArrowDown';
            await page.keyboard.down(key);
            await sleep(180);
            await page.keyboard.up(key);
            if (Math.abs(dx) <= 10) await page.keyboard.press('z');
          }
          const s2 = await snap();
          if (s2.exploreMsg?.stone) stoneVisited = true;
          if (Math.abs(s2.player.x - lastX) < 0.5 && !s2.exploreMsg) stuck++;
          else stuck = 0;
          lastX = s2.player.x;
          if (stuck > 12) stoneVisited = true; // give up the detour; the path still leads on
          continue;
        }
        // walk right along the path row (y of the start row)
        if (vp.touch) {
          const p = await canvasPoint(300, 7 * 16 + 4);
          await page.touchscreen.tap(p.x, p.y);
          await sleep(700);
        } else {
          const rowY = 7 * 16 + 12;
          if (Math.abs(s.player.y - rowY) > 6) {
            const key = s.player.y > rowY ? 'ArrowUp' : 'ArrowDown';
            await page.keyboard.down(key);
            await sleep(120);
            await page.keyboard.up(key);
          }
          await page.keyboard.down('ArrowRight');
          await sleep(600);
          await page.keyboard.up('ArrowRight');
        }
        continue;
      }
      if (s.scene === 'battle' && s.battle) {
        const b = s.battle;
        if (b.phase === 'msg') {
          if (vp.touch) await press('adv-next');
          else await page.keyboard.press('z');
          await sleep(90);
          continue;
        }
        if (b.phase === 'menu') {
          await shot(`ch${ch}-menu`);
          let cmd = 'talk';
          if (b.ready) cmd = 'friend';
          else if (!pouched && ch === 3 && b.items.honeyDrop > 0) cmd = 'pouch';
          else if (!poked && ch === 2) cmd = 'poke';
          if (cmd === 'pouch') pouched = true;
          if (cmd === 'poke') poked = true;
          if (vp.touch) await press(`adv-cmd-${cmd}`);
          else await page.keyboard.press(String(['poke', 'talk', 'pouch', 'friend'].indexOf(cmd) + 1));
          await sleep(150);
          continue;
        }
        if (b.phase === 'pouch') {
          await shot(`ch${ch}-pouch`);
          await press('adv-item-honeyDrop');
          continue;
        }
        if (b.phase === 'poke') {
          await shot(`ch${ch}-poke`);
          await sleep(900);
          if (vp.touch) await press('adv-poke');
          else await page.keyboard.press('z');
          continue;
        }
        if (b.phase === 'talkPick') {
          // rotate through the offered kinds so every mode gets used
          const want = ['say', 'build', 'spell', 'pick'][talks % 4];
          let idx = VOICE ? b.choices.findIndex((c) => c.mode === 'say') : b.choices.findIndex((c) => !modesUsed.has(c.mode));
          if (idx < 0) idx = Math.max(0, b.choices.findIndex((c) => c.mode === want));
          modesUsed.add(b.choices[idx].mode);
          allModes.add(b.choices[idx].mode);
          const btn = page.locator('[data-testid=adv-talk-choice]').nth(idx);
          if (vp.touch) await press(btn);
          else {
            for (let i = 0; i < idx; i++) await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
          }
          talks++;
          await sleep(150);
          continue;
        }
        if (b.phase === 'talk' && b.current) {
          const c = b.current;
          await shot(`ch${ch}-talk-${c.mode}`);
          if (await exists('adv-talk-next')) {
            await shot(`ch${ch}-talk-${c.mode}-result`);
            await press('adv-talk-next');
            continue;
          }
          if (c.mode === 'say') {
            for (let k = 0; k < (VOICE ? 3 : 1); k++) {
              await typeAnswer('adv-type', c.target);
              await sleep(250);
              if ((await exists('adv-talk-next')) || !(await exists('adv-mic'))) break;
              await shot(`ch${ch}-voice-again`);
            }
          }
          else if (c.mode === 'spell') {
            if (talks % 2) await typeAnswer('adv-spell-type', c.target);
            else {
              const used = new Set();
              const tiles = await page.locator('[data-testid=adv-tile]').evaluateAll((els) => els.map((e) => e.dataset.tile));
              for (const ch2 of c.target) {
                const i = tiles.findIndex((t, k) => t === ch2 && !used.has(k));
                if (i < 0) break;
                used.add(i);
                await press(page.locator('[data-testid=adv-tile]').nth(i));
              }
              await press('adv-check');
            }
          } else if (c.mode === 'build') {
            const used = new Set();
            const tiles = await page.locator('[data-testid=adv-tile]').evaluateAll((els) => els.map((e) => e.dataset.tile));
            for (const w of c.target.split(/\s+/)) {
              const i = tiles.findIndex((t, k) => t === w && !used.has(k));
              if (i < 0) break;
              used.add(i);
              await press(page.locator('[data-testid=adv-tile]').nth(i));
            }
            await press('adv-check');
          } else if (c.mode === 'pick') {
            await press(page.locator('[data-testid=adv-choice]', { hasText: c.target }));
          }
          await sleep(250);
          if (!(await exists('adv-talk-next'))) {
            await page.screenshot({ path: `${dir}/ch${ch}-talk-retry-${talks}.png` });
            fails.push(`${vp.name} ch${ch}: talk ${c.mode} "${c.target}" not passed`);
            await press('adv-talk-skip');
          }
          continue;
        }
        if (b.phase === 'befriend') {
          await shot(`ch${ch}-befriend`);
          const line = await page.locator('[data-testid=adv-befriend] .target').first().evaluate((e) => e.firstChild?.textContent ?? '');
          await typeAnswer('adv-befriend-type', line.trim());
          await sleep(200);
          if ((await snap()).battle?.phase === 'befriend') await press('adv-befriend-go');
          continue;
        }
        if (b.phase === 'dodge') {
          await shot(`ch${ch}-dodge-${s.ents.filter((e) => e.state !== 'idle').length}`);
          // a little real input now and then; the autopilot dodges when nothing is held
          if (vp.touch) {
            const p = await canvasPoint(160, 180);
            await page.touchscreen.tap(p.x, p.y);
          } else {
            await page.keyboard.down('ArrowLeft');
            await sleep(80);
            await page.keyboard.up('ArrowLeft');
          }
          await sleep(400);
          continue;
        }
        if (b.phase === 'end') {
          if (vp.touch) await press('adv-next');
          else await page.keyboard.press('z');
          continue;
        }
        await sleep(100);
        continue;
      }
      if (s.scene === 'end') {
        await sleep(600);
        await page.screenshot({ path: `${dir}/ch${ch}-end.png` });
        report.push({ vp: vp.name, ch, seconds: Math.round((Date.now() - t0) / 1000), ...s.end, talks });
        if (s.end.outcome !== 'spared') fails.push(`${vp.name} ch${ch}: outcome ${s.end.outcome}`);
        await press('adv-to-map');
        await sleep(300);
        break;
      }
      await sleep(100);
    }
  }

  // the guardian summary
  await press('adv-parent-link');
  await sleep(400);
  await page.screenshot({ path: `${dir}/90-parent.png`, fullPage: true });
  const parentOk = await exists('adv-parent-ch4');
  if (!parentOk) fails.push(`${vp.name}: parent summary missing`);
  // help toggle off: no Korean
  await press('adv-parent-back');
  await sleep(300);
  await press('adv-help');
  await sleep(200);
  await page.screenshot({ path: `${dir}/91-title-nohelp.png` });
  const hasKo = await page.locator('.adv-panel').evaluate((e) => [...e.querySelectorAll('*')].filter((x) => !x.children.length && x.dataset.testid !== 'adv-parent-link' && /[가-힣]/.test(x.textContent)).map((x) => x.textContent).join(' | '));
  // overflow: no horizontal page scroll
  const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (hScroll) fails.push(`${vp.name}: horizontal scroll`);
  // fps while dodging: the page's own frame counter, sampled once a second; only seconds spent wholly in a dodge turn
  const fpsSamples = await page.evaluate(() => {
    const out = [];
    const xs = window.__advFps ?? [];
    for (let i = 1; i < xs.length; i++) if (xs[i].dodge && xs[i - 1].dodge && xs[i].t > xs[i - 1].t) out.push(((xs[i].f - xs[i - 1].f) * 1000) / (xs[i].t - xs[i - 1].t));
    return out;
  });
  const fpsMin = fpsSamples.length ? Math.min(...fpsSamples) : null;
  const fpsAvg = fpsSamples.length ? fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length : null;
  if (!VOICE && allModes.size < 4) fails.push(`${vp.name}: TALK modes used ${[...allModes].join(',')} (want say, build, spell, pick)`);
  if (fpsMin === null) fails.push(`${vp.name}: no fps sample`);
  if (fpsMin !== null && fpsMin < 30) fails.push(`${vp.name}: fps min ${fpsMin.toFixed(1)}`);
  if (errors.length) fails.push(`${vp.name}: ${errors.length} page errors: ${errors.slice(0, 3).join(' | ')}`);
  let envelope = null;
  if (vp.ed || LIVE) {
    const last = beacons.at(-1);
    envelope = last ? JSON.parse(last.body) : null;
    if (!envelope) fails.push(`${vp.name}: no result sent`);
    else if (envelope.activities.length !== Number(process.env.MAXCH || 4)) fails.push(`${vp.name}: envelope has ${envelope.activities.length} activities`);
    if (!LIVE && !dayFetches.some((u) => /days\/2026-11-16/.test(u))) fails.push(`${vp.name}: day file not fetched`);
    if (LIVE && !results.some((r) => r.status === 200)) fails.push(`${vp.name}: live result POST not answered 200 (${results.map((r) => r.status).join(',')})`);
  }
  report.push({
    vp: vp.name,
    fpsMin: fpsMin && +fpsMin.toFixed(1),
    fpsAvg: fpsAvg && +fpsAvg.toFixed(1),
    fpsP10: fpsSamples.length ? +[...fpsSamples].sort((a, b) => a - b)[Math.floor(fpsSamples.length * 0.1)].toFixed(1) : null,
    fpsSamples: fpsSamples.length,
    errors: errors.length,
    koWithHelpOff: hasKo,
    talkModes: [...allModes],
    beacons: beacons.length,
    ...(LIVE ? { live: { origin: LIVE.origin, results, dayNote: lastDayNote } } : {}),
    voice: VOICE ? voice : undefined,
    envelope: envelope && { bytes: JSON.stringify(envelope).length, acts: envelope.activities.map((a) => `${a.id}:${a.stars}★ ${a.correct}/${a.total} w${a.words.length}`), summaryKo: envelope.summaryKo },
    dayFetches
  });
  writeFileSync(`${dir}/errors.txt`, errors.join('\n'));
  await ctx.close();
}

for (const vp of VIEWPORTS) {
  if (only && vp.name !== only) continue;
  try {
    await run(vp);
  } catch (e) {
    fails.push(hide(`${vp.name}: crashed ${e.message}`));
  }
  console.log(hide(JSON.stringify(report.filter((r) => r.vp === vp.name), null, 1)));
}
await browser.close();
writeFileSync(`${out}/report.json`, hide(JSON.stringify({ report, fails }, null, 1)));
console.log('FAILS', hide(JSON.stringify(fails, null, 1)));
process.exit(fails.length ? 1 : 0);
