// PR text check (AGENTS.md 0.7, operator 2026-11-16: "왜 수업뒤에 넣어요? 제 말이 제대로 전달이 안되고 있나요?").
// An instruction from the operator was turned into "later" or "a smaller version first" on its way to a lane four times in
// one day (3D → lesson mode, one-time link, world picker, merge after 17:00). Postponing and narrowing are the operator's
// call only, so a PR that postpones or narrows must cite the decision: a decision card id (d_…) or a ledger line (R…)
// in the same paragraph.
//
//   node tools/pr-lint.mjs <PR number>      reads title + body with `gh pr view` and fails (exit 1) on an uncited phrase
//   node tools/pr-lint.mjs --file <path>    the same for a text file (a PR body draft)
// Required before every merge (AGENTS.md 5장). Quoted lines (`> …`) and code blocks are not checked: quoting the
// operator or this rule is not postponing.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DECISION_REF = /\b(?:d_[0-9a-f]{6,}|R\d{3,})\b/;

/** Phrases that postpone or narrow. Each needs a decision id in the same paragraph. */
export const DEFER_PATTERNS = [
  { id: 'later', re: /나중에|추후|다음\s*(?:PR|번\s*에)|다음\s*단계\s*(?:에서|로\s*미|에\s*(?:넣|붙|만들))|후속\s*(?:PR|작업)|later\b|follow[- ]?up\s+(?:PR|work|task|change)|in a follow[- ]?up\b|postpone|defer(?:red)?\b|\bnext PR\b|\bTODO\b/i },
  { id: 'after-time', re: /수업\s*(?:뒤|후|이후|끝나고)|\d{1,2}:\d{2}\s*(?:뒤|후|이후|부터)|(?:내일|다음\s*주|주말)\s*(?:에|부터)?\s*(?:머지|배포|넣|만들|붙)|after (?:the )?lesson|after \d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i },
  { id: 'instead', re: /오늘은\s.*대신|대신\s.*먼저|\binstead of\b.*\b(?:for now|first|today)\b|축소판|최소\s*(?:판|버전)|MVP\s*만|\bstub\b|임시로|일단\s/i },
  { id: 'only-first', re: /우선\s.*만(?=\s|$|[.,)])|먼저\s.*만(?=\s|$|[.,)])|만\s*먼저|for now\b|only .* for now|first .* only\b/i },
  { id: 'scope-cut', re: /범위를?\s*(?:줄|좁|축소)|빼고\s*(?:머지|배포|진행)|생략(?:하고|했)|\bout of scope\b|\bscope(?:d)? down\b/i }
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
    if (/^\s*>/.test(raw)) return; // a quote (the operator's words, this rule) is not the author postponing
    para.push({ n: i + 1, text: raw.replace(/`[^`]*`/g, ' ') });
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
