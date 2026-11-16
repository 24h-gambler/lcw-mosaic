// Machine-readable list of everything the spec promises a user will see or get (docs/README.md "설계서 대조").
//   node tools/spec-ids.mjs            → prints the list as JSON
//   node tools/spec-ids.mjs --summary  → counts per kind, broken references
// docs/spec-coverage.json holds one entry per id; tools/spec-coverage.mjs checks the two against each other.
//
// Sources (each one a plain markdown structure, so a spec edit changes the list without touching this file):
//   screen  — every table row in docs/*.md whose first cell is a screen ID (G01, T01, P01, W01, "W01~W09" expands).
//             docs/08 §8.6 is the screen list; docs/14 §2 adds the site's W rows.
//   state   — the "빈 상태 / 오류 상태" cell of a screen row (docs/08 §8.6): G01.state, P01.state.
//   flow    — docs/10 §1–§7 diagrams: sequence messages by their autonumber (F10.2.07), flowchart nodes by node name
//             (F10.3.A2, double-paren nodes too), labelled edges by their ends (F10.1.S-W); §8 trigger table cells by
//             row and role (F10.8.+3분.player).
//   wp      — docs/11 work packages with their acceptance criteria (WP-104): an agent reporting "WP done" is checked too.
// Ids built from a position (C01.1.s2, C01.4.b3, F10.2.07) move when the spec gains a line above them: the coverage
// check compares each stored title with the spec's and fails on a mismatch, so the status is judged again.
//   promise — docs/01 (§1 sentences, every table row, every bullet) and docs/02 §1 principles and §2 stack rows:
//             C01.3.체험_씬, C02.2.로그인.
// Broken references: a doc number in backticks (`06`) or a file name (06-lesson-teacher.md) with no docs/NN-*.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');

const SCREEN_ID = /^([A-Z])(\d{2})(?:\s*[~–-]\s*([A-Z])(\d{2}))?$/;
const ROLE = { 플레이어: 'player', 교사: 'teacher', 학부모: 'parent', 외부인: 'outsider' };

export function docFiles() {
  return fs.readdirSync(DOCS).filter((f) => f.endsWith('.md')).sort();
}

function read(f) {
  return fs.readFileSync(path.join(DOCS, f), 'utf8').split(/\r?\n/);
}

