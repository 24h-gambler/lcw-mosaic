// Turns tools/real-play.mjs reports (real-play-<view>.json) into nightly-audit regressions (tools/nightly-audit.mjs):
// the same { id, owner, route, sizes, why[] } shape, so the home-PC runner counts them in the hub card's title and the
// summary lists them. Pure: no browser, no network (tested in tools/__tests__/real-play-judge.test.ts).
//
// What a night run must show on production (smoke students only), and why:
//   no jump the child did not press, no whole-block climb with auto jump off   R2625 ②
//   every click/tap and E / talk button opened the right NPC's dialog           R2625 ③④
//   a pressed jump lifts the first-person view a little, not with the body     R2625 ①
//   the errand chain ends done                                                  errand loop
//   the hill ramp walks up by keys / stick with no jump                         R2625 (half-step ramp)
//   in a lesson the lesson NPC reopens the folded window by click and E,
//   a passer-by stays quiet (no prompt, no dialog, the window stays folded)     R2625 ③, #152
//   no page error and no failed request (cached-only voice 404s are by design and counted apart)

export const PLAY_ROUTE = '/world/';
/** the view may follow a pressed jump this much (JUMP_VIEW_FOLLOW 0.15 of a ~1.2 m rise is ~0.18 m) */
export const MAX_JUMP_CAM_RISE = 0.3;

const ratio = (s) => {
  const m = /^(\d+)\/(\d+)$/.exec(String(s ?? ''));
  return m ? { ok: Number(m[1]), tried: Number(m[2]) } : null;
};

/**
 * Findings of one view's report: [{ id, owner, why }] (empty = all good). A run with no report (stopped at the night's
 * limit, or the bot stopped) is not judged here: like a screen the audit had no time for, it is "not checked", never a
 * regression (playNotRun).
 */
/** A face miss whose NPC the scene graph did not draw: not in the scene, hidden, or no mesh. */
export function notDrawn(m) {
  return !!m?.sceneKnown && (!m.drawn || !m.drawn.inScene || !m.drawn.shown || m.drawn.meshes === 0);
}

/**
 * The bot missed NPCs that were drawn (scene graph: in the scene, shown, meshes), and never one that was not: a talk
 * count with no tries is the bot's miss, not checked. Without the scene graph (a page from before) it cannot tell.
 */
export function botMissedOnly(r) {
  const misses = r?.faceMisses ?? [];
  // a miss with the view not turning, the world paused or a dialog left open is the page's doing, not the bot's
  return misses.length > 0 && misses.every((m) => m.sceneKnown && !notDrawn(m) && m.turned !== false && !m.paused && !m.dlg);
}

export function judgeView(r) {
  const f = [];
  const add = (id, why, owner = 'world') => f.push({ id: `play:${id}`, owner, why });
  if (!r) return f;
  if ((r.unwantedJumps ?? 0) > 0) add('unwanted-jumps', `누르지 않은 점프·자동 오르기 ${r.unwantedJumps}번`);
  const gone = (r.faceMisses ?? []).filter(notDrawn);
  if (gone.length) {
    const why = (m) =>
      !m.drawn ? '씬에 없음' : !m.drawn.inScene ? '씬 그래프에 안 붙음' : !m.drawn.shown ? '숨김' : '메시 0';
    const ids = [...new Map(gone.map((m) => [m.id, `${m.id}(${why(m)}${m.drawn ? ` @${m.drawn.x},${m.drawn.y},${m.drawn.z}` : ''})`])).values()];
    add('npc-not-drawn', `말 걸 NPC 가 화면에 안 그려짐: ${ids.join(', ')}`);
  }
  // paused or a dialog open stops the look by design: those misses stay talk regressions, not a look-input one
  const stuck = (r.faceMisses ?? []).filter((m) => m.turned === false && !m.paused && !m.dlg);
  if (stuck.length) add('look-input', `시점 끌기로 시점이 안 돌아감 (${[...new Set(stuck.map((m) => m.id))].join(', ')} 찾는 중, ${stuck.reduce((a, m) => a + (m.turns ?? 0), 0)}번 끌어 0번 돎)`);
  const missedOnly = botMissedOnly(r);
  const click = ratio(r.clickSuccess);
  if (!click || click.tried === 0) {
    if (!missedOnly) add('click-talk', `클릭·탭 대화를 한 번도 못 해 봄 (${r.clickSuccess ?? '없음'})`);
  } else if (click.ok < click.tried) add('click-talk', `클릭·탭 대화 ${r.clickSuccess}`);
  const key = ratio(r.keySuccess);
  if (!key || key.tried === 0) {
    if (!missedOnly) add('key-talk', `E·말하기 버튼 대화를 한 번도 못 해 봄 (${r.keySuccess ?? '없음'})`);
  } else if (key.ok < key.tried) add('key-talk', `E·말하기 버튼 대화 ${r.keySuccess}`);
  if ((r.wrongNpc ?? 0) > 0) add('wrong-npc', `다른 NPC 대화가 열림 ${r.wrongNpc}번`);
  const high = (r.jumpView ?? []).filter((j) => j.bodyRise > 0.5 && j.camRise > MAX_JUMP_CAM_RISE);
  if (high.length) add('jump-view', `점프 때 시점이 ${high.map((j) => `${j.camRise}/${j.bodyRise}m`).join(', ')} 올라감 (한도 ${MAX_JUMP_CAM_RISE}m)`);
  if (!(r.jumpView ?? []).length) add('jump-view', '점프 시점 측정 없음');
  if (r.errand?.state !== 'done') add('errand', `심부름이 끝나지 않음 (${r.errand?.state ?? r.errand?.status ?? '?'})`);
  const h = r.hill;
  // the bot never got down to the ramp's foot: the climb was not tried, so it is not checked (not a regression)
  if (h?.ran && h.reachedBottom !== false) {
    if (!h.reachedTop) add('hill', `언덕 경사로를 키로 못 오름 (높이 ${h.topY}, ${h.tries}번 시도)`);
    else if ((h.pressedJumpsUp ?? 0) + (h.unwantedJumpsUp ?? 0) + (h.autoClimbsUp ?? 0) > 0)
      add('hill', `언덕을 오르는 데 점프·자동 오르기가 섞임 (점프 ${h.pressedJumpsUp}, 원치 않은 ${h.unwantedJumpsUp}, 자동 ${h.autoClimbsUp})`);
  }
  const l = r.lesson;
  if (l?.started) {
    if (!l.dialogOpened) add('lesson-window', '수업 대화창이 열리지 않음', 'lesson');
    else {
      if (l.reopenByClick === false) add('lesson-reopen', '수업 NPC 클릭·탭으로 접은 창이 다시 안 열림');
      if (l.reopenByKey === false) add('lesson-reopen', '수업 NPC E·말하기 버튼으로 접은 창이 다시 안 열림');
      if (l.passer && l.passer.ok === false) {
        const p = l.passer;
        add('lesson-passer', `수업 중 지나가는 NPC(${p.id}): 표시 ${p.prompt ? '뜸' : '없음'}${p.talkButton ? ' · 말하기 버튼 뜸' : ''} · 대화창 ${p.dialogOpened ? '열림' : '안 열림'} · 조용한 탭 ${p.quietTaps ?? 0} · 접힘 ${p.stillFolded ? '유지' : '풀림'}${p.faced ? '' : ' · NPC를 화면에 못 잡음'}`);
      }
    }
  }
  const errs = r.errs ?? [];
  if (errs.length) add('page-errors', `페이지·요청 오류 ${errs.length}: ${errs.slice(0, 3).join(' / ')}`);
  return f;
}

