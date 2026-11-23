// The adventure's key-only player (R2734 ①): reads `window.__adv.debugState()` and answers with ONE key action — Z, X,
// an arrow tap on a list, or an arrow held to walk. It never calls the engine itself, so the same brain drives the
// in-process run (apps/adventure/src/__tests__/adventure-playthrough.test.ts) and the headless browser
// (tools/adventure-keys.mjs, real key presses). Dodging is left to the page's ?autopilot=1 (only while no key is
// held); everything else — the map, talks with choices, chests, posts, Tumble's cart, the menu, TALK, SKILL, POUCH,
// FRIEND, the boat, the ending — is keys.
//
// `failBoss`: islands where the guardian is meant to win the first meeting (the bot pokes and misses, and pins the
// voice bubble to the floor), to measure "out of voice → the last lantern post → meet it again".

const MENU = ['poke', 'talk', 'pouch', 'friend'];
const DIRS = [
  ['left', -1, 0],
  ['right', 1, 0],
  ['up', 0, -1],
  ['down', 0, 1]
];

/**
 * @param {{ failBoss?: number[]; lowHp?: number; buysPerVisit?: number; neverTalk?: boolean; skipTalk?: boolean; pickOnly?: boolean; loseBossAlways?: boolean }} [opts]
 * neverTalk: never chooses TALK (pokes only). skipTalk (R2861): chooses TALK, then always backs out of the English
 * without answering (the old "Not now" path). loseBossAlways: every guardian meeting is meant to be lost.
 */