function cells(line) {
  if (!/^\s*\|/.test(line) || /^\s*\|\s*-{2,}/.test(line)) return null;
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** Current `## n.` / `### n.m` section number for each line. */
function sections(lines) {
  let cur = '';
  return lines.map((l) => {
    const m = /^#{2,4}\s+(\d+(?:\.\d+)*)\.?\s/.exec(l);
    if (m) cur = m[1];
    return cur;
  });
}

export function slug(s) {
  return s
    .replace(/[`*"“”'’]/g, '')
    .replace(/\(.*?\)/g, '')
    .trim()
    .replace(/[\s/·,]+/g, '_')
    .replace(/_+$/, '')
    .slice(0, 40);
}

const states = new Map();
function screens() {
  states.clear();
  const out = new Map();
  for (const f of docFiles()) {
    const lines = read(f);
    const header = [];
    lines.forEach((l, i) => {
      const c = cells(l);
      if (!c) return;
      if (c[0] === 'ID') {
        header.splice(0, header.length, ...c);
        return;
      }
      // Only screen tables count (08 §8.6 "ID | 화면", 14 §2 "ID | 주소"); 09 and 13 reuse letters for other lists.
      if (header[1] !== '화면' && header[1] !== '주소') return;
      const m = SCREEN_ID.exec(c[0] ?? '');
      if (!m) return;
      const [, a, n1, b, n2] = m;
      const ids = [];
      if (b && b === a) for (let n = Number(n1); n <= Number(n2); n++) ids.push(`${a}${String(n).padStart(2, '0')}`);
      else ids.push(`${a}${n1}`);
      for (const id of ids) {
        const prev = out.get(id);
        const title = header[1] === '주소' ? `${c[3] ?? ''} (${c[1] ?? ''})` : (c[1] ?? '');
        const entry = prev ?? { id, kind: 'screen', title, audience: c[2] ?? '', sources: [], refs: [] };
        // A range row ("W01~W09 소개 사이트") only names the group; an exact row elsewhere carries the real title.
        if (prev && !b) entry.title = title;
        entry.sources.push(`docs/${f}:${i + 1}`);
        // 08 §8.6 "빈 상태 / 오류 상태": its own promise, judged apart from the screen (an empty state is easy to skip).
        if (header[4] && /빈 상태|오류 상태/.test(header[4]) && c[4])
          states.set(`${id}.state`, { id: `${id}.state`, kind: 'state', title: `${c[1]}: ${c[4]}`, sources: [`docs/${f}:${i + 1}`] });
        for (const r of c.join(' ').matchAll(/`(\d{2})`/g)) entry.refs.push(r[1]);
        out.set(id, entry);
      }
    });
  }
  return [...out.values()];
}

function flows() {
  const f = docFiles().find((x) => x.startsWith('10-'));
  if (!f) return [];
  const lines = read(f);
  const sec = sections(lines);
  const out = [];
  let inMermaid = false;
  let kind = '';
  let step = 0;
  const seen = new Set();
  lines.forEach((l, i) => {
    const s = sec[i].split('.')[0];
    if (/^```mermaid/.test(l)) {
      inMermaid = true;
      kind = '';
      step = 0;
      return;
    }
    if (inMermaid && /^```/.test(l)) {
      inMermaid = false;
      return;
    }
    if (inMermaid) {
      if (!kind) {
        kind = l.trim().split(/\s+/)[0];
        return;
      }
      if (kind === 'sequenceDiagram') {
        const m = /^\s*(\w+)\s*-{1,2}>>\s*(\w+)\s*:\s*(.+)$/.exec(l);
        if (m) {
          step += 1;
          out.push({ id: `F10.${s}.${String(step).padStart(2, '0')}`, kind: 'flow', title: `${m[1]}→${m[2]}: ${m[3].trim()}`, sources: [`docs/${f}:${i + 1}`] });
        }
        return;
      }
      for (const m of l.matchAll(/\b([A-Za-z]\w*)\s*(?:\[\s*"([^"]*)"\s*\]|\{\s*"([^"]*)"\s*\}|\(\(\s*"([^"]*)"\s*\)\)|\(\s*"([^"]*)"\s*\))/g)) {
        const id = `F10.${s}.${m[1]}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ id, kind: 'flow', title: m[2] ?? m[3] ?? m[4] ?? m[5] ?? '', sources: [`docs/${f}:${i + 1}`] });
      }
      // a labelled edge is a promise of its own ("S -->|게스트 패스| F"): what goes from one role to another
      for (const m of l.matchAll(/\b([A-Za-z]\w*)\s*[-=.]+>\s*\|\s*"?([^"|]+?)"?\s*\|\s*([A-Za-z]\w*)/g)) {
        let id = `F10.${s}.${m[1]}-${m[3]}`;
        for (let n = 2; seen.has(id); n++) id = `F10.${s}.${m[1]}-${m[3]}_${n}`;
        seen.add(id);
        out.push({ id, kind: 'flow', title: `${m[1]}→${m[3]}: ${m[2].trim()}`, sources: [`docs/${f}:${i + 1}`] });
      }
      return;
    }
    if (s === '8') {
      const c = cells(l);
      if (!c || c[0] === '시점') return;
      const roles = ['player', 'teacher', 'parent', 'outsider'];
      c.slice(1, 5).forEach((v, k) => {
        if (v) out.push({ id: `F10.8.${slug(c[0])}.${roles[k]}`, kind: 'flow', title: `${c[0]} · ${Object.keys(ROLE)[k]}: ${v}`, sources: [`docs/${f}:${i + 1}`] });
      });
    }
  });
  return out;
}

