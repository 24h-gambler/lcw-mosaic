// Guardian check after a real lesson (coordinator 11-16): what the child's guardian receives — the /family home card,
// the dashboard's lesson row, the public report link and the push notice — read from production, without changing it.
//
//   node tools/guardian-check.mjs --player stu-29ddc960 [--before | --lesson <lesson id>]
//                                  [--base https://lcw.worldwidesomething.com] [--token-file <path>] [--json]
//
// - Read only: every request is a GET. The public report is opened as the teacher's preview (operator token), which
//   records no parent open, so the check never spends the guardian's "opened" or cancels the 2-day reminder.
// - The operator token is read from --token-file (default LCW_OPERATOR_TOKEN_FILE, else the automation secrets file)
//   and is never printed. Share links are printed masked (/r/abcdef…); the child is named by id only.
// - --before (ahead of a lesson): sign-in, consents, seat and push only — a guardian with no session and no open
//   invite is a FAIL. Otherwise the lesson: --lesson, else the latest lesson of the child. Output: one line per check (OK / WARN / FAIL) and a summary;
//   --json prints the rows as JSON instead. Exit code 1 when any check FAILs.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** First 6 characters of a share token: enough to tell links apart, useless as a link. */
export const maskShare = (p) => (typeof p === 'string' ? p.replace(/^(\/r\/[0-9a-f]{6})[0-9a-f]+/i, '$1…') : p ?? null);

const DAY = 86_400_000;

/**
 * The checks, from what the routes returned. `view` = GET /v1/admin/children/:pid/guardian-view; `report` =
 * { status, body } of GET /v1/reports/:token (preview); `page` = { status, type } of GET /r/:token.
 * Returns rows { key, level: 'ok' | 'warn' | 'fail', msg }.
 */