export function createAutoplay(opts = {}) {
  const failBoss = new Set(opts.failBoss ?? [1]);
  const lowHp = opts.lowHp ?? 0.45;
  const buysPerVisit = opts.buysPerVisit ?? 2;
  const neverTalk = Boolean(opts.neverTalk);
  const skipTalk = Boolean(opts.skipTalk);
  // R2861 pickOnly: chooses TALK and answers only the 3-way reply picks (never says or types a line)
  const pickOnly = Boolean(opts.pickOnly);
  const loseBossAlways = Boolean(opts.loseBossAlways);
  const mem = {
    /** talk replies already picked: `${who}|${line}|${reply}` */
    picked: new Set(),
    /** islands whose guardian already won once */
    failed: new Set(),
    /** things touched on each island: `${chapter}:${id}` */
    visited: new Set(),
    /** targets given up on (unreachable or not answering) */
    skipped: new Set(),
    tries: new Map(),
    shopVisits: new Set(),
    boughtNow: 0,
    pending: null,
    skillsUsed: new Set(),
    battleKey: '',
    endingSeen: false,
    lastRoute: null,
    /** what happened, for the report */
    seen: { chests: [], buys: [], skills: [], replies: [], downs: [], wakes: 0, posts: [], stages: new Set(), battles: [], tracks: new Set(), chapterSeconds: [], bossTry: {}, bossRun: [] }
  };

  const listMove = (cur, want, n) => {
    if (cur === want) return null;
    const fwd = (want - cur + n) % n;
    return fwd <= n - fwd ? { key: 'down', why: 'list' } : { key: 'up', why: 'list' };
  };

  let lastChapter = 0;
  let chapterStartT = 0;

  function next(s) {
    // R2861 metrics: how long each island took (engine seconds) and each guardian attempt's outcome
    if (s.chapter !== lastChapter) {
      lastChapter = s.chapter;
      chapterStartT = s.t ?? 0;
    }
    if (s.scene === 'end' && !mem.seen.chapterSeconds.some((c) => c.chapter === s.chapter)) {
      mem.seen.chapterSeconds.push({ chapter: s.chapter, seconds: Math.round((s.t ?? 0) - chapterStartT) });
    }
    if (s.scene === 'battle' && s.battle?.boss && s.battle.outcome) {
      const attempt = mem.seen.bossTry[s.chapter] ?? 1;
      if (!mem.seen.bossRun.some((x) => x.key === mem.battleKey && x.attempt === attempt)) {
        mem.seen.bossRun.push({ key: mem.battleKey, chapter: s.chapter, attempt, outcome: s.battle.outcome });
      }
    }
    // a touch is answered by a talk, a chest note, the cart or a meeting: the thing is done
    if (mem.pending && (s.msg != null || s.shop || s.scene !== 'explore')) {
      mem.visited.add(mem.pending);
      mem.pending = null;
    }
    // a new meeting starts when the last one was left (the same guardian met again counts again)
    if (s.scene !== 'battle') mem.battleKey = '';
    switch (s.scene) {
      case 'title':
        return mem.endingSeen ? { done: true } : { key: 'z', why: 'start' };
      case 'story':
        if (s.story?.kind === 'ending' || s.story?.kind === 'credits') mem.endingSeen = true;
        return { key: 'z', why: `story ${s.story?.kind} ${s.story?.i}` };
      case 'down':
        if (s.down?.boss) mem.failed.add(s.chapter);
        if (!mem.seen.downs.some((d) => d.t === s.frames)) mem.seen.downs.push({ chapter: s.chapter, boss: Boolean(s.down?.boss), where: s.down?.where, t: s.frames });
        mem.seen.wakes += 1;
        return { key: 'z', why: 'wake' };
      case 'end':
        return { key: 'z', why: 'sail' };
      case 'battle':
        return battle(s);
      case 'explore':
        return explore(s);
      default:
        return { done: true, why: `scene ${s.scene}` };
    }
  }

  function battle(s) {
    const b = s.battle;
    const key = `${s.chapter}:${b.creature}`;
    if (mem.battleKey !== key) {
      mem.battleKey = key;
      mem.skillsUsed = new Set();
      mem.seen.battles.push({ chapter: s.chapter, creature: b.creature, boss: b.boss });
      if (b.boss) mem.seen.bossTry[s.chapter] = (mem.seen.bossTry[s.chapter] ?? 0) + 1;
    }
    if (b.stage > 0) mem.seen.stages.add(`${s.chapter}:${b.stage}`);
    const hp = s.run.hp;
    const low = hp <= s.run.hpMax * lowHp;
    const fail = b.boss && (loseBossAlways || (failBoss.has(s.chapter) && !mem.failed.has(s.chapter)));
    const pouch = s.pouch ?? [];
    switch (s.phase) {
      case 'msg':
      case 'befriend':
      case 'end':
        return { key: 'z', why: s.phase };
      case 'menu': {
        let want = 'talk';
        if (neverTalk) want = 'poke';
        else if (fail) want = 'poke';
        else if (b.ready) want = 'friend';
        else if (low && pouch.length) want = 'pouch';
        const i = MENU.indexOf(want);
        return listMove(s.menuIndex, i, MENU.length) ?? { key: 'z', why: `menu ${want}` };
      }
      case 'talkPick': {
        const list = s.talkChoices ?? [];
        // magic words (inside TALK) first; then a reply to pick (always offered)
        // R2861: only a SAID line (voice / typed) passes a talk — the bot says one; pickOnly never does (the loophole bot)
        let i = pickOnly ? list.findIndex((c) => c.mode === 'pick' && !c.skill) : list.findIndex((c) => c.skill);
        if (i < 0) i = list.findIndex((c) => (pickOnly ? c.mode === 'pick' : c.mode === 'say'));
        if (i < 0) i = list.findIndex((c) => c.mode === 'pick');
        if (i < 0) i = 0;
        const mv = listMove(s.cursor, i, s.listLen);
        if (mv) return mv;
        if (list[i]?.skill) mem.seen.skills.push({ chapter: s.chapter, skill: list[i].skill, hp });
        return { key: 'z', why: 'talk pick' };
      }
      case 'pouch':
        return { key: 'z', why: `pouch ${pouch[s.cursor]}` };
      case 'talk': {
        const t = s.talk;
        if (skipTalk) return { key: 'x', why: 'back out of the English (skip bot)' };
        if (t?.result && t.result.pass && t.result.stars > 0) return { key: 'z', why: 'talk next' };
        if (t?.mode === 'pick' && t.choices) {
          const i = t.choices.indexOf(t.target);
          return listMove(s.cursor, i < 0 ? 0 : i, t.choices.length) ?? { key: 'z', why: 'answer' };
        }
        // a spoken line: the bot types it (microphone off) / the engine test hands it over as the transcript
        if (t?.mode === 'say') return { say: t.target, why: 'say the line' };
        return { key: 'x', why: `talk ${t?.mode} needs the panel` };
      }
      case 'poke':
        // a meant-to-lose meeting lets the ring run out (a miss); otherwise strike now
        return fail ? { wait: 400, why: 'let the ring pass' } : { key: 'z', why: 'poke' };
      case 'dodge':
        return fail ? { hold: 'down', ms: 400, why: 'stay low (meant to lose)' } : { wait: 400, why: 'dodge' };
      default:
        return { wait: 100 };
    }
  }

  function explore(s) {
    if (s.shop) return shop(s);
    if (s.msg != null) {
      if (s.reveal < s.msg.length) return { key: 'z', why: 'show line' };
      if (s.choices && s.listLen > 0) {
        const node = `${s.chapter}|${s.msgWho}|${s.msg}`;
        const n = s.choices.length;
        let i = s.choices.findIndex((c, k) => k < n - 1 && !mem.picked.has(`${node}|${c}`));
        if (i < 0) i = n - 1;
        const mv = listMove(s.cursor, i, n);
        if (mv) return mv;
        mem.picked.add(`${node}|${s.choices[i]}`);
        mem.seen.replies.push({ chapter: s.chapter, who: s.msgWho, reply: s.choices[i] });
        return { key: 'z', why: `reply ${s.choices[i]}` };
      }
      return { key: 'z', why: 'next line' };
    }
    return walk(s);
  }

  function shop(s) {
    const visit = `${s.chapter}`;
    if (!mem.shopVisits.has(visit)) {
      mem.shopVisits.add(visit);
      mem.boughtNow = 0;
    }
    const rows = s.shop;
    const leave = rows.length;
    if (mem.boughtNow < buysPerVisit) {
      // magic words first, then gear, then snacks
      const rank = { skill: 0, gear: 1, item: 2 };
      const ok = rows.map((r, k) => ({ r, k })).filter((x) => x.r.check === 'ok').sort((a, b) => rank[a.r.kind] - rank[b.r.kind]);
      const i = ok.length ? ok[0].k : -1;
      if (i >= 0) {
        const mv = listMove(s.cursor, i, rows.length + 1);
        if (mv) return mv;
        mem.boughtNow += 1;
        mem.seen.buys.push({ chapter: s.chapter, id: rows[i].id, cost: rows[i].cost, coins: s.run.coins });
        return { key: 'z', why: `buy ${rows[i].id}` };
      }
    }
    return listMove(s.cursor, leave, rows.length + 1) ?? { key: 'z', why: 'leave the cart' };
  }

  // ---------- walking ----------
  function blockedGrid(s, except) {
    const T = s.tile;
    const g = s.walls.map((row) => [...row].map((c) => c === '#'));
    for (const e of s.entities) {
      if (e.state !== 'idle' || e.id === except) continue;
      for (let y = 0; y < g.length; y++)
        for (let x = 0; x < g[0].length; x++) if (hits({ x: x * T + 1, y: y * T + 1, w: T - 2, h: T - 2 }, e.box)) g[y][x] = true;
    }
    return g;
  }

  function targetTiles(s, e) {
    const T = s.tile;
    const out = [];
    for (let y = 0; y < s.walls.length; y++)
      for (let x = 0; x < s.walls[0].length; x++) if (hits({ x: x * T + 1, y: y * T + 1, w: T - 2, h: T - 2 }, e.box)) out.push([x, y]);
    if (!out.length) out.push([e.tx, e.ty]);
    return out;
  }

  /** Shortest path (tiles) from the player to a free tile next to `e`, with the direction to push from there. */
  function route(s, e) {
    const g = blockedGrid(s);
    const tt = targetTiles(s, e);
    const isT = new Set(tt.map(([x, y]) => `${x},${y}`));
    const goals = new Map();
    for (const [x, y] of tt)
      for (const [d, dx, dy] of DIRS) {
        const gx = x - dx;
        const gy = y - dy;
        if (g[gy]?.[gx] === false && !isT.has(`${gx},${gy}`) && !goals.has(`${gx},${gy}`)) goals.set(`${gx},${gy}`, d);
      }
    const from = [Math.floor(s.player.x / s.tile), Math.floor((s.player.y - 1) / s.tile)];
    const prev = new Map([[`${from[0]},${from[1]}`, null]]);
    const q = [from];
    while (q.length) {
      const [x, y] = q.shift();
      const k = `${x},${y}`;
      if (goals.has(k)) {
        const path = [];
        let c = k;
        while (c) {
          path.unshift(c.split(',').map(Number));
          c = prev.get(c);
        }
        return { path, push: goals.get(k) };
      }
      for (const [, dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const nk = `${nx},${ny}`;
        if (g[ny]?.[nx] === false && !prev.has(nk)) {
          prev.set(nk, k);
          q.push([nx, ny]);
        }
      }
    }
    return null;
  }

  function want(s) {
    const id = (e) => `${s.chapter}:${e.id}`;
    const open = (e) => !mem.visited.has(id(e)) && !mem.skipped.has(id(e));
    const ents = s.entities;
    const errands = ents.filter((e) => open(e) && ((e.kind === 'chest' && e.state === 'idle') || e.kind === 'villager' || e.kind === 'merchant' || e.kind === 'post'));
    const meets = ents.filter((e) => e.state === 'idle' && e.kind === 'critter' && !mem.skipped.has(id(e)));
    const guard = ents.filter((e) => e.state === 'idle' && e.kind === 'guardian');
    for (const group of [errands, meets, guard]) {
      let best = null;
      for (const e of group) {
        const r = route(s, e);
        if (r && (!best || r.path.length < best.r.path.length)) best = { e, r };
      }
      if (best) return best;
    }
    return null;
  }

  function walk(s) {
    const pick = want(s);
    if (!pick) return { done: true, why: 'nothing left to walk to' };
    const { e, r } = pick;
    mem.lastRoute = { id: e.id, push: r.push, path: r.path.length, dir: s.player.dir };
    const tag = `${s.chapter}:${e.id}`;
    const n = (mem.tries.get(tag) ?? 0) + 1;
    mem.tries.set(tag, n);
    if (n > 600) {
      mem.skipped.add(tag);
      return { wait: 50, why: `gave up on ${e.id}` };
    }
    const T = s.tile;
    const p = s.player;
    // close to the thing: walk into it. Every island thing is solid until it answers (a chest opens, a post rests,
    // a villager talks, a gate mini boss meets), so pushing into it is the same as facing it and pressing Z.
    const ddx = e.x - p.x;
    const ddy = e.y - p.y;
    const reach = e.kind === 'critter' || e.kind === 'gate' || e.kind === 'guardian' ? T * 2.6 : T * 1.8;
    if (Math.abs(ddx) < reach && Math.abs(ddy) < T * 2.2) {
      const dir = Math.abs(ddx) > Math.abs(ddy) ? (ddx < 0 ? 'left' : 'right') : ddy < 0 ? 'up' : 'down';
      mem.pending = tag;
      if (e.kind === 'chest') mem.seen.chests.push({ chapter: s.chapter, id: e.id });
      if (e.kind === 'post') mem.seen.posts.push({ chapter: s.chapter, id: e.id });
      return { hold: dir, ms: 120, why: `touch ${e.id}` };
    }
    // the next tile centre on the path (the first one not stood on yet)
    const stepTile = r.path.length > 1 ? r.path[1] : r.path[0];
    if (!stepTile) return { wait: 30, why: `approach ${e.id}` };
    const [tx, ty] = stepTile;
    const cx = tx * T + T / 2;
    const cy = ty * T + T - 2;
    const dx = cx - p.x;
    const dy = cy - p.y;
    const ms = (d) => Math.max(17, Math.min(400, (Math.abs(d) / s.speed) * 1000));
    const ax = Math.abs(dx) > 1;
    const ay = Math.abs(dy) > 1;
    const go = (axis) => (axis === 'x' ? { hold: dx < 0 ? 'left' : 'right', ms: ms(dx), why: `walk to ${e.id}` } : { hold: dy < 0 ? 'up' : 'down', ms: ms(dy), why: `walk to ${e.id}` });
    // straighten the smaller offset first (the feet box catches corners), then go
    if (ax && ay) return go(Math.abs(dx) < Math.abs(dy) ? 'x' : 'y');
    if (ax) return go('x');
    if (ay) return go('y');
    return { wait: 30, why: `approach ${e.id}` };
  }

  return { next, mem };
}

function hits(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** What must change after a Z (else it stalled): the scene, the list, the text, the trip, the meeting. */
export function zSignature(s) {
  return JSON.stringify([
    s.scene,
    s.phase,
    s.msg,
    Math.floor(s.reveal),
    s.cursor,
    s.menuIndex,
    s.story,
    s.shop,
    s.talk?.id,
    s.talk?.result,
    s.run?.hp,
    s.run?.coins,
    s.run?.flags?.length,
    s.run?.post,
    s.battle?.calm,
    s.battle?.grump,
    s.choices,
    s.down,
    s.end?.nextNote,
    s.entities?.map((e) => e.state).join(''),
    s.player?.dir
  ]);
}