/**
 * Regressions for the nightly report: one entry per finding id, with the sizes (views) it showed on. `reports` maps a
 * view name ('pc', 'touch') to its report (null when the run did not finish), `sizes` the view to its viewport label.
 */
export function playRegressions(reports, sizes = { pc: '1440x900', touch: '390x844' }) {
  const by = new Map();
  for (const [view, r] of Object.entries(reports)) {
    for (const x of judgeView(r)) {
      const e = by.get(x.id) ?? { id: x.id, owner: x.owner, route: PLAY_ROUTE, sizes: [], why: [] };
      e.sizes.push(sizes[view] ?? view);
      e.why.push(`${view}: ${x.why}`);
      by.set(x.id, e);
    }
  }
  return [...by.values()];
}

/** Views that left no report, with why (`runs` from runPlay: { killed, code }): "not checked", not regressions. */
export function playNotRun(reports, runs = {}) {
  return Object.entries(reports)
    .filter(([, r]) => !r)
    .map(([view]) => ({
      view,
      why: runs[view]?.stalledAfter
        ? `'${runs[view].stalledAfter}' 다음 단계에서 10분 넘게 진행 없음(봇이 멈춤)`
        : runs[view]?.killed
          ? '시간 한도에 멈춤'
          : `보고서 없음(종료 코드 ${runs[view]?.code ?? '?'})`
    }));
}

/** One line per view for the summary (Korean, what the night run measured). */
export function playLines(reports) {
  return Object.entries(reports).map(([view, r]) => {
    if (!r) return `- ${view}: 실행 못 함 — 확인 안 됨(회귀 아님)`;
    const cam = (r.jumpView ?? []).map((j) => j.camRise).join('/');
    const h = !r.hill?.ran ? '언덕 안 봄' : r.hill.reachedBottom === false ? '언덕 확인 안 됨(경사로 아래로 못 내려감)' : `언덕 ${r.hill.reachedTop ? `오름(높이 ${r.hill.topY})` : '못 오름'}`;
    const p = r.lesson?.passer ? `지나가는 NPC ${r.lesson.passer.ok === null ? '확인 안 됨(화면에 못 잡음)' : r.lesson.passer.ok ? '조용' : '문제'}` : '';
    const yn = (v) => (v === null || v === undefined ? '확인 안 됨' : v ? '됨' : '안 됨');
    const les = r.lesson?.started ? `수업 다시 열기 클릭 ${yn(r.lesson.reopenByClick)}·E ${yn(r.lesson.reopenByKey)}` : '수업 안 봄';
    const zero = (x) => ratio(x)?.tried === 0 && botMissedOnly(r);
    const talk = (x) => (zero(x) ? `${x} 확인 안 됨(NPC 는 그려져 있고 봇이 화면에 못 잡음)` : x);
    return `- ${view} ${r.size ?? ''}: 클릭 ${talk(r.clickSuccess)} · E ${talk(r.keySuccess)} · 다른 NPC ${r.wrongNpc ?? 0} · 원치 않은 점프 ${r.unwantedJumps ?? 0} · 점프 시점 ${cam}m · 심부름 ${r.errand?.state ?? '?'} · ${h} · ${les}${p ? ` · ${p}` : ''} · 오류 ${(r.errs ?? []).length} (캐시 전용 음성 404 ${r.ttsCacheMiss ?? 0}, 설계대로) · ${r.seconds ?? '?'}초`;
  });
}
