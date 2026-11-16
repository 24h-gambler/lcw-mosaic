// PR text check (AGENTS.md 0.7, operator 2026-11-16: "왜 수업뒤에 넣어요? 제 말이 제대로 전달이 안되고 있나요?").
// An instruction from the operator was turned into "later" or "a smaller version first" on its way to a lane four times in
// one day (3D → lesson mode, one-time link, world picker, merge after 17:00). Postponing and narrowing are the operator's
// call only, so a PR that postpones or narrows must cite the decision: a decision card id (d_…) or a ledger line (R…)
// in the same paragraph.
//
//   node tools/pr-lint.mjs <PR number>      reads title + body with `gh pr view` and fails (exit 1) on an uncited phrase
//   node tools/pr-lint.mjs --file <path>    the same for a text file (a PR body draft)
// Required before every merge (AGENTS.md 5장). Code blocks, short code spans (a phrase being named) and quotes that say
// they are the operator's words (`> Dan: …`) are not checked: quoting the operator or this rule is not postponing.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DECISION_REF = /\b(?:d_[0-9a-f]{6,}|R\d{3,})\b/;

/** Phrases that postpone or narrow. Each needs a decision id in the same paragraph. */
const ACT = '(?:머지|배포|넣|만들|붙|진행|올리|하겠|할게|합니다|작업)';
export const DEFER_PATTERNS = [
  {
    id: 'later',
    re: new RegExp(
      [
        // '미루는 말', '미루거나 줄이는' describe the rule; the verb forms that do it are listed
        '나중에', '추후', '미루(?:고|겠|어|자|기로)', '미룹', '미뤄', '미룸', '미룰', '늦춥', '늦춰', '늦추(?:고|겠|기로)', '넘깁니다', '넘기겠', '넘겨', '다음\\s*(?:PR|작업|번\\s*에)', '다음\\s*단계\\s*(?:에서|로\\s*미|에\\s*(?:넣|붙|만들))',
        '후속\\s*(?:PR|작업)', '별도\\s*(?:PR|작업)', 'PR\\s*을?\\s*(?:나누|분리)', '분리(?:해|하여|한)?\\s*(?:PR|작업)', '2차\\s*(?:로|에서|작업)',
        '이번\\s*PR\\s*(?:에|에서)?\\s*(?:는\\s*)?(?:넣지|포함하지|하지|만들지)\\s*않',
        // "later" as a promise to do it then, not as a time ("30 days later", "a later run")
        '\\b(?:will|to be|be|do|add|fix|handle|wire|ship|merge|deploy|address|revisit|come back to)\\b[^.]{0,30}\\blater\\b',
        '\\blater (?:PR|today|tonight|this week)\\b',
        'follow[- ]?up\\s+(?:PR|work|task|change)', '\\bin a follow[- ]?up\\b', 'postpon', '\\bdefer(?:red|ring)? (?:to|until|it|this|that|the)\\b',
        '\\b(?:next|subsequent|separate|another|future) PR\\b', '\\bnot (?:included|in this PR|done yet)\\b',
        // review 11-16 round 2: words that put work off without saying "later"
        '향후', '차후', '보류', '후순위', '당분간', '추가\\s*예정', '다음\\s*(?:버전|릴리스|스프린트)', `\\bv\\d+\\s*(?:에서|로)\\s*.{0,8}(?:${ACT}|지원|추가)`, '\\bphase\\s*\\d', '\\bTBD\\b',
        '일단\\s*(?:빼|뺐|숨기|숨김|두고)', '빼\\s*둠|빼\\s*두', '\\bnext (?:sprint|release|version)\\b', '\\bfor later\\b(?!\\s+use)',
        // review 11-16 round 3
        '언젠가', '여유\\s*(?:가\\s*)?(?:될|생길|있을)\\s*때', '다음\\s*회차', '두\\s*번째\\s*PR', '\\ba follow[- ]?up\\b', '범위가\\s*아님', '범위\\s*(?:에|가)\\s*(?:들지|안\\s*들)',
        '이후에\\s*(?:연결|붙|넣|만들)', '이어서\\s*(?:하겠|할게|진행하겠)', '여기까지만', '\\bleave\\b[^.]{0,30}\\bout\\b', '\\bsomeday\\b', '\\bwhen (?:there is |we have )?time\\b'
      ].join('|'),
      'i'
    )
  },
  {
    id: 'after-time',
    re: new RegExp(
      [
        `수업\\s*(?:이\\s*)?(?:뒤|후|이후|끝나고|끝난\\s*(?:다음|뒤|후))\\s*(?:에\\s*)?.{0,12}${ACT}`,
        `(?:\\d{1,2}:\\d{2}|(?:오전|오후)?\\s*\\d{1,2}\\s*시(?!간)|\\d{1,2}\\s*/\\s*\\d{1,2}|\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일)\\s*(?:뒤|후|이후|넘어|부터)\\s*(?:에\\s*)?.{0,12}${ACT}`,
        `수업\\s*(?:을\\s*)?마치고\\s*.{0,12}(?:${ACT}|넣음|붙임)`,
        `(?:내일|모레|다음\\s*주|다음\\s*달|주말)\\s*(?:에|부터)?\\s*.{0,8}${ACT}`,
        '\\bafter (?:the )?lesson', '\\bafter \\d{1,2}(?::\\d{2}|\\s*(?:am|pm))\\b', '\\btomorrow\\b'
      ].join('|'),
      'i'
    )
  },
  { id: 'instead', re: /오늘은\s.*대신|대신\s.*먼저|\binstead of\b.*\b(?:for now|first|today)\b|축소판|최소\s*(?:판|버전)|MVP\s*만/i },
  {
    id: 'only-first',
    re: /우선\s[^.]{0,30}만(?=\s|$|[.,)])|먼저\s(?![^.]*(?:되면|하면))[^.]{0,30}만(?=\s|$|[.,)])|만\s*먼저(?!\s*\S*(?:되면|하면))|이번(?:엔|에는|은)\s.*만(?=\s|$|[.,)])|\bfor now\b|\bonly\b[^.]{0,30}\bfor now\b|\b(?:ship|merge|add|build|do)\w*\s+only\b[^.]{0,30}\bfirst\b/i
  },
  {
    id: 'scope-cut',
    re: /범위를?\s*(?:줄|좁|축소)|범위\s*밖(?:이라|이어서|이므로|이니|으로\s*(?:두|뺐|빼|미))|빼고\s*(?:머지|배포|진행)|제외(?:했|하고|합니다|함)|생략(?:하고|했)|\bout of scope\b|\bscope(?:d)? down\b/i
  }
];