export function checkGuardian(view, report, page, opts = {}) {
  const rows = [];
  const add = (key, level, msg) => rows.push({ key, level, msg });
  // before the lesson: can the guardian get in at all (invite → session → service consent → lesson window consent)
  const s = view?.signin ?? {};
  const consents = view?.home?.consents ?? {};
  if (s.sessions_active > 0) add('signin', s.service_consented ? 'ok' : 'warn', `guardian signed in on ${s.sessions_active} browser(s)${s.service_consented ? '' : ' · service consent not given yet'}`);
  else if (s.invites_open > 0) add('signin', 'warn', `not signed in yet · ${s.invites_open} invite link(s) open: /family, the lesson window and push need it; the report link works alone`);
  else add('signin', opts.before ? 'fail' : 'warn', 'not signed in and no open invite: make one (POST /v1/admin/family-invites) and send it before the lesson');
  add('consent_window', consents.lesson_window ? 'ok' : 'warn', `lesson window consent ${consents.lesson_window ? 'on' : 'off (the guardian turns it on in /family)'}`);
  add('consent_voice', 'ok', `voice keeping consent ${consents.voice_store ? 'on' : 'off (no clips are kept)'}`);
  if (view?.seat?.state) add('seat', view.seat.allowed ? 'ok' : 'warn', `seat ${view.seat.state}`);
  else add('seat', 'warn', 'no seat issued');
  const push0 = view?.push ?? {};
  add('push_switch', 'ok', `sending ${push0.sending ? 'ON' : 'off'} · guardian devices ${push0.devices ?? 0}`);
  if (opts.before) return rows;

  const lessons = view?.dashboard?.lessons ?? [];
  const lesson = opts.lesson ? lessons.find((l) => l.id === opts.lesson) : lessons[0];
  if (!lesson) {
    add('lesson', 'fail', opts.lesson ? `lesson ${opts.lesson} not in the dashboard` : 'no lesson yet');
    return rows;
  }
  add('lesson', lesson.ended_at ? 'ok' : 'fail', `${lesson.id} ${lesson.ended_at ? 'ended' : 'still running'} · ${lesson.duration_min} min`);

  // the dashboard row: the numbers the guardian reads (and the lesson lane's per-student CSV uses the same fields)
  const talk = Number(lesson.student_min) + Number(lesson.teacher_min);
  add(
    'dashboard_row',
    lesson.utterances > 0 ? 'ok' : 'warn',
    `utterances ${lesson.utterances} · passes ${lesson.passes} · student ${lesson.student_min} min · teacher ${lesson.teacher_min} min · share ${lesson.student_share ?? '-'}`
  );
  if (talk === 0) add('talk_minutes', 'warn', 'no talk minutes recorded (student and teacher minutes are 0)');

  const path = lesson.report_path;
  add('report_link', path ? 'ok' : 'fail', path ? `dashboard links ${maskShare(path)}` : 'the dashboard row has no report link');
  const card = (view.home?.reports ?? []).find((r) => r.share_path === path);
  add('home_card', card ? 'ok' : 'fail', card ? `/family lists it (${card.lesson_day}, ${card.opened ? 'opened' : 'not opened yet'})` : '/family home does not list this report');
  const del = (view.deliveries ?? []).find((d) => d.report_id === `rep-${lesson.id}`);
  add('delivery', del ? 'ok' : 'fail', del ? `delivery ${del.status}${del.teacher_comment ? ' · teacher comment' : ' · no teacher comment'}` : 'no report delivery row');
  if (del && !del.teacher_comment) add('teacher_comment', 'warn', 'the report has no teacher comment');
  if (!view.dashboard?.next_lesson_at) add('next_lesson', 'warn', 'no next lesson time on the dashboard');

  // the public report: opens, numbers match the dashboard row, names no child or family
  if (!report || report.status !== 200) add('report_open', 'fail', `public report answered ${report?.status ?? 'nothing'}`);
  else {
    const b = report.body ?? {};
    add('report_open', b.kind === 'lesson' && b.ref_id === lesson.id ? 'ok' : 'fail', `public report ${b.kind}/${b.ref_id === lesson.id ? 'this lesson' : b.ref_id}`);
    const fl = b.facts?.lesson ?? {};
    if (typeof fl.utterances === 'number') {
      const same = fl.utterances === lesson.utterances && (typeof fl.passes !== 'number' || fl.passes === lesson.passes);
      add('report_numbers', same ? 'ok' : 'warn', `report ${fl.utterances}/${fl.passes ?? '-'} vs dashboard ${lesson.utterances}/${lesson.passes} (utterances/passes)`);
    }
    const text = JSON.stringify(b);
    const leaks = [];
    if (/"(player_id|guardian_id|family_id)"/.test(text)) leaks.push('id field');
    if (view.child?.player_id && text.includes(view.child.player_id)) leaks.push('player id');
    if (view.family_id && text.includes(view.family_id)) leaks.push('family id');
    const nick = String(view.child?.nickname ?? '').trim();
    if (nick && new RegExp(`\\b${nick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) leaks.push('nickname');
    add('report_privacy', leaks.length ? 'fail' : 'ok', leaks.length ? `public report carries ${leaks.join(', ')}` : 'no ids, no nickname in the public report');
    if (b.expires_at && b.expires_at - (view.server_now ?? Date.now()) < 3 * DAY) add('report_expiry', 'warn', 'the link expires within 3 days');
  }
  if (!page || page.status !== 200 || !/text\/html/.test(page.type ?? '')) add('report_page', 'fail', `/r/… page answered ${page?.status ?? 'nothing'} ${page?.type ?? ''}`);
  else add('report_page', 'ok', '/r/… page serves');

  // the push notice of this report
  const push = view.push ?? {};
  const notice = (push.outbox ?? []).find((o) => o.ref === `report:rep-${lesson.id}`);
  if (!notice) add('push_notice', 'fail', 'no lesson_report notice in the outbox');
  else {
    const expected = push.sending ? ['sent', 'no_device', 'skipped'] : ['queued', 'skipped', 'expired'];
    add('push_notice', expected.includes(notice.status) ? 'ok' : 'warn', `lesson_report ${notice.status}${notice.status === 'queued' && !push.sending ? ' (held: sending is off)' : ''}`);
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
  };
  const player = opt('player');
  if (!player) {
    console.error('usage: node tools/guardian-check.mjs --player <id> [--before | --lesson <id>] [--base <url>] [--token-file <path>] [--json]');
    process.exit(2);
  }
  const base = opt('base', 'https://lcw.worldwidesomething.com').replace(/\/$/, '');
  const tokenFile = opt('token-file', process.env.LCW_OPERATOR_TOKEN_FILE || 'C:/Users/2idki/automation/secrets/lcw-operator.token');
  const token = (process.env.LCW_OPERATOR_TOKEN || readFileSync(tokenFile, 'utf8')).trim();
  const auth = { authorization: `Bearer ${token}` };
  const get = async (path, headers = {}) => {
    const res = await fetch(`${base}${path}`, { method: 'GET', headers, signal: AbortSignal.timeout(20_000) });
    const type = res.headers.get('content-type') ?? '';
    const body = /json/.test(type) ? await res.json().catch(() => null) : (await res.text(), null);
    return { status: res.status, type, body };
  };
  const v = await get(`/v1/admin/children/${encodeURIComponent(player)}/guardian-view`, auth);
  if (v.status !== 200) {
    console.error(`guardian-view answered ${v.status} ${v.body?.error ?? ''}`);
    process.exit(1);
  }
  const before = args.includes('--before');
  const lessons = before ? [] : v.body.dashboard?.lessons ?? [];
  const lesson = opt('lesson') ? lessons.find((l) => l.id === opt('lesson')) : lessons[0];
  const path = lesson?.report_path;
  const report = path ? await get(`/v1/reports/${path.slice(3)}`, auth) : null;
  const page = path ? await get(path) : null;
  const rows = checkGuardian(v.body, report, page, { lesson: opt('lesson'), before });
  if (args.includes('--json')) console.log(JSON.stringify({ player, lesson: lesson?.id ?? null, rows }, null, 2));
  else {
    for (const r of rows) console.log(`${r.level.toUpperCase().padEnd(4)} ${r.key.padEnd(15)} ${r.msg}`);
    const n = (l) => rows.filter((r) => r.level === l).length;
    console.log(`-- ${player} · ok ${n('ok')} · warn ${n('warn')} · fail ${n('fail')}`);
  }
  process.exit(rows.some((r) => r.level === 'fail') ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
