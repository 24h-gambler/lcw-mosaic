// User-visible words the product never uses (docs/21-glossary.md, operator instruction 2026-11-16: "'게임'이라는 낱말을
// 쓰면 안 됩니다"). Checked by tools/__tests__/forbidden-words.test.ts inside `pnpm test`; `bannedIn` is also what a
// live-site check should use.
//
// What counts as user-visible: every string literal, template piece and JSX text in the shipped sources (comments and
// identifiers are not), plus the HTML entry pages and web manifests. Parsing goes through the TypeScript compiler so a
// comment or an identifier such as `size="game"` never trips the check, while `'3D 블록 게임'` always does.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Source folders whose strings reach a screen, a page, a push or a share preview: the three apps and every package. */
export const SCAN_DIRS = [
  'apps/web/src',
  'apps/client/src',
  'apps/edge/src',
  ...(fs.existsSync(path.join(ROOT, 'packages'))
    ? fs
        .readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => `packages/${d.name}/src`)
    : [])
];
/** Scripts served as-is whose strings people read (the family push service worker titles its notifications). */
export const SCAN_SCRIPTS = ['apps/web/public/family-sw.js'];
/** Plain files served as-is (titles, meta tags, manifests). */
export const SCAN_FILES = ['apps/web/index.html', 'apps/client/index.html', 'apps/web/public/family.webmanifest'];

/**
 * The banned words. `ko` matches anywhere in a user-visible string (게임 and its short form 겜). `en` matches as a whole
 * word (game, games, gaming, gamer, gameplay, minigame), but only in text that reads as prose (has a space) so
 * single-token identifiers passed as strings (`size: 'game'`, `'game-canvas-viewport'`) stay legal; `enWord` catches a
 * capitalised one-word label (`aria-label="Game"`, `title: 'Games'`), which is text people read, not an identifier.
 * `path` catches the old /game URL anywhere in a string, absolute links included (`https://…/game/?code=`).
 */
export const BANNED = [
  { id: 'ko-game', ko: /게임|겜/, use: '월드 · 마을 · 놀이 · 플레이 (docs/21-glossary.md)' },
  {
    id: 'en-game',
    en: /\b(?:mini-?)?(?:games?|gaming|gamers?|gameplay)\b/i,
    enWord: /^[\s"'([]*(?:Mini-?)?(?:Games?|Gaming|Gamers?|Gameplay|GAMES?)[\s"')\].,:;!?]*$/,
    use: 'world · town · play (docs/21-glossary.md)'
  },
  { id: 'path-game', path: /\/game(?=[/?#'"`\s)]|$)/, use: '/world/ (apps/edge/src/world-path.ts redirects /game/)' }
];

/**
 * Places a banned form is allowed, each with its reason. Keep this list short: a new entry is a product decision,
 * not a way to get a test green.
 */
export const ALLOW = [
  { file: 'apps/edge/src/world-path.ts', id: 'path-game', why: 'the /game → /world redirect has to name the old path' },
  { file: 'apps/web/src/site/prerender.tsx', id: 'path-game', text: 'Disallow: /game/', why: 'robots.txt keeps the old path out of search results' },
  { file: 'apps/web/src/site/prerender.tsx', id: 'en-game', text: 'Disallow: /game/', why: 'same robots.txt line (read by crawlers, not people)' }
];

function walkFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules' || e.name === 'dist') continue;
      out.push(...walkFiles(rel));
    } else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.(test|spec)\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) {
      out.push(rel);
    }
  }
  return out;
}

/** Every user-visible text piece of one source file: { text, line }. */
export function visibleStrings(code, fileName) {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : fileName.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const visit = (node) => {
    const k = node.kind;
    const isModuleSpecifier =
      node.parent && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent) || ts.isExternalModuleReference(node.parent));
    if (
      !isModuleSpecifier &&
      (k === ts.SyntaxKind.StringLiteral ||
        k === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
        k === ts.SyntaxKind.TemplateHead ||
        k === ts.SyntaxKind.TemplateMiddle ||
        k === ts.SyntaxKind.TemplateTail ||
        k === ts.SyntaxKind.JsxText)
    ) {
      const text = k === ts.SyntaxKind.JsxText ? node.getText(sf) : node.text;
      if (text.trim()) out.push({ text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, jsx: k === ts.SyntaxKind.JsxText });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Visible text of an HTML/manifest file: text between tags and the attributes people read (content, alt, title, aria-label). */
function htmlPieces(code) {
  const out = [];
  code.split(/\r?\n/).forEach((l, i) => {
    const line = l.replace(/<!--.*?-->/g, '');
    for (const m of line.matchAll(/\b(?:content|alt|title|aria-label|label)\s*=\s*"([^"]*)"/g)) out.push({ text: m[1], line: i + 1, jsx: true });
    for (const m of line.matchAll(/"(?:name|short_name|description)"\s*:\s*"([^"]*)"/g)) out.push({ text: m[1], line: i + 1, jsx: true });
    const between = line.replace(/<[^>]*>/g, ' ');
    if (between.trim() && !/^\s*[{}\[\]",:]/.test(between)) out.push({ text: between, line: i + 1, jsx: true });
  });
  return out;
}

/** Banned forms in one piece of text, as rule ids. */
export function bannedIn(text, { prose = false } = {}) {
  const hits = [];
  for (const b of BANNED) {
    if (b.ko && b.ko.test(text)) hits.push(b.id);
    if (b.en && b.en.test(text) && (prose || /\s/.test(text.trim()) || b.enWord.test(text))) hits.push(b.id);
    if (b.path && b.path.test(text)) hits.push(b.id);
  }
  return hits;
}

function allowed(file, id, text) {
  return ALLOW.some((a) => a.file === file && a.id === id && (a.text === undefined || text.includes(a.text)));
}

/** All violations in the repository: { file, line, id, text, use }. */
export function scanForbiddenWords({ dirs = SCAN_DIRS, scripts = SCAN_SCRIPTS, files = SCAN_FILES } = {}) {
  const found = [];
  const check = (file, pieces) => {
    for (const p of pieces) {
      for (const id of bannedIn(p.text, { prose: p.jsx })) {
        if (allowed(file, id, p.text)) continue;
        found.push({ file, line: p.line, id, text: p.text.trim().slice(0, 140), use: BANNED.find((b) => b.id === id)?.use });
      }
    }
  };
  for (const f of [...dirs.flatMap(walkFiles), ...scripts.filter((f) => fs.existsSync(path.join(ROOT, f)))])
    check(f, visibleStrings(fs.readFileSync(path.join(ROOT, f), 'utf8'), f));
  for (const f of files) {
    const abs = path.join(ROOT, f);
    if (fs.existsSync(abs)) check(f, htmlPieces(fs.readFileSync(abs, 'utf8')));
  }
  return found;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const v = scanForbiddenWords();
  for (const x of v) console.log(`${x.file}:${x.line} [${x.id}] ${x.text}  → ${x.use}`);
  console.log(v.length ? `${v.length} forbidden word(s)` : 'no forbidden words');
  process.exit(v.length ? 1 : 0);
}