function promises() {
  const out = [];
  const add = (id, title, src) => {
    let k = id;
    let n = 2;
    while (out.some((o) => o.id === k)) k = `${id}_${n++}`;
    out.push({ id: k, kind: 'promise', title: title.slice(0, 160), sources: [src] });
  };
  const f01 = docFiles().find((x) => x.startsWith('01-'));
  if (f01) {
    const lines = read(f01);
    const sec = sections(lines);
    let bullets = {};
    lines.forEach((l, i) => {
      const s = sec[i].split('.')[0];
      const src = `docs/${f01}:${i + 1}`;
      if (!s) return;
      if (s === '1' && l.trim() && !l.startsWith('#')) {
        l.split(/(?<=[다요])\.\s+/).forEach((sent, k) => sent.trim() && add(`C01.1.s${k + 1}`, sent.trim(), src));
        return;
      }
      const c = cells(l);
      if (c) {
        const isHeader = lines[i + 1] && /^\s*\|\s*-{2,}/.test(lines[i + 1]);
        if (!isHeader && c[0]) add(`C01.${s}.${slug(c[0])}`, c.join(' · '), src);
        return;
      }
      if (/^\s*-\s+/.test(l)) {
        bullets[s] = (bullets[s] ?? 0) + 1;
        add(`C01.${s}.b${bullets[s]}`, l.replace(/^\s*-\s+/, ''), src);
      }
    });
  }
  const f02 = docFiles().find((x) => x.startsWith('02-'));
  if (f02) {
    const lines = read(f02);
    const sec = sections(lines);
    lines.forEach((l, i) => {
      const s = sec[i];
      const src = `docs/${f02}:${i + 1}`;
      if (s === '1') {
        const m = /^(\d+)\.\s+(.+)$/.exec(l);
        if (m) add(`C02.1.${m[1]}`, m[2], src);
      } else if (s === '2') {
        const c = cells(l);
        const isHeader = lines[i + 1] && /^\s*\|\s*-{2,}/.test(lines[i + 1]);
        if (c && !isHeader && c[0]) add(`C02.2.${slug(c[0])}`, c.join(' · '), src);
      }
    });
  }
  return out;
}

/** Doc numbers the docs point at (`06`, 06-name.md) that have no file in docs/. */
export function brokenRefs() {
  const have = new Set(docFiles().map((f) => f.slice(0, 2)).filter((n) => /^\d{2}$/.test(n)));
  const out = [];
  for (const f of docFiles()) {
    read(f).forEach((l, i) => {
      const refs = new Set();
      for (const m of l.matchAll(/`(\d{2})`/g)) refs.add(m[1]);
      for (const m of l.matchAll(/\b(\d{2})-[a-z][a-z0-9-]*\.md\b/g)) refs.add(m[1]);
      for (const r of refs) if (!have.has(r)) out.push({ doc: `docs/${f}`, line: i + 1, ref: r, text: l.trim().slice(0, 120) });
    });
  }
  return out;
}

function workPackages() {
  const out = [];
  const f = docFiles().find((x) => x.startsWith('11-'));
  if (!f) return out;
  let header = [];
  read(f).forEach((l, i) => {
    const c = cells(l);
    if (!c) return;
    if (c[0] === 'WP') {
      header = c;
      return;
    }
    if (header[0] !== 'WP' || !/^WP-\d{3}$/.test(c[0])) return;
    out.push({ id: c[0], kind: 'wp', title: `${c[1]} — 수용 기준: ${c[2] ?? ''}`.slice(0, 200), sources: [`docs/${f}:${i + 1}`] });
  });
  return out;
}

export function specIds() {
  const scr = screens();
  return [...scr, ...states.values(), ...flows(), ...promises(), ...workPackages()];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ids = specIds();
  if (process.argv.includes('--summary')) {
    const by = {};
    for (const x of ids) by[x.kind] = (by[x.kind] ?? 0) + 1;
    console.log(JSON.stringify({ total: ids.length, by, broken_refs: brokenRefs() }, null, 2));
  } else {
    console.log(JSON.stringify(ids, null, 2));
  }
}