/** Uncited postponing/narrowing phrases in a PR text: [{ line, id, phrase, text }]. */
export function lintPrText(text) {
  return lintPrTextFull(text).hits;
}

/**
 * { hits, cited }: `cited` = the decision ids that excuse a postponing phrase in their paragraph. Their existence is
 * not checkable here (the spine and the ledger are in the automation repo): the lane merge gate looks each one up.
 */
export function lintPrTextFull(text) {
  const out = [];
  const cited = new Set();
  const lines = String(text ?? '').split(/\r?\n/);
  // paragraphs: runs of non-blank lines; a decision id anywhere in the paragraph cites it
  let para = [];
  let inCode = false;
  const flush = () => {
    const ids = para.flatMap((p) => p.text.match(new RegExp(DECISION_REF.source, 'g')) ?? []);
    const hits = [];
    for (const p of para) {
      for (const d of DEFER_PATTERNS) {
        const m = p.text.match(d.re);
        if (m) hits.push({ line: p.n, id: d.id, phrase: m[0], text: p.text.trim().slice(0, 160) });
      }
    }
    if (!ids.length) out.push(...hits);
    else if (hits.length) for (const id of ids) cited.add(id);
    para = [];
  };
  lines.forEach((raw, i) => {
    if (/^\s*```/.test(raw)) {
      inCode = !inCode;
      return;
    }
    if (inCode) return;
    if (!raw.trim()) return flush();
    // A quote is skipped only when it says whose words it is (the operator's); an unattributed quote is the author's text.
    // ... and names a date or an id, so a made-up "> 원문: 다음 PR 에서" does not hide the author's own text
    if (/^\s*>\s*(?:\*\*)?(?:Dan|운영자|원문|operator)\b/i.test(raw) && /\d{1,2}[-/.]\d{1,2}|\bR\d{3,}\b|\bd_[0-9a-f]{6,}/.test(raw)) return;
    // A short code span names a phrase (`수업 뒤`); a long one could hide a sentence, so it is checked.
    // ... and only on a line that talks about phrases or this rule ("표현", "검사", "e.g."): elsewhere the span is text.
    const naming = /표현|낱말|문구|패턴|검사|규칙|잡(?:았|습|는)|막(?:습|는|았)|예:|e\.g\.|phrase|pattern|rule/i.test(raw);
    para.push({ n: i + 1, text: naming ? raw.replace(/`([^`]{1,15})`/g, ' ') : raw.replace(/`/g, ' ') });
  });
  flush();
  return { hits: out, cited: [...cited] };
}

function readPr(number) {
  const json = execFileSync('gh', ['pr', 'view', String(number), '--json', 'title,body'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const { title, body } = JSON.parse(json);
  return `${title ?? ''}\n\n${body ?? ''}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let text;
  let label;
  if (args[0] === '--file' && args[1]) {
    text = fs.readFileSync(args[1], 'utf8');
    label = args[1];
  } else if (/^\d+$/.test(args[0] ?? '')) {
    text = readPr(args[0]);
    label = `PR #${args[0]}`;
  } else {
    console.error('usage: node tools/pr-lint.mjs <PR number> | --file <path>');
    process.exit(2);
  }
  const { hits: found, cited } = lintPrTextFull(text);
  // the lane merge gate reads this line and looks every id up on the spine and in the ledger
  if (cited.length) console.log(`근거 결정: ${cited.join(' ')}`);
  for (const f of found) console.log(`${label}:${f.line} [${f.id}] "${f.phrase}" — ${f.text}`);
  if (found.length) {
    console.log(
      `\n${found.length}곳이 시점을 미루거나 범위를 줄입니다. 운영자 결정 id(d_… 결정 카드 또는 R… 원장)를 같은 문단에 적거나, 미루지 말고 지금 넣으세요 (AGENTS.md 0.7).`
    );
    process.exit(1);
  }
  console.log(`${label}: 시점 미루기·범위 축소 표현 없음`);
}
