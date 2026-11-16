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
        '나중에', '추후', '미루', '미룹', '미뤄', '넘깁니다', '넘기겠', '넘겨', '다음\\s*(?:PR|작업|번\\s*에)', '다음\\s*단계\\s*(?:에서|로\\s*미|에\\s*(?:넣|붙|만들))',
        '후속\\s*(?:PR|작업)', '별도\\s*(?:PR|작업)', 'PR\\s*을?\\s*(?:나누|분리)', '분리(?:해|하여|한)?\\s*(?:PR|작업)', '2차\\s*(?:로|에서|작업)',
        '이번\\s*PR\\s*(?:에|에서)?\\s*(?:는\\s*)?(?:넣지|포함하지|하지|만들지)\\s*않',
        // "later" as a promise to do it then, not as a time ("30 days later", "a later run")
        '\\b(?:will|to be|be|do|add|fix|handle|wire|ship|merge|deploy|address|revisit|come back to)\\b[^.]{0,30}\\blater\\b',
        '\\blater (?:PR|today|tonight|this week)\\b', '\\bfor later\\b',
        'follow[- ]?up\\s+(?:PR|work|task|change)', '\\bin a follow[- ]?up\\b', 'postpon', '\\bdefer(?:red|ring)? (?:to|until|it|this|that|the)\\b',
        '\\b(?:next|subsequent|separate|another|future) PR\\b', '\\bnot (?:included|in this PR|done yet)\\b'
      ].join('|'),
      'i'
    )
  },
  {
    id: 'after-time',
    re: new RegExp(
      [
        `수업\\s*(?:이\\s*)?(?:뒤|후|이후|끝나고|끝난\\s*(?:다음|뒤|후))\\s*(?:에\\s*)?.{0,12}${ACT}`,
        '(?:\\d{1,2}:\\d{2}|(?:오전|오후)?\\s*\\d{1,2}\\s*시(?!간))\\s*(?:뒤|후|이후|넘어|부터)',
        `(?:내일|모레|다음\\s*주|주말)\\s*(?:에|부터)?\\s*.{0,8}${ACT}`,
        '\\bafter (?:the )?lesson', '\\bafter \\d{1,2}(?::\\d{2}|\\s*(?:am|pm))\\b', '\\btomorrow\\b'
      ].join('|'),
      'i'
    )
  },
  { id: 'instead', re: /오늘은\s.*대신|대신\s.*먼저|\binstead of\b.*\b(?:for now|first|today)\b|축소판|최소\s*(?:판|버전)|MVP\s*만/i },
  {
    id: 'only-first',
    re: /우선\s.*만(?=\s|$|[.,)])|먼저\s.*만(?=\s|$|[.,)])|만\s*먼저(?!\s*\S*(?:되면|하면))|이번(?:엔|에는|은)\s.*만(?=\s|$|[.,)])|\bfor now\b|\bonly .* for now\b|\bfirst .* only\b/i
  },
  {
    id: 'scope-cut',
    re: /범위를?\s*(?:줄|좁|축소)|범위\s*밖|빼고\s*(?:머지|배포|진행)|제외(?:했|하고|합니다|함)|생략(?:하고|했)|\bout of scope\b|\bscope(?:d)? down\b/i
  }
];

/** Uncited postponing/narrowing phrases in a PR text: [{ line, id, phrase, text }]. */
export function lintPrText(text) {
  const out = [];
  const lines = String(text ?? '').split(/\r?\n/);
  // paragraphs: runs of non-blank lines; a decision id anywhere in the paragraph cites it
  let para = [];
  let inCode = false;
  const flush = () => {
    const cited = para.some((p) => DECISION_REF.test(p.text));
    if (!cited) {
      for (const p of para) {
        for (const d of DEFER_PATTERNS) {
          const m = p.text.match(d.re);
          if (m) out.push({ line: p.n, id: d.id, phrase: m[0], text: p.text.trim().slice(0, 160) });
        }
      }
    }
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
    if (/^\s*>/.test(raw) && /Dan|운영자|원문|operator/i.test(raw)) return;
    // A short code span names a phrase (`수업 뒤`); a long one could hide a sentence, so it is checked.
    para.push({ n: i + 1, text: raw.replace(/`([^`]{1,15})`/g, ' ') });
  });
  flush();
  return out;
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
  const found = lintPrText(text);
  for (const f of found) console.log(`${label}:${f.line} [${f.id}] "${f.phrase}" — ${f.text}`);
  if (found.length) {
    console.log(
      `\n${found.length}곳이 시점을 미루거나 범위를 줄입니다. 운영자 결정 id(d_… 결정 카드 또는 R… 원장)를 같은 문단에 적거나, 미루지 말고 지금 넣으세요 (AGENTS.md 0.7).`
    );
    process.exit(1);
  }
  console.log(`${label}: 시점 미루기·범위 축소 표현 없음`);
}
